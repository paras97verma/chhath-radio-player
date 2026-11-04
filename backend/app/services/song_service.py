"""
Business logic for Song management.
Handles YouTube URL parsing, CRUD operations, catalog-wide metadata synchronization, and queue generation.

Scale additions:
  - get_radio_queue() is cached in Redis for QUEUE_CACHE_TTL seconds.
    Cache is invalidated on any write (create / update / delete).
  - Falls back to DB transparently if Redis is unavailable.
  - Complete descriptive metadata (title, artist, duration, thumbnail) persisted to DB.
  - Automatic stream cache invalidation and priority prewarming on writes.
"""

import json
import logging
import os
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Optional, Any, Dict, List

from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.models.song import Song
from app.schemas.song import SongCreate, SongUpdate, extract_youtube_video_id
from app.core.redis import get_redis_client as _get_redis

logger = logging.getLogger(__name__)

# ─── Cache & Priority Queue Config ───────────────────────────────────────────

QUEUE_CACHE_KEY = "chhath:queue"
RECONCILER_PRIORITY_KEY = "chhath:queue:reconciler_priority"
# Cache TTL in seconds (default: 30 days). Set to 0 to bypass caching (e.g. for instant DB updates in dev).
QUEUE_CACHE_TTL = int(os.getenv("QUEUE_CACHE_TTL", "2592000"))


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


def enqueue_priority_warming(video_id: str) -> None:
    """Push a video ID to the background reconciler priority queue for immediate warming."""
    clean_id = (video_id or "").strip()
    if not clean_id:
        return
    try:
        client = _get_redis()
        if client is not None:
            client.lpush(RECONCILER_PRIORITY_KEY, clean_id)
            client.ltrim(RECONCILER_PRIORITY_KEY, 0, 999)
            logger.debug("[SongService] Enqueued %s for priority warming", clean_id)
    except Exception as exc:
        logger.warning("[SongService] Failed to enqueue priority warming for %s: %s", clean_id, exc)


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
        "duration_seconds": getattr(song, "duration_seconds", None),
        "thumbnail_url": getattr(song, "thumbnail_url", None),
        "metadata_status": getattr(song, "metadata_status", "pending"),
    }


def fetch_video_metadata(video_id: str) -> Dict[str, Any]:
    """
    Fetch comprehensive metadata for a YouTube video:
    Attempts Invidious instances first (for title, artist, duration, thumbnail),
    falling back to YouTube oEmbed API.
    """
    clean_id = (video_id or "").strip()
    if not clean_id:
        return {
            "title": "Chhath Song",
            "artist": "Traditional",
            "duration_seconds": None,
            "thumbnail_url": None,
        }

    # 0. Check if Redis already has prewarmed stream info (instant local resolution)
    try:
        client = _get_redis()
        if client:
            raw = client.get(f"chhath:stream:{clean_id}")
            if raw:
                s_dict = json.loads(raw)
                s_dur = s_dict.get("duration")
                s_title = s_dict.get("title")
                if s_dur and s_title:
                    return {
                        "title": s_title,
                        "artist": "Chhath Singer",
                        "duration_seconds": int(s_dur),
                        "thumbnail_url": f"https://i.ytimg.com/vi/{clean_id}/hqdefault.jpg",
                    }
    except Exception:
        pass

    # 1. Attempt Invidious instances for full metadata including duration (2.0s timeout)
    invidious_mirrors = [
        f"https://yt.chocolatemoo53.com/api/v1/videos/{clean_id}?fields=title,author,lengthSeconds,videoThumbnails",
        f"https://invidious.nerdvpn.de/api/v1/videos/{clean_id}?fields=title,author,lengthSeconds,videoThumbnails",
        f"https://inv.nadeko.net/api/v1/videos/{clean_id}?fields=title,author,lengthSeconds,videoThumbnails",
    ]

    for mirror in invidious_mirrors:
        try:
            req = urllib.request.Request(
                mirror,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ChhathRadio/1.0", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    title = (data.get("title") or "").strip()
                    artist = (data.get("author") or "").strip()
                    length_sec = data.get("lengthSeconds")
                    duration: Optional[int] = None
                    if length_sec is not None:
                        try:
                            duration = int(length_sec)
                        except (ValueError, TypeError):
                            pass

                    # Extract highest quality thumbnail
                    thumbs = data.get("videoThumbnails") or []
                    thumbnail_url: Optional[str] = None
                    if thumbs:
                        # Prioritize high or medium quality thumbnail
                        high_thumb = next((t["url"] for t in thumbs if t.get("quality") in ("high", "medium", "maxres")), None)
                        thumbnail_url = high_thumb or thumbs[0].get("url")
                    if not thumbnail_url:
                        thumbnail_url = f"https://i.ytimg.com/vi/{clean_id}/hqdefault.jpg"

                    if title:
                        return {
                            "title": title,
                            "artist": artist or "Chhath Singer",
                            "duration_seconds": duration,
                            "thumbnail_url": thumbnail_url,
                        }
        except Exception:
            continue

    # 2. Fallback to YouTube oEmbed (fast 2.0s timeout)
    url = f"https://www.youtube.com/watch?v={clean_id}"
    oembed = f"https://www.youtube.com/oembed?url={urllib.parse.quote(url, safe=':/=?&')}&format=json"
    try:
        req = urllib.request.Request(oembed, headers={"User-Agent": "ChhathRadio/1.0"})
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        raw_title = data.get("title", "").strip() or f"Chhath Song ({clean_id})"
        raw_artist = data.get("author_name", "").strip() or "Chhath Singer"
        thumb = data.get("thumbnail_url") or f"https://i.ytimg.com/vi/{clean_id}/hqdefault.jpg"
        return {
            "title": raw_title,
            "artist": raw_artist,
            "duration_seconds": None,
            "thumbnail_url": thumb,
        }
    except Exception:
        pass

    # 3. Final fallback
    return {
        "title": f"Chhath Song ({clean_id})",
        "artist": "Chhath Radio",
        "duration_seconds": None,
        "thumbnail_url": f"https://i.ytimg.com/vi/{clean_id}/mqdefault.jpg",
    }


def fetch_yt_metadata(yt_id: str) -> dict:
    """Backwards-compatible wrapper returning title and artist."""
    meta = fetch_video_metadata(yt_id)
    return {"title": meta["title"], "artist": meta["artist"]}


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
    def get_by_video_id(db: Session, video_id: str) -> Song | None:
        """Find a song by its 11-char YouTube video ID."""
        clean_id = (video_id or "").strip()
        if not clean_id:
            return None
        return db.scalar(select(Song).where(Song.youtube_video_id == clean_id))

    @staticmethod
    def get_catalog_batch(db: Session, limit: int = 50, offset: int = 0) -> list[Song]:
        """Return a paginated batch of enabled songs for catalog reconciliation."""
        stmt = (
            select(Song)
            .where(Song.enabled == True)
            .order_by(Song.sort_order.asc(), Song.id.asc())
            .limit(limit)
            .offset(offset)
        )
        return list(db.scalars(stmt).all())

    @staticmethod
    def get_total_enabled_count(db: Session) -> int:
        """Return the count of all enabled songs."""
        return db.scalar(select(func.count(Song.id)).where(Song.enabled == True)) or 0

    @staticmethod
    def sync_song_metadata(db: Session, song: Song, force: bool = False) -> bool:
        """
        Synchronizes descriptive metadata for a song from upstream Invidious/YouTube sources.
        Preserves manual edits unless values are empty or generic placeholders.
        Persists duration_seconds, thumbnail_url, and updates metadata_status.
        """
        now = datetime.now(timezone.utc)

        # Check freshness: if complete and synced within 24h, skip unless forced
        if not force and song.metadata_status == "complete" and song.duration_seconds is not None and song.last_metadata_sync:
            age = (now - song.last_metadata_sync).total_seconds()
            if age < 86400:
                return True

        meta = fetch_video_metadata(song.youtube_video_id)

        # Preserve custom titles unless title is empty or generic placeholder
        current_title = song.title.strip() if song.title else ""
        if not current_title or current_title.startswith("Chhath Song ("):
            if meta.get("title"):
                song.title = meta["title"]

        # Preserve custom artist unless artist is empty or generic placeholder
        current_artist = song.artist.strip() if song.artist else ""
        if not current_artist or current_artist in ("Chhath Radio", "Traditional", "Chhath Singer"):
            if meta.get("artist"):
                song.artist = meta["artist"]

        if meta.get("duration_seconds") is not None:
            song.duration_seconds = meta["duration_seconds"]

        if meta.get("thumbnail_url"):
            song.thumbnail_url = meta["thumbnail_url"]
        elif not song.thumbnail_url:
            song.thumbnail_url = f"https://i.ytimg.com/vi/{song.youtube_video_id}/hqdefault.jpg"

        song.last_metadata_sync = now
        song.metadata_status = "complete" if song.duration_seconds is not None else "incomplete"

        try:
            db.commit()
            db.refresh(song)
            _cache_delete(QUEUE_CACHE_KEY)
            return True
        except Exception as exc:
            db.rollback()
            logger.warning("[SongService] Failed to persist metadata sync for %s: %s", song.youtube_video_id, exc)
            return False

    @staticmethod
    def create(db: Session, data: SongCreate) -> Song:
        """
        Create a new song idempotently.
        If a song with the same youtube_video_id exists, returns the existing record.
        Auto-assigns unique sort_order, auto-fetches title/artist/duration/thumbnail,
        persists to DB, invalidates queue cache, and enqueues priority warming.
        """
        video_id = extract_youtube_video_id(data.youtube_url)
        if not video_id:
            raise ValueError("Could not extract YouTube video ID from the provided URL.")

        # Idempotency check: Return existing song if video_id is already in DB
        existing = db.scalar(select(Song).where(Song.youtube_video_id == video_id))
        if existing and isinstance(existing, Song):
            logger.info("Song with video_id '%s' already exists (id=%s) — returning existing.", video_id, existing.id)
            enqueue_priority_warming(video_id)
            return existing

        title = data.title.strip() if data.title and data.title.strip() else None
        artist = data.artist.strip() if data.artist and data.artist.strip() else None
        duration = data.duration_seconds
        thumbnail = data.thumbnail_url

        # Retrieve upstream metadata if any field is missing
        if not title or not artist or duration is None or not thumbnail:
            meta = fetch_video_metadata(video_id)
            if not title:
                title = meta.get("title") or f"Chhath Song ({video_id})"
            if not artist:
                artist = meta.get("artist") or "Chhath Singer"
            if duration is None:
                duration = meta.get("duration_seconds")
            if not thumbnail:
                thumbnail = meta.get("thumbnail_url") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

        # Always auto-increment sort_order to ensure no duplicates
        max_order = db.scalar(select(func.max(Song.sort_order)))
        sort_order = (max_order or 0) + 1
        now = datetime.now(timezone.utc)

        song = Song(
            title=title,
            artist=artist,
            youtube_video_id=video_id,
            youtube_url=data.youtube_url,
            category=data.category,
            sort_order=sort_order,
            enabled=True,
            duration_seconds=duration,
            thumbnail_url=thumbnail,
            metadata_status="complete" if duration is not None else "incomplete",
            last_metadata_sync=now,
        )
        db.add(song)
        db.commit()
        db.refresh(song)

        # Invalidate queue cache and schedule priority stream warming immediately
        _cache_delete(QUEUE_CACHE_KEY)
        enqueue_priority_warming(video_id)
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
        """
        Partially update a song. Only provided fields are changed.
        If youtube_url is changed:
          - Re-extracts video ID.
          - Evicts old and new stream caches.
          - Refetches descriptive metadata for the new video ID.
          - Enqueues immediate warming.
        """
        from app.services.stream_cache_service import StreamCacheService

        update_data = data.model_dump(exclude_unset=True)
        old_video_id = song.youtube_video_id
        new_video_id = None

        if "youtube_url" in update_data and update_data["youtube_url"]:
            new_video_id = extract_youtube_video_id(update_data["youtube_url"])
            if not new_video_id:
                raise ValueError("Could not extract YouTube video ID from the provided URL.")
            update_data["youtube_video_id"] = new_video_id

        # If video ID changed, refresh metadata and invalidate stream caches
        if new_video_id and new_video_id != old_video_id:
            StreamCacheService.invalidate_stream(old_video_id)
            StreamCacheService.invalidate_stream(new_video_id)

            meta = fetch_video_metadata(new_video_id)
            if "title" not in update_data:
                update_data["title"] = meta.get("title") or f"Chhath Song ({new_video_id})"
            if "artist" not in update_data:
                update_data["artist"] = meta.get("artist") or "Chhath Singer"
            if "duration_seconds" not in update_data:
                update_data["duration_seconds"] = meta.get("duration_seconds")
            if "thumbnail_url" not in update_data:
                update_data["thumbnail_url"] = meta.get("thumbnail_url") or f"https://i.ytimg.com/vi/{new_video_id}/hqdefault.jpg"

            update_data["metadata_status"] = "complete" if update_data.get("duration_seconds") is not None else "incomplete"
            update_data["last_metadata_sync"] = datetime.now(timezone.utc)
            enqueue_priority_warming(new_video_id)

        for field, value in update_data.items():
            setattr(song, field, value)

        db.commit()
        db.refresh(song)
        _cache_delete(QUEUE_CACHE_KEY)
        return song

    @staticmethod
    def delete(db: Session, song: Song) -> None:
        """Permanently delete a song. Invalidates queue cache and stream cache."""
        from app.services.stream_cache_service import StreamCacheService

        video_id = song.youtube_video_id
        db.delete(song)
        db.commit()
        _cache_delete(QUEUE_CACHE_KEY)
        StreamCacheService.invalidate_stream(video_id)

    @staticmethod
    def get_radio_queue(db: Session) -> list[Song]:
        """
        Returns the deterministic queue for the default radio.
        Result is cached in Redis for QUEUE_CACHE_TTL seconds.

        Cache miss path: DB query → serialize → cache → return ORM objects.
        Cache hit path: deserialize dict list → return (no DB hit).
        """
        if QUEUE_CACHE_TTL > 0:
            cached = _cache_get(QUEUE_CACHE_KEY)
            if cached is not None:
                return cached  # type: ignore[return-value]

        songs = SongService.get_all_enabled(db)

        if QUEUE_CACHE_TTL > 0:
            _cache_set(QUEUE_CACHE_KEY, [_song_to_dict(s) for s in songs], QUEUE_CACHE_TTL)

        return songs
