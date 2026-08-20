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
import urllib.parse
import urllib.request
import uuid
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.models.song import Song
from app.schemas.song import SongCreate, SongUpdate, extract_youtube_video_id
from app.core.redis import get_redis_client as _get_redis

logger = logging.getLogger(__name__)

# ─── Cache config ─────────────────────────────────────────────────────────────

QUEUE_CACHE_KEY = "chhath:queue"
QUEUE_CACHE_TTL = 2_592_000  # 30 days — safe because cache is explicitly invalidated on every admin write (create/update/delete)


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


def fetch_yt_metadata(yt_id: str) -> dict:
    """Fetch title and artist from YouTube oEmbed API."""
    url = f"https://www.youtube.com/watch?v={yt_id}"
    oembed = f"https://www.youtube.com/oembed?url={urllib.parse.quote(url, safe=':/=?&')}&format=json"
    try:
        req = urllib.request.Request(oembed, headers={"User-Agent": "ChhathRadio/1.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        raw_title = data.get("title", "").strip() or f"Chhath Song ({yt_id})"
        raw_artist = data.get("author_name", "").strip() or "Chhath Singer"
        return {"title": raw_title, "artist": raw_artist}
    except Exception:
        return {"title": f"Chhath Song ({yt_id})", "artist": "Chhath Radio"}


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
        Create a new song idempotently.
        If a song with the same youtube_video_id exists, returns the existing record.
        Auto-assigns unique sort_order and auto-fetches title/artist if not provided.
        """
        video_id = extract_youtube_video_id(data.youtube_url)
        if not video_id:
            raise ValueError("Could not extract YouTube video ID from the provided URL.")

        # Idempotency check: Return existing song if video_id is already in DB
        existing = db.scalar(select(Song).where(Song.youtube_video_id == video_id))
        if existing and isinstance(existing, Song):
            logger.info("Song with video_id '%s' already exists (id=%s) — returning existing.", video_id, existing.id)
            return existing

        title = data.title.strip() if data.title and data.title.strip() else None
        artist = data.artist.strip() if data.artist and data.artist.strip() else None

        if not title or not artist:
            meta = fetch_yt_metadata(video_id)
            if not title:
                title = meta["title"]
            if not artist:
                artist = meta["artist"]

        # Always auto-increment sort_order to ensure no duplicates
        max_order = db.scalar(select(func.max(Song.sort_order)))
        sort_order = (max_order or 0) + 1

        song = Song(
            title=title,
            artist=artist,
            youtube_video_id=video_id,
            youtube_url=data.youtube_url,
            category=data.category,
            sort_order=sort_order,
            enabled=True,
        )
        db.add(song)
        db.commit()
        db.refresh(song)
        _cache_delete(QUEUE_CACHE_KEY)
        return song

    @staticmethod
    def create_batch(db: Session, urls: list[str]) -> list[Song]:
        """
        Process a list of YouTube URLs idempotently.
        Skips existing songs and assigns sequential auto-increment sort_orders.
        """
        results: list[Song] = []
        for raw_url in urls:
            cleaned = raw_url.strip()
            if not cleaned:
                continue
            v_id = extract_youtube_video_id(cleaned)
            if not v_id:
                continue
            song = SongService.create(db, SongCreate(youtube_url=cleaned))
            if song not in results:
                results.append(song)
        return results

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