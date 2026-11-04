"""
Stream Resolution API Route

GET /api/stream?v={videoId}&priority={high|normal}
High-concurrency stream resolution backed by Redis caching and single-flight coalescing.
Direct-first, proxy-fallback with instant cache lookup (< 2ms).

POST /api/stream/cache/flush
Flushes stream cache entries from L1 in-memory and L2 Redis.

GET /api/stream/catalog/status
Returns catalog readiness and observability metrics.
"""

import asyncio
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Header, status, BackgroundTasks
from app.services.stream_cache_service import StreamCacheService
from app.services.queue_prewarmer import CatalogReconciliationService, QueuePrewarmer
from app.core.config import settings

router = APIRouter(prefix="/api", tags=["stream"])


@router.get("/stream")
def get_stream(
    v: str = Query(..., min_length=5, max_length=32, description="YouTube Video ID"),
    priority: str = Query("high", description="Resolution priority: high (user-selected) or normal (background)"),
):
    """
    Resolves a direct playable audio stream URL for a given YouTube video ID.
    Leverages Redis L2 caching and single-flight lock to support 10,000+ concurrent listeners.
    Returns in 1-2ms on cache hit.
    """
    stream = StreamCacheService.get_stream(v, priority=priority)
    if not stream:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to resolve playable audio stream for video '{v}'.",
        )

    return stream


@router.get("/stream/catalog/status")
def get_catalog_status(
    token: Optional[str] = Query(None, description="Admin secret key token"),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
):
    """
    Returns complete internal catalog readiness, metadata sync, stream readiness,
    and distributed worker status. Guarded by SECRET_KEY validation.
    """
    secret = x_admin_secret or token
    expected = settings.SECRET_KEY
    if not secret or (expected and secret != expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: invalid admin secret key.",
        )

    return CatalogReconciliationService.get_catalog_readiness_status()


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
    Triggers a background catalog reconciliation pass to re-seed fresh, unexpired URLs.
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
        await CatalogReconciliationService.run_prewarmer_cycle()

    background_tasks.add_task(rewarm)

    return {
        "status": "ok",
        "flushed_count": deleted_count,
        "video_id": v or "ALL",
        "prewarmer_triggered": True,
    }
