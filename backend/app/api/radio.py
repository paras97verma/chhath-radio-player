"""
Public API routes for the radio queue and channels.
No authentication required.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.database import get_db
from app.models.channel import Channel, ChannelSong
from app.models.song import Song
from app.models.festival import FestivalDay
from app.schemas.song import SongPublic
from app.schemas.channel import ChannelWithSongs
from app.schemas.festival import FestivalDayPublic
from app.services.song_service import SongService

router = APIRouter(prefix="/api", tags=["radio"])


@router.get("/radio/queue", response_model=list[SongPublic])
def get_radio_queue(db: Session = Depends(get_db)) -> list:
    """
    GET /api/radio/queue
    Returns the deterministic queue of enabled songs for the default radio,
    ordered by sort_order.
    """
    return SongService.get_radio_queue(db)


@router.get("/channels/{slug}", response_model=ChannelWithSongs)
def get_channel(slug: str, db: Session = Depends(get_db)) -> ChannelWithSongs:
    """
    GET /api/channels/{slug}
    Returns channel metadata and its curated list of enabled songs.
    """
    channel = db.scalar(
        select(Channel).where(Channel.slug == slug, Channel.enabled == True)
    )
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Channel '{slug}' not found.",
        )

    # Fetch enabled songs for this channel, ordered by channel_songs.sort_order
    songs = db.scalars(
        select(Song)
        .join(ChannelSong, ChannelSong.song_id == Song.id)
        .where(
            ChannelSong.channel_id == channel.id,
            Song.enabled == True,
        )
        .order_by(ChannelSong.sort_order.asc())
    ).all()

    return ChannelWithSongs(
        id=channel.id,
        name=channel.name,
        slug=channel.slug,
        enabled=channel.enabled,
        songs=[SongPublic.model_validate(s) for s in songs],
    )


@router.get("/festival/current", response_model=FestivalDayPublic | None)
def get_current_festival(db: Session = Depends(get_db)) -> FestivalDayPublic | None:
    """
    GET /api/festival/current
    Checks today's date against festival_days and returns the active festival state.
    Returns null if today is not a festival day.
    """
    today = date.today()
    festival_day = db.scalar(
        select(FestivalDay).where(FestivalDay.date == today)
    )
    return festival_day