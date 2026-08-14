"""
SSE (Server-Sent Events) endpoint for real-time listener count and now-playing updates.

Why SSE instead of polling?
  At 1M concurrent listeners polling every 30s = 33,333 req/s just for presence.
  With SSE, each client holds one persistent connection. The server pushes updates
  only when the count changes (or every 30s as a keepalive heartbeat).
  This reduces presence-related load by ~99%.

Endpoint: GET /api/events
  - Client connects once and receives a stream of JSON events.
  - Connection is kept alive with periodic heartbeat events.
  - On disconnect, the session is removed from the presence counter.

Event types:
  {"type": "listeners", "count": N}
  {"type": "heartbeat", "ts": unix_timestamp}

Usage (frontend):
  const es = new EventSource('/api/events?session_id=...');
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'listeners') setCount(data.count);
  };
"""

import asyncio
import json
import re
import time
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import StreamingResponse

from app.services.presence_service import (
    record_heartbeat,
    get_listener_count,
)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["events"])

# How often to push a listener count update (seconds) — near-realtime.
# Lower = faster drop detection when a listener leaves.
PUSH_INTERVAL = 1

# How often to send a keepalive heartbeat even if count hasn't changed (seconds)
HEARTBEAT_INTERVAL = 15

# Chat message queue size per connection
CHAT_QUEUE_SIZE = 50


async def _sse_stream(request: Request, session_id: str) -> AsyncGenerator[str, None]:
    """
    Async generator that yields SSE-formatted strings.

    Lifecycle:
      1. Record initial heartbeat (increments listener count).
      2. Push current listener count immediately.
      3. Loop: push count every PUSH_INTERVAL seconds + relay chat messages.
      4. On disconnect (client closes tab / navigates away), remove session.
    """
    # Import here to avoid circular import (chat.py imports from events.py indirectly)
    from app.api.chat import register_chat_queue, unregister_chat_queue

    # Register this session
    record_heartbeat(session_id)
    logger.info("SSE connect: session=%s", session_id)

    # Register a chat queue for this connection
    chat_q: asyncio.Queue = asyncio.Queue(maxsize=CHAT_QUEUE_SIZE)
    register_chat_queue(chat_q)

    last_count = -1
    last_heartbeat = time.time()

    try:
        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            # Wait for a chat message OR timeout (whichever comes first).
            # This makes chat delivery instant: as soon as a message is put
            # into the queue, wait_for returns immediately instead of sleeping
            # for the full PUSH_INTERVAL.
            try:
                msg = await asyncio.wait_for(chat_q.get(), timeout=PUSH_INTERVAL)
                payload = json.dumps({"type": "chat_message", **msg})
                yield f"event: chat_message\ndata: {payload}\n\n"
                # Drain any additional messages that arrived while we were yielding
                while not chat_q.empty():
                    try:
                        extra = chat_q.get_nowait()
                        payload = json.dumps({"type": "chat_message", **extra})
                        yield f"event: chat_message\ndata: {payload}\n\n"
                    except asyncio.QueueEmpty:
                        break
            except asyncio.TimeoutError:
                pass  # No chat message arrived — fall through to count/heartbeat

            now = time.time()

            # Refresh heartbeat in Redis
            record_heartbeat(session_id)

            # Get current count
            count = get_listener_count()

            # Push count if changed or on heartbeat interval
            if count != last_count or (now - last_heartbeat) >= HEARTBEAT_INTERVAL:
                payload = json.dumps({"type": "listeners", "count": count})
                yield f"event: listener_count\ndata: {payload}\n\n"
                last_count = count
                last_heartbeat = now

    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.error("SSE stream error for session=%s: %s", session_id, exc)
    finally:
        # Do NOT call remove_session here — the same session_id may be open in
        # another tab. Let the TTL (SESSION_TTL_SECONDS) handle natural expiry.
        # The session will expire within SESSION_TTL_SECONDS of the last heartbeat.
        unregister_chat_queue(chat_q)
        logger.info("SSE disconnect: session=%s", session_id)


@router.get(
    "/events",
    summary="SSE stream for real-time listener count",
    description=(
        "Server-Sent Events stream. Connect once; receive listener count updates "
        "every 15 seconds. Session is automatically cleaned up on disconnect."
    ),
    response_class=StreamingResponse,
)
async def sse_events(
    request: Request,
    session_id: str = Query(..., min_length=36, max_length=36, description="Unique anonymous session ID (UUID v4)"),
) -> StreamingResponse:
    if not _UUID_RE.match(session_id):
        raise HTTPException(status_code=422, detail="session_id must be a valid UUID")
    return StreamingResponse(
        _sse_stream(request, session_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable Nginx buffering
            "Connection": "keep-alive",
        },
    )