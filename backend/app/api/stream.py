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
import math
from typing import Literal, Optional
from fastapi import APIRouter, HTTPException, Query, Header, status, BackgroundTasks, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from app.core.redis import get_redis_client
from app.services.stream_cache_service import STREAM_METRICS_KEY, StreamCacheService
from app.services.queue_prewarmer import CatalogReconciliationService, QueuePrewarmer
from app.core.config import settings

router = APIRouter(prefix="/api", tags=["stream"])
NO_STORE_HEADERS = {"Cache-Control": "no-store, max-age=0"}


class SourceFailureReport(BaseModel):
    video_id: str = Field(min_length=5, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    mode: Literal["direct", "proxy"]
    provider: str = Field(min_length=1, max_length=200)
    generation: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=120)


@router.get("/stream")
def get_stream(
    response: Response,
    v: str = Query(..., min_length=5, max_length=32, description="YouTube Video ID"),
    priority: str = Query("high", description="Resolution priority: high (user-selected) or normal (background)"),
    force_fresh: bool = Query(False, description="Bypass cache and force upstream re-extraction"),
):
    """
    Resolves a direct playable audio stream URL for a given YouTube video ID.
    Leverages Redis L2 caching and single-flight lock to support 10,000+ concurrent listeners.
    Returns in 1-2ms on cache hit.
    """
    response.headers.update(NO_STORE_HEADERS)

    stream = StreamCacheService.get_stream(v, priority=priority, force_fresh=force_fresh)
    if not stream:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"error": "stream_unavailable", "retryable": True},
            headers=NO_STORE_HEADERS,
        )

    if not isinstance(stream, dict):
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"error": "stream_unavailable", "retryable": True},
            headers=NO_STORE_HEADERS,
        )

    schema_version = stream.get("schema_version")
    generation = stream.get("generation")
    refreshed_at = stream.get("refreshed_at")
    sources = stream.get("sources")
    is_current = (
        isinstance(schema_version, int)
        and not isinstance(schema_version, bool)
        and schema_version == 1
        and stream.get("video_id") == v
        and isinstance(generation, int)
        and not isinstance(generation, bool)
        and generation > 0
        and isinstance(refreshed_at, (int, float))
        and not isinstance(refreshed_at, bool)
        and math.isfinite(refreshed_at)
        and isinstance(sources, list)
        and len(sources) > 0
    )
    if not is_current:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"error": "stream_unavailable", "retryable": True},
            headers=NO_STORE_HEADERS,
        )
    return stream


@router.post("/stream/source-failure")
def report_source_failure(response: Response, report: SourceFailureReport):
    """Record aggregate telemetry only for the currently cached generation."""
    response.headers.update(NO_STORE_HEADERS)
    current = StreamCacheService.get_stream_fast(report.video_id)
    if not current or current.get("generation") != report.generation:
        return {"recorded": False, "stale": True}

    sources = current.get("sources") or []
    matching_source = any(
        isinstance(source, dict)
        and source.get("mode") == report.mode
        and (source.get("provider_origin") or source.get("provider")) == report.provider
        for source in sources
    )
    if not matching_source:
        return {"recorded": False, "stale": True}

    recorded = False
    try:
        redis_client = get_redis_client()
        if redis_client:
            redis_client.hincrby(STREAM_METRICS_KEY, f"source_failure_{report.mode}", 1)
            recorded = True
    except Exception:
        pass
    return {"recorded": recorded, "stale": False}


@router.get("/stream/catalog/status")
def get_catalog_status(
    token: Optional[str] = Query(None, description="Admin secret key token"),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
    authorization: Optional[str] = Header(None),
):
    """
    Returns complete internal catalog readiness, metadata sync, stream readiness,
    and distributed worker status.
    Guarded by either SECRET_KEY or an Admin JWT Bearer token.
    """
    is_authorized = False
    secret = x_admin_secret or token
    expected = settings.SECRET_KEY
    if secret and expected and secret == expected:
        is_authorized = True

    if not is_authorized and authorization and authorization.startswith("Bearer "):
        jwt_token = authorization[7:].strip()
        try:
            from app.auth.security import decode_access_token
            payload = decode_access_token(jwt_token)
            if payload and payload.get("sub"):
                is_authorized = True
        except Exception:
            pass

    if not is_authorized:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: requires valid admin secret key or JWT token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return CatalogReconciliationService.get_catalog_readiness_status()


@router.api_route("/stream/cache/flush", methods=["GET", "POST"])
async def flush_stream_cache(
    background_tasks: BackgroundTasks,
    v: Optional[str] = Query(None, description="Optional YouTube Video ID to flush specifically"),
    source: Optional[str] = Query("all", description="Source to invalidate: 'direct' (downgrades to proxy) or 'all'"),
    token: Optional[str] = Query(None, description="Admin secret key token"),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
    authorization: Optional[str] = Header(None),
):
    """
    Flushes stream cache entries from L1 in-memory and L2 Redis.
    Guarded by SECRET_KEY validation, Admin JWT Bearer, or client reporting a broken video ID.
    Triggers a background catalog reconciliation pass to re-seed fresh, unexpired URLs.
    """
    is_authorized = False
    secret = x_admin_secret or token
    expected = settings.SECRET_KEY
    if secret and expected and secret == expected:
        is_authorized = True

    if not is_authorized and authorization and authorization.startswith("Bearer "):
        jwt_token = authorization[7:].strip()
        try:
            from app.auth.security import decode_access_token
            payload = decode_access_token(jwt_token)
            if payload and payload.get("sub"):
                is_authorized = True
        except Exception:
            pass

    # Allow client to safely report and flush a specific broken video ID (e.g. 403 on playback)
    if not is_authorized and v and len(v) >= 5:
        is_authorized = True

    if not is_authorized:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: invalid admin secret key or JWT.",
        )

    if v and source == "direct":
        StreamCacheService.invalidate_stream(v, source_type="direct")
        deleted_count = 1
    else:
        deleted_count = StreamCacheService.flush_stream_cache(video_id=v)

    # Re-warm in background task
    if v:
        async def rewarm_specific():
            await asyncio.sleep(0.5)
            await CatalogReconciliationService.warm_specific_songs([v])
        background_tasks.add_task(rewarm_specific)
    else:
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
