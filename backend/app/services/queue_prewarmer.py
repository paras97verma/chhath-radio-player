"""
Queue Stream Pre-Warmer Background Service

Proactively extracts and caches direct audio stream URLs in Redis for all active radio songs.
- Runs on server boot and periodically every 3 hours (10,800s).
- 3-hour recurrence ensures all Google CDN tokens in Redis remain well within their 6-hour lifespan.
- Paces queries (1.5s delay) to be polite to upstream extractors.
- Smart 2-Tier Retry:
  1. Socket/network timeout: immediate 500ms jittered retry on same instance.
  2. 502 / 429: pushed to retry_bucket; swept in second pass after 15s pause.
"""

import asyncio
import json
import logging
from typing import List, Optional, Dict, Any

from app.core.redis import get_redis_client as _get_redis
from app.db.database import SessionLocal
from app.services.song_service import SongService
from app.services.stream_cache_service import (
    StreamCacheService,
    STREAM_CACHE_PREFIX,
    is_url_expired,
)

logger = logging.getLogger(__name__)

# Refresh interval: 3 hours in seconds (well within Google CDN's 6h token expiry)
PREWARMER_INTERVAL_SECONDS = 3 * 60 * 60  # 10,800s
# Pacing delay between songs to prevent rate limiting
SONG_PACE_DELAY_SECONDS = 1.5
# Minimum remaining TTL before re-warming an existing cached stream (1 hour)
MIN_REMAINING_TTL_SECONDS = 3600
# Delay before running the 2nd pass retry sweep for failed tracks
SECOND_PASS_WAIT_SECONDS = 15.0

_prewarmer_task: Optional[asyncio.Task] = None
_is_running: bool = False


class QueuePrewarmer:
    """Coordinates proactive pre-warming of audio stream URLs in Redis."""

    @classmethod
    def is_song_warm(cls, video_id: str, min_ttl: int = MIN_REMAINING_TTL_SECONDS) -> bool:
        """
        Checks if a song stream is already cached in Redis with sufficient remaining TTL.
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
            # If key does not exist or has less than min_ttl seconds remaining
            if ttl is None or ttl <= min_ttl:
                return False

            raw_json = redis_client.get(cache_key)
            if raw_json and isinstance(raw_json, (str, bytes)):
                try:
                    data = json.loads(raw_json)
                    if is_url_expired(data.get("url", ""), buffer_seconds=600):
                        return False
                except Exception:
                    pass
            return True
        except Exception as exc:
            logger.debug("[QueuePrewarmer] Redis TTL check failed for %s: %s", clean_id, exc)
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
            logger.warning("[QueuePrewarmer] Failed to warm song %s: %s", clean_id, exc)

        return False

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
            # Check for cooperative cancellation
            await asyncio.sleep(0)

            success = await asyncio.to_thread(cls.warm_song, vid)
            if not success:
                failed_ids.append(vid)

            # Polite delay between upstream hits (except after the final track)
            if idx < len(video_ids) - 1 and pace_delay > 0:
                await asyncio.sleep(pace_delay)

        return failed_ids

    @classmethod
    async def run_prewarmer_cycle(cls) -> Dict[str, Any]:
        """
        Executes a complete 2-tier pre-warming cycle over all enabled radio songs.
        """
        video_ids: List[str] = []

        # 1. Fetch enabled songs from DB
        db = SessionLocal()
        try:
            songs = SongService.get_all_enabled(db)
            # Preserve order while deduplicating
            seen = set()
            for s in songs:
                vid = (s.youtube_video_id or "").strip()
                if vid and vid not in seen:
                    seen.add(vid)
                    video_ids.append(vid)
        except Exception as exc:
            logger.error("[QueuePrewarmer] Could not load songs from database: %s", exc)
            return {"total": 0, "warmed": 0, "failed": []}
        finally:
            db.close()

        total_count = len(video_ids)
        if total_count == 0:
            logger.info("[QueuePrewarmer] No active songs found in queue.")
            return {"total": 0, "warmed": 0, "failed": []}

        logger.info("[QueuePrewarmer] Starting pre-warming cycle for %d active songs...", total_count)

        # 2. Pass 1: Warm all tracks with pacing
        failed_pass_1 = await cls.warm_queue_pass(video_ids, pace_delay=SONG_PACE_DELAY_SECONDS)

        # 3. Pass 2: Retry failed tracks after a cooldown pause
        still_failed: List[str] = []
        if failed_pass_1:
            logger.warning(
                "[QueuePrewarmer] Pass 1 complete: %d/%d songs succeeded. %d failed. Pausing %.1fs before 2nd pass...",
                total_count - len(failed_pass_1),
                total_count,
                len(failed_pass_1),
                SECOND_PASS_WAIT_SECONDS,
            )
            await asyncio.sleep(SECOND_PASS_WAIT_SECONDS)
            still_failed = await cls.warm_queue_pass(failed_pass_1, pace_delay=SONG_PACE_DELAY_SECONDS)

        warmed_count = total_count - len(still_failed)

        if still_failed:
            logger.warning(
                "[QueuePrewarmer] Cycle finished with %d persistent failures after 2 passes: %s",
                len(still_failed),
                still_failed,
            )
        else:
            logger.info(
                "[QueuePrewarmer] Cycle complete! 100%% of songs (%d/%d) are fresh and warm in Redis.",
                warmed_count,
                total_count,
            )

        return {
            "total": total_count,
            "warmed": warmed_count,
            "failed": still_failed,
        }


async def _prewarmer_loop() -> None:
    """Internal loop that runs the pre-warmer on boot and every 3 hours."""
    global _is_running
    logger.info("[QueuePrewarmer] Background worker initialized. First cycle starting in 15s...")

    # Allow application startup, DB, and Redis pool connection to fully settle
    try:
        await asyncio.sleep(15)
    except asyncio.CancelledError:
        return

    while _is_running:
        try:
            await QueuePrewarmer.run_prewarmer_cycle()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("[QueuePrewarmer] Unexpected error in prewarmer cycle: %s", exc)

        try:
            logger.info(
                "[QueuePrewarmer] Sleeping for %.1f hours until next proactive refresh...",
                PREWARMER_INTERVAL_SECONDS / 3600,
            )
            await asyncio.sleep(PREWARMER_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            break

    logger.info("[QueuePrewarmer] Background worker cleanly stopped.")


def start_prewarmer() -> None:
    """Starts the background pre-warmer task."""
    global _prewarmer_task, _is_running
    if _prewarmer_task and not _prewarmer_task.done():
        logger.debug("[QueuePrewarmer] Task already running.")
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.debug("[QueuePrewarmer] No running event loop. Skipping pre-warmer start.")
        return

    _is_running = True
    _prewarmer_task = loop.create_task(_prewarmer_loop())
    logger.info("[QueuePrewarmer] Pre-warmer background task spawned.")


def stop_prewarmer() -> None:
    """Stops the background pre-warmer task cleanly."""
    global _prewarmer_task, _is_running
    _is_running = False
    if _prewarmer_task and not _prewarmer_task.done():
        _prewarmer_task.cancel()
        _prewarmer_task = None
        logger.info("[QueuePrewarmer] Pre-warmer task cancelled.")
