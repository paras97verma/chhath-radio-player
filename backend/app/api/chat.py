"""
Chhath Radio — Live Chat API

Endpoints:
  POST /api/chat/messages  — Send a chat message (anonymous)
  GET  /api/chat/messages  — Fetch last N messages (initial load)

Storage:
  Messages are stored exclusively in Redis as a time-sorted set
  (score = unix timestamp). Max 200 messages are retained and survive
  server restarts and redeployments.

  There is NO in-memory deque fallback — the deque was the root cause of
  history loss: it was wiped on every deploy and the lru_cache on the Redis
  pool permanently cached None on a cold-start failure, silently routing all
  writes to the doomed deque.

  If Redis is unavailable, _store_message() logs a warning and drops the
  message (honest data loss), and _load_messages() returns [] (honest empty
  state). This is far better than silently accumulating messages in a deque
  that will be wiped on the next deploy.

Real-time broadcast:
  New messages are pushed to all active WebSocket connections via ws_chat.broadcast().

Rate limiting:
  In-memory dict (1 message per 3 seconds per IP). Correct for single-worker.
"""

import json
import logging
import time
import uuid
import random
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.redis import get_redis_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

# ─── Redis key ────────────────────────────────────────────────────────────────
CHAT_KEY = "chhath:chat:messages"
MAX_MESSAGES = 200          # Retain latest 200 messages permanently

# ─── Rate limiting (in-memory, single-worker) ─────────────────────────────────
_rate_limit: dict[str, float] = {}
RATE_LIMIT_SECONDS = 3.0

# ─── Funny bhakti-style anonymous name pool ───────────────────────────────────
_NAMES = [
    "🪔 Diya_Wala_Bhakt",
    "🙏 Arghya_Dene_Wala",
    "☀️ Surya_Ka_Sevak",
    "🌸 Chhathi_Maiya_Fan",
    "🎵 Geet_Sunne_Wala",
    "🌊 Jal_Mein_Khada_Bhakt",
    "🪔 Thekua_Khane_Wala",
    "🙏 Prasad_Lene_Wala",
    "☀️ Usha_Arghya_Wala",
    "🌸 Sandhya_Arghya_Wali",
    "🎵 Kelwa_Ke_Paat_Fan",
    "🌊 Ganga_Kinare_Wala",
    "🪔 Diya_Jalane_Wala",
    "🙏 Chhath_Ke_Bhakt",
    "☀️ Suraj_Devta_Fan",
    "🌸 Lotus_Wali_Maiya",
    "🎵 Pahile_Pahile_Fan",
    "🌊 Nadi_Mein_Khada",
    "🪔 Bamboo_Ke_Soop_Wala",
    "🙏 Puja_Karne_Wala",
    "☀️ Bhor_Ka_Tara",
    "🌸 Mahua_Ke_Phool",
    "🎵 Chhath_Geet_Lover",
    "🌊 Ghat_Pe_Khada_Bhakt",
    "🪔 Mitti_Ka_Diya",
    "🙏 Jai_Chhathi_Maiya",
    "☀️ Surya_Namaskar_Wala",
    "🌸 Kaddu_Bhaat_Fan",
    "🎵 Radio_Sunne_Wala",
    "🌊 Patna_Ka_Bhakt",
    "🪔 Varanasi_Wala",
    "🙏 Muzaffarpur_Bhakt",
    "☀️ Bhagalpur_Ka_Fan",
    "🌸 Darbhanga_Wali",
    "🎵 Ara_Ka_Bhakt",
    "🌊 Chapra_Wala",
    "🪔 Sitamarhi_Bhakt",
    "🙏 Delhi_Wala_Bhakt",
    "☀️ Mumbai_Ka_Chhath_Fan",
    "🌸 Kolkata_Wali_Maiya",
]


def _random_name() -> str:
    return random.choice(_NAMES)


# ─── Message storage (Redis-only) ─────────────────────────────────────────────

def _store_message(msg: dict[str, Any]) -> None:
    """
    Persist a message to the Redis sorted set (score = unix timestamp).

    Enforces the MAX_MESSAGES cap via ZREMRANGEBYRANK in the same pipeline.
    If Redis is unavailable, logs a warning and drops the message — this is
    intentional: a dropped message is far better than silently accumulating
    in an in-memory deque that will be wiped on the next deploy.
    """
    r = get_redis_client()
    if r is None:
        logger.warning(
            "Redis unavailable — chat message dropped (id=%s). "
            "Message will not appear in history after reconnect.",
            msg.get("id"),
        )
        return

    try:
        ts = float(msg["ts"])
        pipe = r.pipeline()
        pipe.zadd(CHAT_KEY, {json.dumps(msg): ts})
        # Enforce hard cap — retain only the newest MAX_MESSAGES entries.
        # zremrangebyrank removes by rank (0 = oldest). After adding the new
        # entry, rank -(MAX_MESSAGES+1) and below are excess.
        pipe.zremrangebyrank(CHAT_KEY, 0, -(MAX_MESSAGES + 1))
        pipe.execute()
    except Exception as exc:
        logger.warning("Redis chat store failed (message dropped): %s", exc)


def _load_messages(limit: int = MAX_MESSAGES) -> list[dict[str, Any]]:
    """
    Load the last `limit` messages from the Redis sorted set.

    Always reads from Redis — there is no in-memory cache. This guarantees
    that history survives deploys as long as Redis is available.

    Returns [] if Redis is unavailable (honest empty state).
    """
    r = get_redis_client()
    if r is None:
        logger.warning("Redis unavailable — returning empty chat history.")
        return []

    try:
        # zrange with -limit..-1 returns the newest `limit` entries in
        # ascending timestamp order (oldest first, newest last).
        raw = r.zrange(CHAT_KEY, -limit, -1)
        return [json.loads(m) for m in raw]
    except Exception as exc:
        logger.warning("Redis chat load failed: %s", exc)
        return []


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ChatMessageIn(BaseModel):
    name: str = Field(default="", max_length=40)
    text: str = Field(..., min_length=1, max_length=200)


class ChatMessageOut(BaseModel):
    id: str
    name: str
    text: str
    ts: int


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/messages", response_model=ChatMessageOut, status_code=201)
async def send_message(body: ChatMessageIn, request: Request) -> ChatMessageOut:
    """Send an anonymous chat message. Rate-limited to 1 per 3 seconds per IP."""
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()

    # In-memory rate limit check
    last = _rate_limit.get(client_ip, 0)
    if now - last < RATE_LIMIT_SECONDS:
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {RATE_LIMIT_SECONDS:.0f} seconds between messages.",
        )
    _rate_limit[client_ip] = now

    # Clean up old rate limit entries
    if len(_rate_limit) > 10_000:
        cutoff = now - 60
        for ip in [k for k, v in _rate_limit.items() if v < cutoff]:
            del _rate_limit[ip]

    name = body.name.strip() or _random_name()

    msg: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": name,
        "text": body.text.strip(),
        "ts": int(now),
    }

    _store_message(msg)

    try:
        from app.api import ws_chat
        await ws_chat.broadcast({"type": "chat_message", **msg})
    except Exception as exc:
        logger.warning("WS broadcast failed: %s", exc)

    logger.info("Chat message from %s: %s", name, msg["text"][:40])
    return ChatMessageOut(**msg)


@router.get("/messages", response_model=list[ChatMessageOut])
def get_messages(limit: int = MAX_MESSAGES) -> list[ChatMessageOut]:
    """Fetch the last N chat messages for initial load."""
    limit = min(limit, MAX_MESSAGES)
    msgs = _load_messages(limit)
    return [ChatMessageOut(**m) for m in msgs]