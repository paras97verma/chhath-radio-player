"""
Chhath Radio — Live Chat API

Endpoints:
  POST /api/chat/messages  — Send a chat message (anonymous)
  GET  /api/chat/messages  — Fetch last N messages (initial load)

Storage:
  Messages are stored in Redis as a time-sorted set (score = unix timestamp).
  Max 200 messages; messages older than 10 minutes are automatically pruned.
  An in-memory deque(maxlen=200) acts as a write-through cache so GET requests
  don't need a Redis round-trip after the first load.

Real-time broadcast:
  New messages are pushed to all active WebSocket connections via ws_chat.broadcast().
  (Previously used SSE asyncio.Queue — replaced by WebSocket in ws_chat.py.)

Rate limiting:
  In-memory dict (1 message per 3 seconds per IP).
  Sufficient for a single Gunicorn worker. If you ever scale to multiple workers,
  replace with Redis SET NX PX rate limiting.
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
MAX_MESSAGES = 200          # hard cap on stored messages
MESSAGE_TTL_SECONDS = 600   # 10 minutes — messages older than this are pruned

# ─── In-memory write-through cache ───────────────────────────────────────────
# Populated on first _load_messages() call and kept in sync via _store_message().
# deque(maxlen=200) automatically drops the oldest entry when the 201st is appended.
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

    The deque write is always performed first (instant, no failure risk).
    The Redis write is best-effort — if it fails, the message is still in the
    deque and will be broadcast to connected WebSocket clients.
    """
    # 1. Write to in-memory cache (deque auto-drops oldest if > MAX_MESSAGES)
    _message_buffer.append(msg)

    # 2. Persist to Redis sorted set (score = unix timestamp for time-ordering)
    try:
        r = _get_redis()
        if r:
            ts = msg["ts"]
            cutoff = ts - MESSAGE_TTL_SECONDS
            pipe = r.pipeline()
            pipe.zadd(CHAT_KEY, {json.dumps(msg): ts})
            # Prune messages older than 10 minutes
            pipe.zremrangebyscore(CHAT_KEY, "-inf", cutoff)
            # Enforce hard cap — keep only the newest MAX_MESSAGES entries
            pipe.zremrangebyrank(CHAT_KEY, 0, -(MAX_MESSAGES + 1))
            pipe.execute()
    except Exception as exc:
        logger.warning("Redis chat store failed (message in deque): %s", exc)


def _load_messages(limit: int = 50) -> list[dict[str, Any]]:
    """
    Load last N messages for initial load (e.g. on WebSocket connect).

    On first call, loads from Redis and populates the in-memory deque.
    Subsequent calls read from the deque (no Redis round-trip).
    Falls back to the deque if Redis is unavailable.
    """
    global _buffer_loaded

    # Populate deque from Redis on first call
    if not _buffer_loaded:
        try:
            r = _get_redis()
            if r:
                cutoff = time.time() - MESSAGE_TTL_SECONDS
                raw = r.zrangebyscore(CHAT_KEY, cutoff, "+inf")
                msgs = [json.loads(m) for m in raw]
                # Load into deque (respects maxlen=200)
                for m in msgs:
                    _message_buffer.append(m)
                _buffer_loaded = True
                logger.info("Loaded %d messages from Redis into deque", len(msgs))
        except Exception as exc:
            logger.warning("Redis chat load failed, using empty deque: %s", exc)
            _buffer_loaded = True  # don't retry on every call

    msgs = list(_message_buffer)
    return msgs[-limit:]  # newest `limit` messages, oldest-first


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

    # Clean up old rate limit entries (keep dict small)
    if len(_rate_limit) > 10_000:
        cutoff = now - 60
        for ip in [k for k, v in _rate_limit.items() if v < cutoff]:
            del _rate_limit[ip]

    # Use provided name or generate a funny bhakti-style one
    name = body.name.strip() or _random_name()

    msg: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": name,
        "text": body.text.strip(),
        "ts": int(now),
    }

    _store_message(msg)

    # Broadcast to all connected WebSocket clients
    # Import here to avoid circular import (ws_chat imports from chat)
    try:
        from app.api import ws_chat
        await ws_chat.broadcast({"type": "chat_message", **msg})
    except Exception as exc:
        logger.warning("WS broadcast failed: %s", exc)

    logger.info("Chat message from %s: %s", name, msg["text"][:40])
    return ChatMessageOut(**msg)


@router.get("/messages", response_model=list[ChatMessageOut])
def get_messages(limit: int = 50) -> list[ChatMessageOut]:
    """Fetch the last N chat messages for initial load."""
    limit = min(limit, MAX_MESSAGES)
    msgs = _load_messages(limit)
    return [ChatMessageOut(**m) for m in msgs]