"""
Secure Admin API routes for song management.
All endpoints require a valid JWT Bearer token.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
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