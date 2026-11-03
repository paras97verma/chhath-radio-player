"""
Stream Resolution API Route

GET /api/stream?v={videoId}
High-concurrency stream resolution backed by Redis caching and single-flight coalescing.
"""

from fastapi import APIRouter, HTTPException, Query, status
from app.services.stream_cache_service import StreamCacheService

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

