"""
Stream Resolution API Route

GET /api/stream?v={videoId}
High-concurrency stream resolution backed by Redis caching and single-flight coalescing.

POST /api/stream/cache/flush
Flushes stream cache entries from L1 in-memory and L2 Redis.
"""

import asyncio
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Header, status, BackgroundTasks
from app.services.stream_cache_service import StreamCacheService
from app.services.queue_prewarmer import QueuePrewarmer
from app.core.config import settings

router = APIRouter(prefix="/api", tags=["stream"])


@router.get("/stream")
def get_stream(
    v: str = Query(..., min_length=5, max_length=32, description="YouTube Video ID"),
):
    """
    Resolves a direct playable audio stream URL for a given YouTube video ID.
    Leverages Redis L2 caching and single-flight lock to support 10,000+ concurrent listeners.
    """
    stream = StreamCacheService.get_stream(v)
    if not stream:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to resolve playable audio stream for video '{v}'.",
        )

    return stream


@router.api_route("/stream/cache/flush", methods=["GET", "POST"])
async def flush_stream_cache(
    background_tasks: BackgroundTasks,
    v: Optional[str] = Query(None, description="Optional YouTube Video ID to flush specifically"),
    token: Optional[str] = Query(None, description="Admin secret key token"),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
):
    """
    Flushes stream cache entries from L1 in-memory and L2 Redis.
    Guarded by SECRET_KEY validation via X-Admin-Secret header or token query parameter.
    Triggers a background pre-warming pass to re-seed fresh, unexpired URLs.
    """
    secret = x_admin_secret or token
    expected = settings.SECRET_KEY
    if not secret or (expected and secret != expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: invalid admin secret key.",
        )

    deleted_count = StreamCacheService.flush_stream_cache(video_id=v)

    # Re-warm queue in background task
    async def rewarm():
        await asyncio.sleep(1.0)
        await QueuePrewarmer.run_prewarmer_cycle()

    background_tasks.add_task(rewarm)

    return {
        "status": "ok",
        "flushed_count": deleted_count,
        "video_id": v or "ALL",
        "prewarmer_triggered": True,
    }

