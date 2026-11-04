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
import json
import logging
import os
import random
import time
import uuid
from typing import List, Optional, Dict, Any

from app.core.redis import get_redis_client as _get_redis
from app.db.database import SessionLocal
from app.models.song import Song
from app.services.song_service import (
    SongService,
    RECONCILER_PRIORITY_KEY,
    RECONCILER_RETRY_KEY,
    RECONCILER_RETRY_ATTEMPTS_KEY,
)
from app.services.stream_cache_service import (
    StreamCacheService,
)

logger = logging.getLogger(__name__)

# ─── Configuration ─────────────────────────────────────────────────────────────

RECONCILIATION_INTERVAL_SECONDS = int(os.getenv("RECONCILIATION_INTERVAL_SECONDS", "3600"))  # 1 hour
RECONCILER_BATCH_SIZE = int(os.getenv("RECONCILER_BATCH_SIZE", "20"))
SONG_PACE_DELAY_SECONDS = float(os.getenv("SONG_PACE_DELAY_SECONDS", "0.5"))
MAX_SONG_PACE_DELAY_SECONDS = 2.0
SECOND_PASS_WAIT_SECONDS = float(os.getenv("SECOND_PASS_WAIT_SECONDS", "15.0"))
LEADER_KEY = "chhath:leader:catalog_reconciler"
LEADER_LEASE_TTL = 30  # seconds
LEADER_LEASE_RENEW_INTERVAL_SECONDS = LEADER_LEASE_TTL / 3
PRIORITY_RETRY_BACKOFF_SECONDS = (60, 300, 900, 3600)
CHECKPOINT_KEY = "chhath:reconciler:checkpoint"
CATALOG_STATUS_KEY = "chhath:catalog:status"
CATALOG_READINESS_CACHE_KEY = "chhath:catalog:readiness_cache"
RECONCILE_IN_PROGRESS_KEY = "chhath:reconcile:in_progress"

WORKER_ID = str(uuid.uuid4())

_reconciler_task: Optional[asyncio.Task] = None
_is_running: bool = False

# In-memory micro-cache for readiness metrics to eliminate duplicate computation
_readiness_status_cache: Dict[str, Any] = {}
_readiness_status_cache_ts: float = 0.0
READINESS_CACHE_TTL: float = 3.0  # 3-second micro-cache

RENEW_LEADER_LEASE_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
"""


def _bounded_pace_delay(delay: float) -> float:
    try:
        return min(MAX_SONG_PACE_DELAY_SECONDS, max(0.0, float(delay)))
    except (TypeError, ValueError):
        return min(MAX_SONG_PACE_DELAY_SECONDS, max(0.0, SONG_PACE_DELAY_SECONDS))


def _decode_queue_id(value: Any) -> str:
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)


def _schedule_priority_retry(redis_client: Any, video_id: str) -> None:
    raw_attempt = redis_client.hget(RECONCILER_RETRY_ATTEMPTS_KEY, video_id)
    try:
        previous_attempt = max(0, int(raw_attempt)) if isinstance(raw_attempt, (bytes, str, int)) else 0
    except (TypeError, ValueError):
        previous_attempt = 0
    attempt = min(previous_attempt + 1, len(PRIORITY_RETRY_BACKOFF_SECONDS))
    base_delay = PRIORITY_RETRY_BACKOFF_SECONDS[attempt - 1]
    delay = base_delay + random.uniform(0, base_delay * 0.1)
    redis_client.hset(RECONCILER_RETRY_ATTEMPTS_KEY, video_id, attempt)
    redis_client.zadd(RECONCILER_RETRY_KEY, {video_id: time.time() + delay})


def _try_acquire_catalog_lease(redis_client: Any, worker_id: str) -> bool:
    acquired = redis_client.set(LEADER_KEY, worker_id, nx=True, ex=LEADER_LEASE_TTL)
    if acquired:
        return True
    leader = redis_client.get(LEADER_KEY)
    leader_id = leader.decode("utf-8") if isinstance(leader, bytes) else str(leader or "")
    return leader_id == worker_id


def _renew_catalog_lease(redis_client: Any, worker_id: str) -> bool:
    return bool(redis_client.eval(
        RENEW_LEADER_LEASE_LUA,
        1,
        LEADER_KEY,
        worker_id,
        LEADER_LEASE_TTL,
    ))


def _load_enabled_video_ids() -> List[str]:
    db = SessionLocal()
    try:
        seen = set()
        video_ids = []
        for song in SongService.get_all_enabled(db):
            video_id = (getattr(song, "youtube_video_id", None) or "").strip()
            if video_id and video_id not in seen:
                seen.add(video_id)
                video_ids.append(video_id)
        return video_ids
    finally:
        db.close()


def _load_incomplete_metadata_ids() -> List[tuple[Any, str]]:
    db = SessionLocal()
    try:
        return [
            (song.id, (song.youtube_video_id or "").strip())
            for song in db.query(Song).filter(
                Song.enabled == True,
                (Song.metadata_status != "complete") | (Song.duration_seconds == None)
            ).all()
        ]
    finally:
        db.close()


def _snapshot_candidate_modes(video_ids: List[str]) -> Dict[str, Dict[str, float]]:
    """Snapshot only candidates returned by the fenced, freshness-valid Redis lookup."""
    snapshot: Dict[str, Dict[str, float]] = {}
    for video_id in video_ids:
        modes: Dict[str, float] = {}
        try:
            stream = StreamCacheService.get_stream_fast(video_id, record_metrics=False)
            if CatalogReconciliationService._has_current_generation_candidate(stream, video_id):
                for source in stream.get("sources", []):
                    mode = source.get("mode")
                    resolved_at = source.get("resolved_at")
                    if mode in {"direct", "proxy"} and isinstance(resolved_at, (int, float)):
                        modes[mode] = float(resolved_at)
        except Exception as exc:
            logger.warning("[CatalogReconciler] Candidate snapshot failed for %s: %s", video_id, exc)
        snapshot[video_id] = modes
    return snapshot


def _summarize_candidate_modes(
    video_ids: List[str],
    before: Dict[str, Dict[str, float]],
    after: Dict[str, Dict[str, float]],
    failed_ids: set[str],
) -> Dict[str, Any]:
    modes = {
        mode: {"fresh": 0, "refreshed": 0, "failed": 0, "overdue": 0}
        for mode in ("direct", "proxy")
    }
    warmed_ids = []
    for video_id in video_ids:
        previous = before.get(video_id, {})
        current = after.get(video_id, {})
        if current:
            warmed_ids.append(video_id)
        for mode, counts in modes.items():
            resolved_at = current.get(mode)
            if resolved_at is not None:
                if previous.get(mode) == resolved_at:
                    counts["fresh"] += 1
                else:
                    counts["refreshed"] += 1
            else:
                counts["overdue"] += 1
                if video_id in failed_ids or mode in previous:
                    counts["failed"] += 1

    final_failed = [video_id for video_id in video_ids if not after.get(video_id)]
    return {
        "warmed": len(warmed_ids),
        "failed": final_failed,
        "fresh": sum(counts["fresh"] for counts in modes.values()),
        "refreshed": sum(counts["refreshed"] for counts in modes.values()),
        "overdue": sum(counts["overdue"] for counts in modes.values()),
        "modes": modes,
    }


class CatalogReconciliationService:
    """Coordinates catalog-wide metadata synchronization, stream caching, and distributed reconciliation."""

    @classmethod
    def _has_current_generation_candidate(cls, stream: Any, video_id: str) -> bool:
        if (
            not isinstance(stream, dict)
            or stream.get("schema_version") != 1
            or stream.get("video_id") != video_id
            or type(stream.get("generation")) is not int
            or stream["generation"] < 1
            or not isinstance(stream.get("sources"), list)
        ):
            return False

        # get_stream_fast already requires the live Redis fence. Revalidate deadlines
        # here so readiness is based on a current candidate, never record TTL or URL alias.
        validated = StreamCacheService._validate_cache_record(stream, time.time(), video_id)
        return bool(
            validated
            and validated.get("generation") == stream["generation"]
            and validated.get("sources")
        )

    @classmethod
    def is_song_warm(cls, video_id: str) -> bool:
        """
        Returns true only when Redis returns a current fenced generation with a valid source.
        """
        return bool(cls._current_candidate_modes(video_id))

    @classmethod
    def _current_candidate_modes(cls, video_id: str) -> set[str]:
        clean_id = (video_id or "").strip()
        if not clean_id:
            return set()
        try:
            current = StreamCacheService.get_stream_fast(clean_id, record_metrics=False)
            if not cls._has_current_generation_candidate(current, clean_id):
                return set()
            return {
                source.get("mode")
                for source in current.get("sources", [])
                if source.get("mode") in {"direct", "proxy"}
            }
        except Exception as exc:
            logger.debug("[CatalogReconciler] Current stream check failed for %s: %s", clean_id, exc)
            return set()

    @classmethod
    def warm_song(cls, video_id: str, force: bool = False) -> bool:
        """
        Resolves and caches the stream URL for a single video ID.
        Returns True if the song is successfully cached, False otherwise.
        """
        clean_id = (video_id or "").strip()
        if not clean_id or len(clean_id) < 5:
            return False

        current_modes = set() if force else cls._current_candidate_modes(clean_id)
        if "proxy" in current_modes:
            return True

        # A current direct URL alone is insufficient: Safari and iOS need the
        # independently refreshed Invidious proxy candidate as their fallback.
        force_refresh = force or bool(current_modes)

        try:
            stream = StreamCacheService.get_stream(
                clean_id,
                priority="normal",
                force_fresh=force_refresh,
            )
            return bool(
                cls._has_current_generation_candidate(stream, clean_id)
                and any(source.get("mode") == "proxy" for source in stream.get("sources", []))
            )
        except Exception as exc:
            logger.warning("[CatalogReconciler] Failed to warm song %s: %s", clean_id, exc)

        return False

    @classmethod
    async def warm_specific_songs(cls, video_ids: List[str]) -> int:
        """
        Warms a targeted list of video IDs in background without triggering full catalog pass.
        Invalidates readiness micro-cache upon completion.
        """
        warmed = 0
        for vid in video_ids:
            clean_id = (vid or "").strip()
            if not clean_id or len(clean_id) < 5:
                continue
            try:
                success = await asyncio.to_thread(cls.warm_song, clean_id, force=True)
                if success:
                    warmed += 1
            except Exception as exc:
                logger.warning("[CatalogReconciler] Failed warming specific song %s: %s", clean_id, exc)
            await asyncio.sleep(0.05)

        cls.invalidate_status_cache()
        logger.info("[CatalogReconciler] Selectively warmed %d/%d tracks.", warmed, len(video_ids))
        return warmed

    @classmethod
    def process_priority_queue(cls, max_items: int = 10) -> int:
        """
        Processes due retries first, then queued IDs; only successful warms are acknowledged.
        """
        redis_client = _get_redis()
        if not redis_client:
            return 0

        limit = max(0, int(max_items))
        if limit == 0:
            return 0

        work: List[str] = []
        seen = set()
        try:
            due = redis_client.zrangebyscore(
                RECONCILER_RETRY_KEY,
                min="-inf",
                max=time.time(),
                start=0,
                num=limit,
            ) or []
            for raw_id in due:
                video_id = _decode_queue_id(raw_id).strip()
                if video_id and video_id not in seen:
                    work.append(video_id)
                    seen.add(video_id)
        except Exception as exc:
            logger.warning("[CatalogReconciler] Could not read due warm retries: %s", exc)

        while len(work) < limit:
            try:
                raw_id = redis_client.rpop(RECONCILER_PRIORITY_KEY)
            except Exception as exc:
                logger.warning("[CatalogReconciler] Could not read priority queue: %s", exc)
                break
            if not raw_id:
                break
            video_id = _decode_queue_id(raw_id).strip()
            if video_id and video_id not in seen:
                work.append(video_id)
                seen.add(video_id)

        if not work:
            return 0

        processed = 0
        db = SessionLocal()
        try:
            for vid in work:
                logger.info("[CatalogReconciler] Processing priority item: %s", vid)
                processed += 1
                try:
                    song = SongService.get_by_video_id(db, vid)
                    if song:
                        try:
                            SongService.sync_song_metadata(db, song)
                        except Exception as exc:
                            logger.warning("[CatalogReconciler] Priority metadata sync failed for %s: %s", vid, exc)
                    success = cls.warm_song(vid, force=True)
                except Exception as exc:
                    logger.warning("[CatalogReconciler] Priority warm failed for %s: %s", vid, exc)
                    success = False

                if success:
                    redis_client.zrem(RECONCILER_RETRY_KEY, vid)
                    redis_client.hdel(RECONCILER_RETRY_ATTEMPTS_KEY, vid)
                else:
                    try:
                        _schedule_priority_retry(redis_client, vid)
                    except Exception as exc:
                        logger.warning("[CatalogReconciler] Could not schedule retry for %s: %s", vid, exc)
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
        bounded_delay = _bounded_pace_delay(pace_delay)

        for idx, vid in enumerate(video_ids):
            await asyncio.sleep(0)
            success = await asyncio.to_thread(cls.warm_song, vid)
            if not success:
                failed_ids.append(vid)

            if idx < len(video_ids) - 1 and bounded_delay > 0:
                await asyncio.sleep(bounded_delay)

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
                try:
                    await asyncio.to_thread(SongService.sync_song_metadata_by_id, song.id)
                except Exception as exc:
                    logger.debug("[CatalogReconciler] Metadata sync failed for %s: %s", vid, exc)

            # 2. Check and warm stream if missing or expiring
            if not cls.is_song_warm(vid):
                await asyncio.to_thread(cls.warm_song, vid)

            bounded_delay = _bounded_pace_delay(SONG_PACE_DELAY_SECONDS)
            if bounded_delay > 0:
                await asyncio.sleep(bounded_delay)

        return {"count": len(songs), "has_more": len(songs) == limit}

    @classmethod
    async def run_prewarmer_cycle(cls) -> Dict[str, Any]:
        """
        Executes a complete catalog-wide reconciliation cycle across all enabled songs.
        Provides backwards compatibility with legacy QueuePrewarmer calls and runs 2-pass retry.
        """
        # 1. Fetch enabled IDs off the event loop; do not carry ORM sessions into worker threads.
        try:
            video_ids = await asyncio.to_thread(_load_enabled_video_ids)
        except Exception as exc:
            logger.error("[CatalogReconciler] Could not load songs from database: %s", exc)
            return {"total": 0, **_summarize_candidate_modes([], {}, {}, set())}

        total_count = len(video_ids)
        if total_count == 0:
            logger.info("[CatalogReconciler] No active songs found in queue.")
            return {"total": 0, **_summarize_candidate_modes([], {}, {}, set())}

        before_modes = await asyncio.to_thread(_snapshot_candidate_modes, video_ids)

        # Process any pending priority queue items first
        await asyncio.to_thread(cls.process_priority_queue, max_items=20)

        # Mark reconciliation as in progress in Redis
        redis_client = _get_redis()
        if redis_client:
            try:
                redis_client.set(RECONCILE_IN_PROGRESS_KEY, "1", ex=180)
            except Exception:
                pass

        # 2. Metadata Synchronization pass: resolve missing duration / incomplete metadata
        # Read incomplete records in a single fast query and close the DB session immediately
        # to ensure the connection pool is never starved during upstream network operations.
        try:
            incomplete_items = await asyncio.to_thread(_load_incomplete_metadata_ids)
        except Exception as exc:
            logger.warning("[CatalogReconciler] Metadata sync query error: %s", exc)
            incomplete_items = []

        metadata_synced_count = 0
        for s_id, vid in incomplete_items:
            if not vid:
                continue
            await asyncio.sleep(0.01)
            try:
                synced = await asyncio.to_thread(SongService.sync_song_metadata_by_id, s_id)
                metadata_synced_count += int(bool(synced))
            except Exception as sync_err:
                logger.debug("[CatalogReconciler] Could not sync metadata for %s: %s", vid, sync_err)

        if metadata_synced_count > 0:
            logger.info("[CatalogReconciler] Successfully synced metadata for %d songs.", metadata_synced_count)

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

        after_modes = await asyncio.to_thread(_snapshot_candidate_modes, video_ids)
        mode_summary = _summarize_candidate_modes(
            video_ids,
            before_modes,
            after_modes,
            set(still_failed),
        )

        # Record completion timestamp and clear in-progress flag in Redis
        if redis_client:
            try:
                status_data = {
                    "last_reconciliation_time": time.time(),
                    "total_processed": total_count,
                    "warmed": mode_summary["warmed"],
                    "failed": len(mode_summary["failed"]),
                    "fresh": mode_summary["fresh"],
                    "refreshed": mode_summary["refreshed"],
                    "overdue": mode_summary["overdue"],
                    "modes": mode_summary["modes"],
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
            **mode_summary,
        }

    @classmethod
    def invalidate_status_cache(cls) -> None:
        global _readiness_status_cache, _readiness_status_cache_ts
        _readiness_status_cache = {}
        _readiness_status_cache_ts = 0.0
        redis_client = _get_redis()
        if redis_client:
            try:
                redis_client.delete(CATALOG_READINESS_CACHE_KEY)
            except Exception:
                pass

    @classmethod
    def get_catalog_readiness_status(cls, force: bool = False) -> Dict[str, Any]:
        """
        Returns full internal catalog readiness observability report.
        Uses short shared/in-process response caching, fenced batch reads, and compact
        per-mode summaries. Never holds database connections across Redis operations.
        """
        global _readiness_status_cache, _readiness_status_cache_ts
        now_ts = time.time()
        if not force and _readiness_status_cache and (now_ts - _readiness_status_cache_ts) < READINESS_CACHE_TTL:
            return _readiness_status_cache

        redis_client = _get_redis()

        # Check shared Redis cache across workers
        if not force and redis_client:
            try:
                cached_raw = redis_client.get(CATALOG_READINESS_CACHE_KEY)
                if cached_raw:
                    cached_data = json.loads(cached_raw)
                    _readiness_status_cache = cached_data
                    _readiness_status_cache_ts = now_ts
                    return cached_data
            except Exception:
                pass

        total_db_songs = 0
        enabled_songs = 0
        metadata_ready = 0
        metadata_incomplete = 0
        stream_direct_ready = 0
        stream_proxy_ready = 0
        stream_degraded = 0
        stream_expiring = 0
        stream_missing = 0
        stream_failed = 0
        enabled_video_ids = []
        seen_video_ids = set()

        # 1. Database read: query catalog summary and release DB connection IMMEDIATELY
        db = SessionLocal()
        try:
            all_songs = SongService.get_all(db)
            total_db_songs = len(all_songs)
            for s in all_songs:
                if s.enabled:
                    enabled_songs += 1
                    video_id = (s.youtube_video_id or "").strip()
                    if video_id and video_id not in seen_video_ids:
                        seen_video_ids.add(video_id)
                        enabled_video_ids.append(video_id)
                    if s.metadata_status == "complete" and s.duration_seconds is not None:
                        metadata_ready += 1
                    else:
                        metadata_incomplete += 1
        except Exception as exc:
            logger.warning("[CatalogReconciler] Database read error in status: %s", exc)
        finally:
            db.close()

        # 2. Read only current fenced candidates. This status scan never counts as playback.
        cache_summary = StreamCacheService.get_catalog_cache_summary(enabled_video_ids)
        stream_modes = cache_summary["modes"]
        stream_direct_ready = int(stream_modes["direct"]["ready"])
        stream_proxy_ready = int(stream_modes["proxy"]["ready"])
        stream_degraded = max(0, stream_proxy_ready - stream_direct_ready)
        stream_expiring = int(cache_summary["songs_expiring"])
        total_stream_ready = stream_proxy_ready
        stream_missing = max(0, enabled_songs - total_stream_ready)

        # Leader check
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

        catalog_cycle = {}
        retry_overdue_count = 0
        oldest_retry_overdue_age_seconds = 0.0
        if redis_client:
            try:
                raw_cycle = redis_client.get(CATALOG_STATUS_KEY)
                if raw_cycle:
                    catalog_cycle = json.loads(raw_cycle)
            except Exception:
                catalog_cycle = {}
            try:
                due_retries = redis_client.zrangebyscore(
                    RECONCILER_RETRY_KEY,
                    min="-inf",
                    max=time.time(),
                    withscores=True,
                ) or []
                retry_ages = [
                    max(0.0, time.time() - float(score))
                    for _video_id, score in due_retries
                ]
                retry_overdue_count = len(retry_ages)
                oldest_retry_overdue_age_seconds = max(retry_ages, default=0.0)
            except Exception:
                pass
        stream_failed = int(catalog_cycle.get("failed", 0) or 0)
        oldest_overdue_age_seconds = max(
            float(mode.get("oldest_overdue_age_seconds", 0) or 0)
            for mode in stream_modes.values()
        )

        metrics = StreamCacheService.get_metrics()

        result = {
            "catalog": {
                "total_songs": total_db_songs,
                "eligible_songs": enabled_songs,
                "metadata_ready": metadata_ready,
                "metadata_incomplete": metadata_incomplete,
                "stream_ready": total_stream_ready,
                "stream_direct_ready": stream_direct_ready,
                "stream_proxy_ready": stream_proxy_ready,
                "stream_degraded": stream_degraded,
                "stream_expiring": stream_expiring,
                "stream_missing": stream_missing,
                "stream_failed": stream_failed,
                "stream_modes": stream_modes,
                "oldest_overdue_age_seconds": oldest_overdue_age_seconds,
                "cache_available": cache_summary["cache_available"],
                "metadata_completeness_percent": round((metadata_ready / enabled_songs * 100), 1) if enabled_songs > 0 else 0,
                "stream_readiness_percent": round((total_stream_ready / enabled_songs * 100), 1) if enabled_songs > 0 else 0,
                "true_direct_ready_percent": round((stream_direct_ready / enabled_songs * 100), 1) if enabled_songs > 0 else 0,
                "is_reconciling": is_reconciling,
            },
            "warmer": {
                "last_reconciliation_time": catalog_cycle.get("last_reconciliation_time"),
                "total_processed": catalog_cycle.get("total_processed", 0),
                "failed": stream_failed,
                "modes": catalog_cycle.get("modes", stream_modes),
                "retry_overdue_count": retry_overdue_count,
                "oldest_retry_overdue_age_seconds": oldest_retry_overdue_age_seconds,
                "oldest_mode_overdue_age_seconds": oldest_overdue_age_seconds,
                "lookup_errors": cache_summary["lookup_errors"],
            },
            "distributed_coordination": {
                "worker_id": WORKER_ID,
                "active_leader_id": current_leader,
                "is_current_worker_leader": (current_leader == WORKER_ID),
                "lease_ttl_seconds": LEADER_LEASE_TTL,
            },
            "telemetry": metrics,
        }

        # Store in Redis shared cache (4s TTL) and update process memory cache
        if redis_client:
            try:
                redis_client.setex(CATALOG_READINESS_CACHE_KEY, 4, json.dumps(result))
            except Exception:
                pass

        _readiness_status_cache = result
        _readiness_status_cache_ts = time.time()
        return result


# ─── Multi-Worker Reconciliation Loop ──────────────────────────────────────────

async def _reconciler_loop() -> None:
    """
    Continuous background loop:
    1. Coordinates multi-worker leader lease via Redis with a 15-second heartbeat.
    2. Non-leader workers wait in standby.
    3. Leader worker immediately processes priority queue items and conducts periodic catalog reconciliation.
    """
    global _is_running
    logger.info("[CatalogReconciler] Background worker %s initialized. First cycle in 5s...", WORKER_ID)

    heartbeat_task: Optional[asyncio.Task] = None
    heartbeat_client = None
    try:
        await asyncio.sleep(5)
        last_cycle_time = 0.0

        while _is_running:
            try:
                redis_client = await asyncio.to_thread(_get_redis)
                is_leader = bool(
                    redis_client and await asyncio.to_thread(
                        _try_acquire_catalog_lease, redis_client, WORKER_ID
                    )
                )

                if is_leader:
                    if (
                        heartbeat_task is None
                        or heartbeat_task.done()
                        or heartbeat_client is not redis_client
                    ):
                        if heartbeat_task is not None:
                            heartbeat_task.cancel()
                        heartbeat_client = redis_client
                        heartbeat_task = asyncio.create_task(
                            _catalog_lease_heartbeat(redis_client, WORKER_ID)
                        )

                    await asyncio.to_thread(
                        CatalogReconciliationService.process_priority_queue,
                        max_items=10,
                    )
                    cycle_interval = max(1, RECONCILIATION_INTERVAL_SECONDS)
                    if time.time() - last_cycle_time >= cycle_interval:
                        logger.info("[CatalogReconciler] Worker %s running full catalog warming pass...", WORKER_ID)
                        await CatalogReconciliationService.run_prewarmer_cycle()
                        last_cycle_time = time.time()
                else:
                    logger.debug("[CatalogReconciler] Worker %s in standby (non-leader).", WORKER_ID)
                    if heartbeat_task is not None:
                        heartbeat_task.cancel()
                        heartbeat_task = None
                        heartbeat_client = None
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("[CatalogReconciler] Unexpected error in reconciler loop: %s", exc)

            await asyncio.sleep(15)
    except asyncio.CancelledError:
        pass
    finally:
        if heartbeat_task is not None:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

    logger.info("[CatalogReconciler] Background worker cleanly stopped.")


async def _catalog_lease_heartbeat(redis_client: Any, worker_id: str) -> None:
    """Renew the leader lease independently while priority work or a full scan is awaited."""
    while _is_running:
        await asyncio.sleep(LEADER_LEASE_RENEW_INTERVAL_SECONDS)
        if not _is_running:
            return
        try:
            renewed = await asyncio.to_thread(_renew_catalog_lease, redis_client, worker_id)
        except Exception as exc:
            logger.warning("[CatalogReconciler] Leader lease renewal failed: %s", exc)
            return
        if not renewed:
            logger.warning("[CatalogReconciler] Leader lease ownership was lost by %s.", worker_id)
            return


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
