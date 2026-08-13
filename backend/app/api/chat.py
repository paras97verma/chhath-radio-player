"""
Chhath Radio — Live Chat API

Endpoints:
  POST /api/chat/messages  — Send a chat message (anonymous)
  GET  /api/chat/messages  — Fetch last N messages (initial load)

Messages are stored in Redis as a capped list (max 100).
New messages are broadcast to all active SSE connections via a
module-level asyncio.Queue registry (imported by events.py).

Rate limiting: 1 message per 3 seconds per IP (in-memory).
"""

import asyncio
import json
import logging
import time
import uuid
import random
from typing import Any, Optional

import redis as redis_lib
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

# ─── Redis key ────────────────────────────────────────────────────────────────
CHAT_KEY = "chhath:chat:messages"
MAX_MESSAGES = 100

# ─── Rate limiting (in-memory, per IP) ───────────────────────────────────────
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

# ─── Broadcaster registry (shared with events.py) ────────────────────────────
# Each SSE connection registers an asyncio.Queue here.
# When a chat message arrives, it's pushed to all queues.
_chat_queues: set[asyncio.Queue] = set()

def register_chat_queue(q: asyncio.Queue) -> None:
    _chat_queues.add(q)

def unregister_chat_queue(q: asyncio.Queue) -> None:
    _chat_queues.discard(q)

async def broadcast_message(msg: dict[str, Any]) -> None:
    """Push a chat message to all active SSE connections."""
    dead: list[asyncio.Queue] = []
    for q in list(_chat_queues):
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _chat_queues.discard(q)

# ─── Redis helpers ────────────────────────────────────────────────────────────

def _get_redis() -> Optional[redis_lib.Redis]:
    """Get a Redis client using the same pool as presence_service."""
    try:
        pool = redis_lib.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=20,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        return redis_lib.Redis(connection_pool=pool)
    except Exception as exc:
        logger.warning("Redis connection failed: %s", exc)
        return None

# In-memory fallback when Redis is unavailable
_memory_messages: list[dict[str, Any]] = []

def _store_message(msg: dict[str, Any]) -> None:
    """Store message in Redis capped list, fall back to memory."""
    try:
        r = _get_redis()
        if r:
            r.lpush(CHAT_KEY, json.dumps(msg))
            r.ltrim(CHAT_KEY, 0, MAX_MESSAGES - 1)
            return
    except Exception as exc:
        logger.warning("Redis chat store failed: %s", exc)
    # Memory fallback
    _memory_messages.insert(0, msg)
    if len(_memory_messages) > MAX_MESSAGES:
        _memory_messages.pop()

def _load_messages(limit: int = 50) -> list[dict[str, Any]]:
    """Load last N messages from Redis (newest first → reverse for display)."""
    try:
        r = _get_redis()
        if r:
            raw = r.lrange(CHAT_KEY, 0, limit - 1)
            msgs = [json.loads(m) for m in raw]
            return list(reversed(msgs))  # oldest first for display
    except Exception as exc:
        logger.warning("Redis chat load failed: %s", exc)
    # Memory fallback
    return list(reversed(_memory_messages[:limit]))

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

    # Rate limit check
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
    await broadcast_message(msg)

    logger.info("Chat message from %s: %s", name, msg["text"][:40])
    return ChatMessageOut(**msg)


@router.get("/messages", response_model=list[ChatMessageOut])
def get_messages(limit: int = 50) -> list[ChatMessageOut]:
    """Fetch the last N chat messages for initial load."""
    limit = min(limit, MAX_MESSAGES)
    msgs = _load_messages(limit)
    return [ChatMessageOut(**m) for m in msgs]