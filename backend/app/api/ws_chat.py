"""
Chhath Radio — WebSocket Chat Endpoint

GET /api/ws/chat?session_id=<uuid>

Replaces the SSE-based chat relay that was embedded in events.py.
All connected clients share a single in-process set (_ws_clients), which
works correctly with a single Gunicorn worker (Render free tier).

Protocol (JSON messages):

  Server → Client:
    {"type": "history", "messages": [...]}
        Sent immediately on connect. Contains the last 200 messages
        loaded from Redis (or the in-memory deque if Redis is unavailable).

    {"type": "chat_message", "id": "...", "name": "...", "text": "...", "ts": 0}
        Broadcast to all connected clients when a new message arrives,
        whether sent via WebSocket or via POST /api/chat/messages.

    {"type": "error", "detail": "..."}
        Sent to the offending client only (rate limit, validation failure).

  Client → Server:
    {"name": "optional display name", "text": "message text (max 200 chars)"}
        Send a chat message. Name is optional; a random bhakti-style name
        is assigned if omitted or empty.

Rate limiting:
  In-memory dict shared with chat.py (_rate_limit). 1 message per 3 seconds per IP.
"""

import logging
import re
import time
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.api.chat import (
    _store_message,
    _load_messages,
    _rate_limit,
    RATE_LIMIT_SECONDS,
    _random_name,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ws", tags=["websocket"])

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# All connected WebSocket clients (in-process, single worker)
_ws_clients: set[WebSocket] = set()


async def broadcast(msg: dict) -> None:
    """
    Push a JSON message to all connected WebSocket clients.
    Silently removes clients that have disconnected without a clean close.
    Called by ws_chat endpoint AND by chat.py POST /api/chat/messages.
    """
    dead: list[WebSocket] = []
    for ws in list(_ws_clients):
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_clients.discard(ws)


@router.websocket("/chat")
async def ws_chat(
    websocket: WebSocket,
    session_id: str = Query(..., min_length=36, max_length=36),
) -> None:
    """
    WebSocket endpoint for live chat.

    Lifecycle:
      1. Validate session_id format (UUID v4).
      2. Accept connection and register in _ws_clients.
      3. Send chat history (last 200 messages from Redis / deque).
      4. Loop: receive messages, validate, rate-limit, store, broadcast.
      5. On disconnect: remove from _ws_clients.
    """
    # Validate session_id format before accepting
    if not _UUID_RE.match(session_id):
        await websocket.close(code=1008)  # 1008 = Policy Violation
        return

    await websocket.accept()
    _ws_clients.add(websocket)
    logger.info(
        "WS chat connect: session=%s, total_clients=%d", session_id, len(_ws_clients)
    )

    # Send history on connect (from Redis, falls back to in-memory deque)
    history = _load_messages(200)
    await websocket.send_json({"type": "history", "messages": history})

    try:
        while True:
            # receive_json() raises WebSocketDisconnect on client close
            data = await websocket.receive_json()

            # ── Ignore keep-alive pings from the client ───────────────────────
            # The frontend sends {"ping": true} every 20 s to keep the Render
            # free-tier WebSocket alive. Silently skip — no response needed.
            if data.get("ping"):
                continue

            # ── Validate input ────────────────────────────────────────────────
            text = str(data.get("text", "")).strip()
            name = str(data.get("name", "")).strip()
            # _nonce is a client-generated token used to identify own echoes.
            # Pass it through in the broadcast so the sender can mark the message as theirs.
            nonce = str(data.get("_nonce", ""))[:64] if data.get("_nonce") else None

            if not text:
                await websocket.send_json(
                    {"type": "error", "detail": "Message text cannot be empty."}
                )
                continue
            if len(text) > 200:
                await websocket.send_json(
                    {"type": "error", "detail": "Message too long (max 200 chars)."}
                )
                continue
            if len(name) > 40:
                name = name[:40]
            name = name or _random_name()

            # ── Rate limit (in-memory, per IP) ────────────────────────────────
            client_ip = websocket.client.host if websocket.client else "unknown"
            now = time.time()
            last = _rate_limit.get(client_ip, 0)
            if now - last < RATE_LIMIT_SECONDS:
                await websocket.send_json({
                    "type": "error",
                    "detail": f"Please wait {RATE_LIMIT_SECONDS:.0f}s between messages.",
                })
                continue
            _rate_limit[client_ip] = now

            # Clean up old rate limit entries (keep dict small)
            if len(_rate_limit) > 10_000:
                cutoff = now - 60
                for ip in [k for k, v in _rate_limit.items() if v < cutoff]:
                    del _rate_limit[ip]

            # ── Store and broadcast ───────────────────────────────────────────
            msg = {
                "id": str(uuid.uuid4()),
                "name": name,
                "text": text,
                "ts": int(now),
            }
            _store_message(msg)
            broadcast_payload: dict = {"type": "chat_message", **msg}
            if nonce:
                broadcast_payload["_nonce"] = nonce
            await broadcast(broadcast_payload)
            logger.info("WS chat msg from %s: %s", name, text[:40])

    except WebSocketDisconnect:
        pass  # clean disconnect
    except Exception as exc:
        logger.error("WS chat error session=%s: %s", session_id, exc)
    finally:
        _ws_clients.discard(websocket)
        logger.info(
            "WS chat disconnect: session=%s, total_clients=%d",
            session_id,
            len(_ws_clients),
        )