"""
Business logic for Song management.
Handles YouTube URL parsing, CRUD operations, and queue generation.

Scale additions:
  - get_radio_queue() is cached in Redis for QUEUE_CACHE_TTL seconds.
    Cache is invalidated on any write (create / update / delete).
  - Falls back to DB transparently if Redis is unavailable.
"""

import json
import logging
import uuid
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.song import Song
from app.schemas.song import SongCreate, SongUpdate, extract_youtube_video_id
from app.services.presence_service import _get_client as _get_redis

logger = logging.getLogger(__name__)

# ─── Cache config ─────────────────────────────────────────────────────────────

QUEUE_CACHE_KEY = "chhath:queue"
QUEUE_CACHE_TTL = 30  # seconds — short enough to reflect admin changes quickly


def _cache_get(key: str) -> Optional[list]:
    """Return cached JSON list or None."""
    try:
        client = _get_redis()
        if client is None:
            return None
        raw = client.get(key)
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.warning("Cache GET failed: %s", exc)
    return None


def _cache_set(key: str, value: list, ttl: int) -> None:
    """Serialize and cache a list."""
    try:
        client = _get_redis()
        if client is None:
            return
        client.setex(key, ttl, json.dumps(value))
    except Exception as exc:
        logger.warning("Cache SET failed: %s", exc)


def _cache_delete(key: str) -> None:
    """Invalidate a cache key."""
    try:
        client = _get_redis()
        if client is None:
            return
        client.delete(key)
    except Exception as exc:
        logger.warning("Cache DELETE failed: %s", exc)


def _song_to_dict(song: Song) -> dict:
    """Serialize a Song ORM object to a plain dict for caching."""
    return {
        "id": str(song.id),
        "title": song.title,
        "artist": song.artist,
        "youtube_video_id": song.youtube_video_id,
        "youtube_url": song.youtube_url,
        "category": song.category,
        "sort_order": song.sort_order,
        "enabled": song.enabled,
    }


class SongService:

    @staticmethod
    def get_all_enabled(db: Session) -> list[Song]:
        """Return all enabled songs ordered by sort_order."""
        stmt = (
            select(Song)
            .where(Song.enabled == True)
            .order_by(Song.sort_order.asc(), Song.title.asc())
        )
        return list(db.scalars(stmt).all())

    @staticmethod
    def get_all(db: Session) -> list[Song]:
        """Return ALL songs (admin use). Ordered by sort_order."""
        stmt = select(Song).order_by(Song.sort_order.asc(), Song.title.asc())
        return list(db.scalars(stmt).all())

    @staticmethod
    def get_by_id(db: Session, song_id: uuid.UUID) -> Song | None:
        return db.get(Song, song_id)

    @staticmethod
    def create(db: Session, data: SongCreate) -> Song:
        """
        Create a new song.
        Parses the YouTube URL to extract the 11-character video ID.
        Invalidates the queue cache.
        """
        video_id = extract_youtube_video_id(data.youtube_url)
        if not video_id:
            raise ValueError("Could not extract YouTube video ID from the provided URL.")

        song = Song(
            title=data.title,
            artist=data.artist,
            youtube_video_id=video_id,
            youtube_url=data.youtube_url,
            category=data.category,
            sort_order=data.sort_order,
            enabled=True,
        )
        db.add(song)
        db.commit()
        db.refresh(song)
        _cache_delete(QUEUE_CACHE_KEY)
        return song

    @staticmethod
    def update(db: Session, song: Song, data: SongUpdate) -> Song:
        """Partially update a song. Only provided fields are changed.
        Invalidates the queue cache."""
        update_data = data.model_dump(exclude_unset=True)

        if "youtube_url" in update_data and update_data["youtube_url"]:
            video_id = extract_youtube_video_id(update_data["youtube_url"])
            if not video_id:
                raise ValueError("Could not extract YouTube video ID from the provided URL.")
            update_data["youtube_video_id"] = video_id

        for field, value in update_data.items():
            setattr(song, field, value)

        db.commit()
        db.refresh(song)
        _cache_delete(QUEUE_CACHE_KEY)
        return song

    @staticmethod
    def delete(db: Session, song: Song) -> None:
        """Permanently delete a song. Invalidates the queue cache."""
        db.delete(song)
        db.commit()
        _cache_delete(QUEUE_CACHE_KEY)

    @staticmethod
    def get_radio_queue(db: Session) -> list[Song]:
        """
        Returns the deterministic queue for the default radio.
        Result is cached in Redis for QUEUE_CACHE_TTL seconds.

        Cache miss path: DB query → serialize → cache → return ORM objects.
        Cache hit path: deserialize dict list → return (no DB hit).

        Note: cache hit returns plain dicts, not ORM objects. Callers that
        need ORM relationships should use get_all_enabled() directly.
        """
        # Try cache first
        cached = _cache_get(QUEUE_CACHE_KEY)
        if cached is not None:
            # Return lightweight Song-like objects from cache
            # (sufficient for the radio queue endpoint which serialises to JSON)
            return cached  # type: ignore[return-value]

        # Cache miss — hit the DB
        songs = SongService.get_all_enabled(db)

        # Populate cache
        _cache_set(QUEUE_CACHE_KEY, [_song_to_dict(s) for s in songs], QUEUE_CACHE_TTL)

        return songs