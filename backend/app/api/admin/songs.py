"""
Secure Admin API routes for song management.
All endpoints require a valid JWT Bearer token.
"""
import uuid
from typing import Optional, Union, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.admin import Admin
from app.schemas.song import SongPublic, SongCreate, SongUpdate
from app.services.song_service import SongService
from app.auth.dependencies import get_current_admin

router = APIRouter(prefix="/api/admin/songs", tags=["admin-songs"])


@router.get("", response_model=list[SongPublic])
def list_all_songs(
    db: Session = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
) -> list:
    """
    GET /api/admin/songs
    Returns ALL songs (including disabled) for the admin dashboard.
    Requires JWT authentication.
    """
    return SongService.get_all(db)


class BatchSongsCreate(BaseModel):
    urls: str | list[str]


class SongReorderItem(BaseModel):
    id: uuid.UUID
    sort_order: int


class SongsReorderRequest(BaseModel):
    orders: list[SongReorderItem]


@router.post("/reorder", status_code=status.HTTP_200_OK)
def reorder_songs(
    body: SongsReorderRequest,
    db: Session = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
) -> dict:
    """
    POST /api/admin/songs/reorder
    Batch updates sort_order for multiple songs in a single fast transaction.
    Invalidates queue cache once upon commit, eliminating multiple concurrent PATCH roundtrips.
    """
    from app.models.song import Song
    from app.services.song_service import _cache_delete, QUEUE_CACHE_KEY

    try:
        for item in body.orders:
            song = db.get(Song, item.id)
            if song:
                song.sort_order = item.sort_order
        db.commit()
        _cache_delete(QUEUE_CACHE_KEY)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to reorder: {exc}")

    return {"status": "reordered", "count": len(body.orders)}


@router.post("", response_model=SongPublic, status_code=status.HTTP_201_CREATED)
def create_song(
    body: SongCreate,
    db: Session = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
) -> SongPublic:
    """
    POST /api/admin/songs
    Creates a new song. Parses the YouTube URL to extract the video ID.
    Requires JWT authentication.
    """
    try:
        song = SongService.create(db, body)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    return SongPublic.model_validate(song)


@router.post("/batch", response_model=list[SongPublic], status_code=status.HTTP_201_CREATED)
def create_songs_batch(
    body: BatchSongsCreate,
    db: Session = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
) -> list[SongPublic]:
    """
    POST /api/admin/songs/batch
    Batch upload multiple YouTube URLs. Idempotent — existing songs are skipped.
    """
    if isinstance(body.urls, list):
        urls_list = body.urls
    else:
        urls_list = [line.strip() for line in body.urls.replace(",", "\n").splitlines() if line.strip()]
    
    songs = SongService.create_batch(db, urls_list)
    return [SongPublic.model_validate(s) for s in songs]


@router.patch("/{song_id}", response_model=SongPublic)
def update_song(
    song_id: uuid.UUID,
    body: SongUpdate,
    db: Session = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
) -> SongPublic:
    """
    PATCH /api/admin/songs/{song_id}
    Partially updates a song. Only provided fields are changed.
    Requires JWT authentication.
    """
    song = SongService.get_by_id(db, song_id)
    if not song:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found.")
    try:
        updated = SongService.update(db, song, body)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    return SongPublic.model_validate(updated)


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_song(
    song_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
) -> None:
    """
    DELETE /api/admin/songs/{song_id}
    Permanently deletes a song.
    Requires JWT authentication.
    """
    song = SongService.get_by_id(db, song_id)
    if not song:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found.")
    SongService.delete(db, song)


@router.post("/reconcile", status_code=status.HTTP_200_OK)
async def trigger_catalog_reconciliation(
    _admin: Admin = Depends(get_current_admin),
) -> dict:
    """
    POST /api/admin/songs/reconcile
    Triggers an on-demand catalog reconciliation cycle.
    """
    import asyncio
    from app.services.queue_prewarmer import CatalogReconciliationService

    asyncio.create_task(CatalogReconciliationService.run_prewarmer_cycle())
    CatalogReconciliationService.invalidate_status_cache()
    return {"status": "reconciliation_triggered", "message": "Catalog reconciliation cycle started in background"}


class CacheRefreshRequest(BaseModel):
    video_ids: Optional[Union[str, List[str]]] = None


@router.post("/cache/refresh", status_code=status.HTTP_200_OK)
async def refresh_entire_catalog_cache(
    payload: Optional[CacheRefreshRequest] = None,
    video_ids: Optional[str] = Query(None, description="Optional comma/newline-separated video IDs to flush selectively"),
    _admin: Admin = Depends(get_current_admin),
) -> dict:
    """
    POST /api/admin/songs/cache/refresh
    - If video_ids is provided (via JSON body or query param): flushes only those specific tracks
      and starts re-warming them. Overall telemetry hit/miss metrics are strictly PRESERVED.
    - If video_ids is omitted: flushes the entire stream cache from L1 and L2,
      RESETS all telemetry metrics, and launches full catalog reconciliation.
    """
    import asyncio
    import re
    from app.services.stream_cache_service import StreamCacheService
    from app.services.queue_prewarmer import CatalogReconciliationService

    target_input = None
    if payload and payload.video_ids:
        target_input = payload.video_ids
    elif video_ids:
        target_input = video_ids

    # Parse and extract clean 11-char IDs
    clean_ids: List[str] = []
    if target_input:
        if isinstance(target_input, list):
            raw_list = target_input
        else:
            raw_list = re.split(r"[\s,\n\r;]+", str(target_input))
        seen = set()
        for item in raw_list:
            item = (item or "").strip()
            if not item:
                continue
            match = re.search(r"(?:v=|\/|be\/|embed\/)([0-9A-Za-z_-]{11})", item)
            vid = match.group(1) if match else item
            vid = vid.strip()
            if vid and len(vid) >= 5 and vid not in seen:
                seen.add(vid)
                clean_ids.append(vid)

    if clean_ids:
        flushed_count = StreamCacheService.flush_stream_cache(video_id=clean_ids)
        CatalogReconciliationService.invalidate_status_cache()
        asyncio.create_task(CatalogReconciliationService.warm_specific_songs(clean_ids))
        return {
            "status": "cache_refreshed",
            "target": "selective",
            "video_ids": clean_ids,
            "flushed_count": flushed_count,
            "message": f"Flushed {flushed_count} stream(s) for {len(clean_ids)} track(s). Re-warming started in background without resetting telemetry metrics.",
        }

    # Full catalog flush: resets telemetry
    flushed_count = StreamCacheService.flush_stream_cache()
    CatalogReconciliationService.invalidate_status_cache()
    asyncio.create_task(CatalogReconciliationService.run_prewarmer_cycle())

    return {
        "status": "cache_refreshed",
        "target": "entire_catalog",
        "flushed_count": flushed_count,
        "message": f"Flushed entire stream cache ({flushed_count} streams) and reset telemetry metrics. Full re-warming pass started.",
    }


@router.get("/status", status_code=status.HTTP_200_OK)
def get_admin_catalog_status(
    _admin: Admin = Depends(get_current_admin),
) -> dict:
    """
    GET /api/admin/songs/status
    Returns complete catalog readiness and telemetry metrics.
    """
    from app.services.queue_prewarmer import CatalogReconciliationService

    return CatalogReconciliationService.get_catalog_readiness_status()
