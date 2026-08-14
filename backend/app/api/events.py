"""
SSE (Server-Sent Events) endpoint for real-time listener count updates.

Why SSE for listener count?
  SSE is server-push only, auto-reconnects on disconnect, and requires zero
  client-side reconnect logic. Perfect for a one-way "N listeners" counter.

Why not SSE for chat?
  Chat is now handled by the WebSocket endpoint at /api/ws/chat (ws_chat.py).
  WebSocket is bidirectional — clients send messages over the same connection
  instead of a separate POST request.

Endpoint: GET /api/events
  - Client connects once and receives a stream of listener count events.
  - Connection is kept alive with periodic heartbeat events.
  - On disconnect, the session expires naturally via SESSION_TTL_SECONDS.

Event types:
  {"type": "listeners", "count": N}   — pushed when count changes or on heartbeat

Usage (frontend):
  const es = new EventSource('/api/events?session_id=...');
  es.addEventListener('listener_count', (e) => {
    const data = JSON.parse(e.data);
    setCount(data.count);
  });
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
    get_last_known_count,
)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["events"])

# How often to push a listener count update (seconds) — near-realtime.
PUSH_INTERVAL = 1

# How often to send a keepalive heartbeat even if count hasn't changed (seconds)
HEARTBEAT_INTERVAL = 15


async def _sse_stream(request: Request, session_id: str) -> AsyncGenerator[str, None]:
    """
    Async generator that yields SSE-formatted strings.

    Lifecycle:
      1. Record initial heartbeat (registers session in presence service).
      2. Push current listener count immediately (uses last-known from Redis
         as a display fallback if no real sessions have reconnected yet after
         a server restart).
      3. Loop: sleep PUSH_INTERVAL, refresh heartbeat, push count if changed
         or on HEARTBEAT_INTERVAL keepalive.
      4. On disconnect (client closes tab / navigates away), exit loop.
    """
    record_heartbeat(session_id)
    logger.info("SSE connect: session=%s", session_id)

    # Use last-known count as initial value to avoid "0 listeners" flash
    # immediately after a deploy (before clients have reconnected).
    initial_count = get_listener_count() or get_last_known_count()
    last_count = initial_count
    last_heartbeat = time.time()

    # Push initial count immediately on connect
    payload = json.dumps({"type": "listeners", "count": initial_count})
    yield f"event: listener_count\ndata: {payload}\n\n"

    try:
        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            await asyncio.sleep(PUSH_INTERVAL)
            now = time.time()

            # Refresh heartbeat (keeps session alive in presence service)
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
        logger.info("SSE disconnect: session=%s", session_id)


@router.get(
    "/events",
    summary="SSE stream for real-time listener count",
    description=(
        "Server-Sent Events stream. Connect once; receive listener count updates "
        "whenever the count changes (or every 15 seconds as a keepalive). "
        "Chat messages are delivered via WebSocket at /api/ws/chat."
    ),
    response_class=StreamingResponse,
)
async def sse_events(
    request: Request,
    session_id: str = Query(
        ...,
        min_length=36,
        max_length=36,
        description="Unique anonymous session ID (UUID v4)",
    ),
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