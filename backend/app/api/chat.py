"""
Chhath Radio — Live Chat API

Endpoints:
  POST /api/chat/messages  — Send a chat message (anonymous)
  GET  /api/chat/messages  — Fetch last N messages (initial load)

Storage:
  Messages are stored in Redis as a time-sorted set (score = unix timestamp).
  Max 200 messages are retained permanently across server restarts & redeployments.
  An in-memory deque(maxlen=200) acts as a write-through cache so GET requests
  don't need a Redis round-trip after the first load.

Real-time broadcast:
  New messages are pushed to all active WebSocket connections via ws_chat.broadcast().

Rate limiting:
  In-memory dict (1 message per 3 seconds per IP).
"""

import json
import logging
import time
import uuid
import random
from collections import deque
from functools import lru_cache
from typing import Any, Optional

import redis as redis_lib
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

# ─── Redis key ────────────────────────────────────────────────────────────────
CHAT_KEY = "chhath:chat:messages"
MAX_MESSAGES = 200          # Retain latest 200 messages permanently

# ─── In-memory write-through cache ───────────────────────────────────────────
_message_buffer: deque = deque(maxlen=MAX_MESSAGES)
_buffer_loaded: bool = False  # True after first Redis load

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


# ─── Redis helpers ────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _get_redis_pool() -> Optional[redis_lib.ConnectionPool]:
    """
    Create a single connection pool for the process (cached via lru_cache).
    Returns None if Redis is not configured or unreachable.
    """
    try:
        pool = redis_lib.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=20,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        redis_lib.Redis(connection_pool=pool).ping()
        return pool
    except Exception as exc:
        logger.warning("Redis unavailable for chat: %s", exc)
        return None


def _get_redis() -> Optional[redis_lib.Redis]:
    """Return a Redis client from the shared pool, or None if unavailable."""
    pool = _get_redis_pool()
    return redis_lib.Redis(connection_pool=pool) if pool else None


# ─── Message storage ──────────────────────────────────────────────────────────

def _store_message(msg: dict[str, Any]) -> None:
    """
    Store a message in both the in-memory deque and Redis sorted set.

    The deque write is performed first.
    The Redis write retains the latest 200 messages using zremrangebyrank.
    """
    # 1. Write to in-memory cache (deque auto-drops oldest if > MAX_MESSAGES)
    _message_buffer.append(msg)

    # 2. Persist to Redis sorted set (score = unix timestamp for time-ordering)
    try:
        r = _get_redis()
        if r:
            ts = msg["ts"]
            pipe = r.pipeline()
            pipe.zadd(CHAT_KEY, {json.dumps(msg): ts})
            # Enforce hard cap — retain only the newest MAX_MESSAGES entries
            pipe.zremrangebyrank(CHAT_KEY, 0, -(MAX_MESSAGES + 1))
            pipe.execute()
    except Exception as exc:
        logger.warning("Redis chat store failed (message in deque): %s", exc)


def _load_messages(limit: int = 200) -> list[dict[str, Any]]:
    """
    Load last N messages for initial load (e.g. on WebSocket connect).

    Loads the latest 200 messages from Redis sorted set.
    """
    global _buffer_loaded

    # Populate deque from Redis if not yet loaded or if buffer is empty
    if not _buffer_loaded or not _message_buffer:
        try:
            r = _get_redis()
            if r:
                # Fetch latest MAX_MESSAGES entries from sorted set (ascending by score)
                raw = r.zrange(CHAT_KEY, -MAX_MESSAGES, -1)
                msgs = [json.loads(m) for m in raw]
                _message_buffer.clear()
                for m in msgs:
                    _message_buffer.append(m)
                _buffer_loaded = True
                logger.info("Loaded %d messages from Redis into deque", len(msgs))
        except Exception as exc:
            logger.warning("Redis chat load failed, using deque: %s", exc)
            _buffer_loaded = True

    msgs = list(_message_buffer)
    return msgs[-limit:]


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
def get_messages(limit: int = 200) -> list[ChatMessageOut]:
    """Fetch the last N chat messages for initial load."""
    limit = min(limit, MAX_MESSAGES)
    msgs = _load_messages(limit)
    return [ChatMessageOut(**m) for m in msgs]