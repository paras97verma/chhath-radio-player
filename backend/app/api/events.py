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
import time
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Request, Query
from fastapi.responses import StreamingResponse

from app.services.presence_service import (
    record_heartbeat,
    get_listener_count,
    remove_session,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["events"])

# How often to push a listener count update (seconds)
PUSH_INTERVAL = 5

# How often to send a keepalive heartbeat even if count hasn't changed (seconds)
HEARTBEAT_INTERVAL = 30


async def _sse_stream(request: Request, session_id: str) -> AsyncGenerator[str, None]:
    """
    Async generator that yields SSE-formatted strings.

    Lifecycle:
      1. Record initial heartbeat (increments listener count).
      2. Push current listener count immediately.
      3. Loop: push count every PUSH_INTERVAL seconds.
      4. On disconnect (client closes tab / navigates away), remove session.
    """
    # Register this session
    record_heartbeat(session_id)
    logger.info("SSE connect: session=%s", session_id)

    last_count = -1
    last_heartbeat = time.time()

    try:
        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            now = time.time()

            # Refresh heartbeat in Redis
            record_heartbeat(session_id)

            # Get current count
            count = get_listener_count()

            # Push count if changed or on heartbeat interval
            if count != last_count or (now - last_heartbeat) >= HEARTBEAT_INTERVAL:
                payload = json.dumps({"type": "listeners", "count": count})
                # Named event so frontend EventSource.addEventListener("listener_count", ...)
                # can distinguish it from other event types.
                yield f"event: listener_count\ndata: {payload}\n\n"
                last_count = count
                last_heartbeat = now

            # Wait before next check
            await asyncio.sleep(PUSH_INTERVAL)

    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.error("SSE stream error for session=%s: %s", session_id, exc)
    finally:
        # Clean up: decrement listener count
        remove_session(session_id)
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
    session_id: str = Query(..., description="Unique anonymous session ID (UUID)"),
) -> StreamingResponse:
    return StreamingResponse(
        _sse_stream(request, session_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable Nginx buffering
            "Connection": "keep-alive",
        },
    )