"""
Catalog Readiness & Stream Reconciliation Background Service

Proactively extracts, validates, and caches direct audio streams and descriptive metadata
for the entire eligible song catalog in PostgreSQL and Redis.
Features:
- Distributed multi-worker lease coordination (prevents duplicate scans across Uvicorn workers).
- High-priority event queue for immediate warming of created, updated, or requested tracks.
- Incremental cursor-based catalog pagination (bounded memory and rate-friendly pacing).
- Continuous metadata synchronization (title, artist, duration, thumbnail) persisted to DB.
- Expiry-aware stream refreshing (10-minute buffer before token expiry).
- Safe crash and restart recovery with Redis checkpoints.
- Backward compatibility alias for QueuePrewarmer.
"""

import asyncio
from datetime import datetime, timezone
import json
import logging
import os
import time
import uuid
from typing import List, Optional, Dict, Any

from app.core.redis import get_redis_client as _get_redis
from app.db.database import SessionLocal
from app.models.song import Song
from app.services.song_service import (
    SongService,
    RECONCILER_PRIORITY_KEY,
    QUEUE_CACHE_KEY,
    _cache_delete,
)
from app.services.stream_cache_service import (
    StreamCacheService,
    STREAM_CACHE_PREFIX,
    extract_url_expiry,
    is_url_expired,
    EXPIRY_BUFFER_SECONDS,
)

logger = logging.getLogger(__name__)

# ─── Configuration ─────────────────────────────────────────────────────────────

RECONCILIATION_INTERVAL_SECONDS = int(os.getenv("RECONCILIATION_INTERVAL_SECONDS", "3600"))  # 1 hour
RECONCILER_BATCH_SIZE = int(os.getenv("RECONCILER_BATCH_SIZE", "20"))
SONG_PACE_DELAY_SECONDS = float(os.getenv("SONG_PACE_DELAY_SECONDS", "0.5"))
SECOND_PASS_WAIT_SECONDS = float(os.getenv("SECOND_PASS_WAIT_SECONDS", "15.0"))
MIN_REMAINING_TTL_SECONDS = EXPIRY_BUFFER_SECONDS  # 600s = 10 mins

LEADER_KEY = "chhath:leader:catalog_reconciler"
LEADER_LEASE_TTL = 30  # seconds
CHECKPOINT_KEY = "chhath:reconciler:checkpoint"
CATALOG_STATUS_KEY = "chhath:catalog:status"
RECONCILE_IN_PROGRESS_KEY = "chhath:reconcile:in_progress"

WORKER_ID = str(uuid.uuid4())

_reconciler_task: Optional[asyncio.Task] = None
_is_running: bool = False

# In-memory micro-cache for readiness metrics to eliminate duplicate computation
_readiness_status_cache: Dict[str, Any] = {}
_readiness_status_cache_ts: float = 0.0
READINESS_CACHE_TTL: float = 3.0  # 3-second micro-cache


class CatalogReconciliationService:
    """Coordinates catalog-wide metadata synchronization, stream caching, and distributed reconciliation."""

    @classmethod
    def is_song_warm(cls, video_id: str, min_ttl: int = MIN_REMAINING_TTL_SECONDS) -> bool:
        """
        Checks if a song stream is already cached in Redis with sufficient remaining TTL (> min_ttl).
        """
        clean_id = (video_id or "").strip()
        if not clean_id:
            return False

        redis_client = _get_redis()
        if not redis_client:
            return False

        try:
            cache_key = f"{STREAM_CACHE_PREFIX}{clean_id}"
            ttl = redis_client.ttl(cache_key)
            if ttl is None or ttl <= min_ttl:
                return False

            raw_json = redis_client.get(cache_key)
            if raw_json and isinstance(raw_json, (str, bytes)):
                try:
                    data = json.loads(raw_json)
                    if is_url_expired(data.get("url", ""), buffer_seconds=min_ttl):
                        return False
                except Exception:
                    pass
            return True
        except Exception as exc:
            logger.debug("[CatalogReconciler] Redis TTL check failed for %s: %s", clean_id, exc)
            return False

    @classmethod
    def warm_song(cls, video_id: str, force: bool = False) -> bool:
        """
        Resolves and caches the stream URL for a single video ID.
        Returns True if the song is successfully cached, False otherwise.
        """
        clean_id = (video_id or "").strip()
        if not clean_id or len(clean_id) < 5:
            return False

        if not force and cls.is_song_warm(clean_id):
            return True

        try:
            stream = StreamCacheService.get_stream(clean_id)
            if stream and stream.get("url"):
                return True
        except Exception as exc:
            logger.warning("[CatalogReconciler] Failed to warm song %s: %s", clean_id, exc)

        return False

    @classmethod
    def process_priority_queue(cls, max_items: int = 10) -> int:
        """
        Processes high-priority video IDs that were explicitly queued (e.g. newly created/updated songs).
        """
        redis_client = _get_redis()
        if not redis_client:
            return 0

        processed = 0
        db = SessionLocal()
        try:
            for _ in range(max_items):
                raw_id = redis_client.rpop(RECONCILER_PRIORITY_KEY)
                if not raw_id:
                    break
                vid = raw_id.decode("utf-8") if isinstance(raw_id, bytes) else str(raw_id)
                logger.info("[CatalogReconciler] Processing priority item: %s", vid)

                # Sync metadata if present in DB
                song = SongService.get_by_video_id(db, vid)
                if song:
                    SongService.sync_song_metadata(db, song)

                # Extract and warm stream
                cls.warm_song(vid, force=True)
                processed += 1
        except Exception as exc:
            logger.warning("[CatalogReconciler] Error processing priority queue: %s", exc)
        finally:
            db.close()

        return processed

    @classmethod
    async def warm_queue_pass(
        cls,
        video_ids: List[str],
        pace_delay: float = SONG_PACE_DELAY_SECONDS,
    ) -> List[str]:
        """
        Warms a list of video IDs sequentially with pacing delay.
        Returns a list of video IDs that failed resolution during this pass.
        """
        failed_ids: List[str] = []

        for idx, vid in enumerate(video_ids):
            await asyncio.sleep(0)
            success = await asyncio.to_thread(cls.warm_song, vid)
            if not success:
                failed_ids.append(vid)

            if idx < len(video_ids) - 1 and pace_delay > 0:
                await asyncio.sleep(pace_delay)

        return failed_ids

    @classmethod
    async def run_reconciliation_batch(cls, offset: int, limit: int) -> Dict[str, Any]:
        """
        Reconciles a paginated batch of songs:
        1. Ensures descriptive metadata is fresh and persisted.
        2. Ensures stream is cached with sufficient TTL.
        """
        db = SessionLocal()
        songs: List[Song] = []
        try:
            songs = SongService.get_catalog_batch(db, limit=limit, offset=offset)
        except Exception as exc:
            logger.error("[CatalogReconciler] Could not load catalog batch: %s", exc)
            return {"count": 0, "has_more": False}
        finally:
            db.close()

        if not songs:
            return {"count": 0, "has_more": False}

        for song in songs:
            await asyncio.sleep(0)
            vid = song.youtube_video_id

            # 1. Check and sync metadata if incomplete or stale (> 24h)
            if (
                song.metadata_status != "complete"
                or song.duration_seconds is None
                or not song.thumbnail_url
            ):
                db_sync = SessionLocal()
                try:
                    s_ref = db_sync.get(Song, song.id)
                    if s_ref:
                        await asyncio.to_thread(SongService.sync_song_metadata, db_sync, s_ref)
                except Exception as exc:
                    logger.debug("[CatalogReconciler] Metadata sync failed for %s: %s", vid, exc)
                finally:
                    db_sync.close()

            # 2. Check and warm stream if missing or expiring
            if not cls.is_song_warm(vid):
                await asyncio.to_thread(cls.warm_song, vid)

            if SONG_PACE_DELAY_SECONDS > 0:
                await asyncio.sleep(SONG_PACE_DELAY_SECONDS)

        return {"count": len(songs), "has_more": len(songs) == limit}

    @classmethod
    async def run_prewarmer_cycle(cls) -> Dict[str, Any]:
        """
        Executes a complete catalog-wide reconciliation cycle across all enabled songs.
        Provides backwards compatibility with legacy QueuePrewarmer calls and runs 2-pass retry.
        """
        video_ids: List[str] = []

        # 1. Fetch enabled songs from DB
        db = SessionLocal()
        try:
            songs = SongService.get_all_enabled(db)
            seen = set()
            for s in songs:
                vid = (getattr(s, "youtube_video_id", None) or "").strip()
                if vid and vid not in seen:
                    seen.add(vid)
                    video_ids.append(vid)
        except Exception as exc:
            logger.error("[CatalogReconciler] Could not load songs from database: %s", exc)
            return {"total": 0, "warmed": 0, "failed": []}
        finally:
            db.close()

        total_count = len(video_ids)
        if total_count == 0:
            logger.info("[CatalogReconciler] No active songs found in queue.")
            return {"total": 0, "warmed": 0, "failed": []}

        # Process any pending priority queue items first
        cls.process_priority_queue(max_items=20)

        # Mark reconciliation as in progress in Redis
        redis_client = _get_redis()
        if redis_client:
            try:
                redis_client.set(RECONCILE_IN_PROGRESS_KEY, "1", ex=180)
            except Exception:
                pass

        # 2. Metadata Synchronization pass: resolve missing duration / incomplete metadata
        db_meta = SessionLocal()
        metadata_synced_count = 0
        try:
            incomplete_songs = db_meta.query(Song).filter(
                Song.enabled == True,
                (Song.metadata_status != "complete") | (Song.duration_seconds == None)
            ).all()
            for s in incomplete_songs:
                vid = (s.youtube_video_id or "").strip()
                if not vid:
                    continue
                # Fast resolution: check if duration is already cached in Redis stream
                resolved = False
                if redis_client:
                    try:
                        raw = redis_client.get(f"{STREAM_CACHE_PREFIX}{vid}")
                        if raw:
                            stream_dict = json.loads(raw)
                            dur = stream_dict.get("duration")
                            if dur is not None:
                                s.duration_seconds = int(dur)
                                s.metadata_status = "complete"
                                if not s.thumbnail_url:
                                    s.thumbnail_url = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                                s.last_metadata_sync = datetime.now(timezone.utc)
                                db_meta.commit()
                                metadata_synced_count += 1
                                resolved = True
                    except Exception:
                        db_meta.rollback()

                # If not resolved from Redis stream cache, sync from upstream
                if not resolved:
                    try:
                        synced = await asyncio.to_thread(SongService.sync_song_metadata, db_meta, s)
                        if synced:
                            metadata_synced_count += 1
                    except Exception as sync_err:
                        logger.debug("[CatalogReconciler] Could not sync metadata for %s: %s", vid, sync_err)
        except Exception as exc:
            logger.warning("[CatalogReconciler] Metadata sync pass error: %s", exc)
        finally:
            db_meta.close()

        if metadata_synced_count > 0:
            logger.info("[CatalogReconciler] Successfully synced metadata for %d songs.", metadata_synced_count)
            _cache_delete(QUEUE_CACHE_KEY)

        # Pass 1: Warm all tracks with pacing
        failed_pass_1 = await cls.warm_queue_pass(video_ids, pace_delay=SONG_PACE_DELAY_SECONDS)

        # Pass 2: Retry failed tracks after SECOND_PASS_WAIT_SECONDS
        still_failed: List[str] = []
        if failed_pass_1:
            logger.warning(
                "[CatalogReconciler] Pass 1 complete: %d/%d songs succeeded. %d failed. Pausing %.1fs before 2nd pass...",
                total_count - len(failed_pass_1),
                total_count,
                len(failed_pass_1),
                SECOND_PASS_WAIT_SECONDS,
            )
            await asyncio.sleep(SECOND_PASS_WAIT_SECONDS)
            still_failed = await cls.warm_queue_pass(failed_pass_1, pace_delay=SONG_PACE_DELAY_SECONDS)

        warmed_count = total_count - len(still_failed)

        # Record completion timestamp and clear in-progress flag in Redis
        if redis_client:
            try:
                status_data = {
                    "last_reconciliation_time": time.time(),
                    "total_processed": total_count,
                    "metadata_synced": metadata_synced_count,
                    "worker_id": WORKER_ID,
                }
                redis_client.set(CATALOG_STATUS_KEY, json.dumps(status_data))
                redis_client.delete(RECONCILE_IN_PROGRESS_KEY)
            except Exception:
                pass

        logger.info("[CatalogReconciler] Catalog reconciliation cycle complete! Processed %d songs.", total_count)
        return {
            "total": total_count,
            "warmed": warmed_count,
            "failed": still_failed,
        }

    @classmethod
    def invalidate_status_cache(cls) -> None:
        global _readiness_status_cache, _readiness_status_cache_ts
        _readiness_status_cache = {}
        _readiness_status_cache_ts = 0.0

    @classmethod
    def get_catalog_readiness_status(cls, force: bool = False) -> Dict[str, Any]:
        """
        Returns full internal catalog readiness observability report.
        Optimized with Redis mget batching and a 3-second micro-cache to eliminate
        sequential roundtrip latency on rapid polling.
        """
        global _readiness_status_cache, _readiness_status_cache_ts
        now_ts = time.time()
        if not force and _readiness_status_cache and (now_ts - _readiness_status_cache_ts) < READINESS_CACHE_TTL:
            return _readiness_status_cache

        db = SessionLocal()
        total_db_songs = 0
        enabled_songs = 0
        metadata_ready = 0
        metadata_incomplete = 0
        stream_ready = 0
        stream_expiring = 0
        stream_missing = 0

        try:
            all_songs = SongService.get_all(db)
            total_db_songs = len(all_songs)
            enabled_list = []
            for s in all_songs:
                if s.enabled:
                    enabled_songs += 1
                    enabled_list.append(s)
                    if s.metadata_status == "complete" and s.duration_seconds is not None:
                        metadata_ready += 1
                    else:
                        metadata_incomplete += 1

            # High-speed batch stream status check using single Redis MGET with fallback
            redis_client = _get_redis()
            if redis_client and enabled_list:
                keys = [f"{STREAM_CACHE_PREFIX}{s.youtube_video_id}" for s in enabled_list]
                raw_items = None
                try:
                    res = redis_client.mget(keys)
                    if isinstance(res, list):
                        raw_items = res
                except Exception:
                    pass

                if raw_items is None:
                    # Fallback to individual get (supports unit test mocks and single-key clients)
                    raw_items = []
                    for k in keys:
                        try:
                            raw_items.append(redis_client.get(k))
                        except Exception:
                            raw_items.append(None)

                now = time.time()
                for raw in raw_items:
                    if raw:
                        try:
                            d = json.loads(raw)
                            url = d.get("url", "")
                            exp = extract_url_expiry(url)
                            if exp and (exp - now) < EXPIRY_BUFFER_SECONDS:
                                stream_expiring += 1
                            else:
                                stream_ready += 1
                        except Exception:
                            stream_missing += 1
                    else:
                        stream_missing += 1
            else:
                stream_missing = enabled_songs
        except Exception as exc:
            logger.warning("[CatalogReconciler] Status computation error: %s", exc)
        finally:
            db.close()

        # Leader check
        redis_client = _get_redis()
        current_leader = None
        is_reconciling = False
        if redis_client:
            try:
                raw_leader = redis_client.get(LEADER_KEY)
                if raw_leader:
                    current_leader = raw_leader.decode("utf-8") if isinstance(raw_leader, bytes) else str(raw_leader)
                is_reconciling = bool(redis_client.get(RECONCILE_IN_PROGRESS_KEY))
            except Exception:
                pass

        metrics = StreamCacheService.get_metrics()

        result = {
            "catalog": {
                "total_songs": total_db_songs,
                "eligible_songs": enabled_songs,
                "metadata_ready": metadata_ready,
                "metadata_incomplete": metadata_incomplete,
                "stream_ready": stream_ready,
                "stream_expiring": stream_expiring,
                "stream_missing": stream_missing,
                "metadata_completeness_percent": round((metadata_ready / enabled_songs * 100), 1) if enabled_songs > 0 else 0,
                "stream_readiness_percent": round((stream_ready / enabled_songs * 100), 1) if enabled_songs > 0 else 0,
                "is_reconciling": is_reconciling,
            },
            "distributed_coordination": {
                "worker_id": WORKER_ID,
                "active_leader_id": current_leader,
                "is_current_worker_leader": (current_leader == WORKER_ID),
                "lease_ttl_seconds": LEADER_LEASE_TTL,
            },
            "telemetry": metrics,
        }
        _readiness_status_cache = result
        _readiness_status_cache_ts = time.time()
        return result


# ─── Multi-Worker Reconciliation Loop ──────────────────────────────────────────

async def _reconciler_loop() -> None:
    """
    Continuous background loop:
    1. Coordinates multi-worker leader lease via Redis.
    2. Non-leader workers wait in standby.
    3. Leader worker processes priority queue and conducts incremental reconciliation.
    """
    global _is_running
    logger.info("[CatalogReconciler] Background worker %s initialized. First cycle in 10s...", WORKER_ID)

    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        return

    while _is_running:
        try:
            redis_client = _get_redis()
            is_leader = False

            if redis_client:
                # Attempt to acquire or renew leader lease
                try:
                    acquired = redis_client.set(LEADER_KEY, WORKER_ID, nx=True, ex=LEADER_LEASE_TTL)
                    if acquired:
                        is_leader = True
                    else:
                        leader_val = redis_client.get(LEADER_KEY)
                        current_leader = leader_val.decode("utf-8") if isinstance(leader_val, bytes) else str(leader_val)
                        if current_leader == WORKER_ID:
                            redis_client.expire(LEADER_KEY, LEADER_LEASE_TTL)
                            is_leader = True
                except Exception as exc:
                    logger.debug("[CatalogReconciler] Leader lease error: %s", exc)

            if is_leader:
                logger.info("[CatalogReconciler] Worker %s holds leader lease. Running reconciliation...", WORKER_ID)
                await CatalogReconciliationService.run_prewarmer_cycle()
            else:
                logger.debug("[CatalogReconciler] Worker %s in standby (non-leader).", WORKER_ID)

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("[CatalogReconciler] Unexpected error in reconciler loop: %s", exc)

        try:
            # Sleep until next scheduled reconciliation or leader check
            await asyncio.sleep(RECONCILIATION_INTERVAL_SECONDS if is_leader else 15)
        except asyncio.CancelledError:
            break

    logger.info("[CatalogReconciler] Background worker cleanly stopped.")


def start_prewarmer() -> None:
    """Starts the background catalog reconciler task."""
    global _reconciler_task, _is_running
    if _reconciler_task and not _reconciler_task.done():
        logger.debug("[CatalogReconciler] Task already running.")
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.debug("[CatalogReconciler] No running event loop. Skipping reconciler start.")
        return

    _is_running = True
    _reconciler_task = loop.create_task(_reconciler_loop())
    logger.info("[CatalogReconciler] Catalog reconciliation background task spawned.")


def stop_prewarmer() -> None:
    """Stops the background catalog reconciler task cleanly."""
    global _reconciler_task, _is_running
    _is_running = False
    if _reconciler_task and not _reconciler_task.done():
        _reconciler_task.cancel()
        _reconciler_task = None
        logger.info("[CatalogReconciler] Reconciler task cancelled.")


# Backwards compatibility alias
QueuePrewarmer = CatalogReconciliationService
