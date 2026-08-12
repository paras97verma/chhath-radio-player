"""
Public API routes for songs and the radio queue.
No authentication required.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.song import SongPublic
from app.services.song_service import SongService

router = APIRouter(prefix="/api/songs", tags=["songs"])


@router.get("", response_model=list[SongPublic])
def list_enabled_songs(db: Session = Depends(get_db)) -> list:
    """
    GET /api/songs
    Returns all enabled songs ordered by sort_order.
    Public endpoint — no authentication required.
    """
    return SongService.get_all_enabled(db)