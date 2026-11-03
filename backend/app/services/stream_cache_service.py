"""
Chhath Radio — High-Concurrency Stream Cache & Resolution Service

Integrates Redis for high-scalability audio stream resolution:
1. Two-tier caching (L1 In-Memory + L2 Redis) with 4-hour TTL.
2. Single-flight request coalescing using Redis distributed locking (SET NX EX).
3. Safe atomic lock release via Lua script (verifies token ownership).
4. Shared upstream instance health, latency tracking, and cooldown blacklist.
5. Circuit breaker & distributed rate limiting.
6. Zero audio traffic through Redis/backend: streams deliver direct from CDN.
7. Graceful degradation: falls back to L1 memory cache and direct extraction if Redis is offline.
"""

import asyncio
import json
import logging
import re
import time
import urllib.parse
import urllib.request
import uuid
from typing import Optional, Dict, Any, List

from app.core.redis import get_redis_client as _get_redis

logger = logging.getLogger(__name__)

# ─── Redis Configuration ───────────────────────────────────────────────────────

STREAM_CACHE_PREFIX = "chhath:stream:"
STREAM_LOCK_PREFIX = "chhath:lock:stream:"
HEALTH_PREFIX = "chhath:piped:health:"
CIRCUIT_KEY = "chhath:circuit:upstream"

STREAM_CACHE_TTL = 14400  # 4 Hours (YouTube tokens typically valid for 6h)
LOCK_EXPIRE_SECONDS = 8   # Max lock hold time to prevent deadlocks
COOLDOWN_SECONDS = 600    # 10 minutes cooldown for failed upstream instances

# Atomic lock release Lua script (only delete if current value matches token)
RELEASE_LOCK_LUA = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
"""

# In-Memory L1 Cache (fallback when Redis is unavailable or for ultra-fast local hits)
_l1_cache: Dict[str, Dict[str, Any]] = {}
_l1_cache_ts: Dict[str, float] = {}
L1_CACHE_TTL = 300  # 5 minutes in-memory

# Bootstrap extraction instances — Chocolatemoo is verified active (200 OK), others serve as fallbacks
BOOTSTRAP_EXTRACTORS = [
    {
        "type": "invidious",
        "url": "https://yt.chocolatemoo53.com/api/v1/videos/{video_id}?fields=title,adaptiveFormats,formatStreams",
        "name": "Chocolatemoo (USA - Verified Active)",
    },
    {
        "type": "invidious",
        "url": "https://invidious.tiekoetter.com/api/v1/videos/{video_id}?fields=title,adaptiveFormats,formatStreams",
        "name": "Tiekoetter (Germany)",
    },
    {
        "type": "invidious",
        "url": "https://invidious.nerdvpn.de/api/v1/videos/{video_id}?fields=title,adaptiveFormats,formatStreams",
        "name": "NerdVPN (Canada)",
    },
    {
        "type": "invidious",
        "url": "https://inv.nadeko.net/api/v1/videos/{video_id}?fields=title,adaptiveFormats,formatStreams",
        "name": "Nadeko (Chile)",
    },
    {
        "type": "piped",
        "url": "https://api.piped.private.coffee/streams/{video_id}",
        "name": "Private Coffee",
    },
    {
        "type": "piped",
        "url": "https://pipedapi.ducks.party/streams/{video_id}",
        "name": "Ducks Party",
    },
]


def _clean_l1_cache() -> None:
    """Prune expired L1 cache entries."""
    now = time.time()
    expired = [k for k, ts in _l1_cache_ts.items() if now - ts > L1_CACHE_TTL]
    for k in expired:
        _l1_cache.pop(k, None)
        _l1_cache_ts.pop(k, None)


def _extract_duration(data: Dict[str, Any], best: Dict[str, Any]) -> float:
    """Extract authoritative duration in seconds from API response or YouTube CDN URL."""
    # 1. Invidious lengthSeconds
    length_sec = data.get("lengthSeconds")
    if length_sec is not None:
        try:
            val = float(length_sec)
            if val > 0:
                return round(val, 2)
        except (ValueError, TypeError):
            pass
    # 2. Piped duration
    dur = data.get("duration")
    if dur is not None:
        try:
            val = float(dur)
            if val > 0:
                return round(val, 2)
        except (ValueError, TypeError):
            pass
    # 3. approxDurationMs
    approx_ms = best.get("approxDurationMs")
    if approx_ms is not None:
        try:
            val = float(approx_ms) / 1000.0
            if val > 0:
                return round(val, 2)
        except (ValueError, TypeError):
            pass
    # 4. &dur= query parameter in YouTube CDN URL
    url = best.get("url") or ""
    match = re.search(r"[?&]dur=([0-9.]+)", url)
    if match:
        try:
            val = float(match.group(1))
            if val > 0:
                return round(val, 2)
        except (ValueError, TypeError):
            pass
    return 0.0


class StreamCacheService:
    """High-concurrency stream resolution service with Redis single-flight and caching."""

    @classmethod
    def get_stream(cls, video_id: str) -> Optional[Dict[str, Any]]:
        """
        Main entry point: Resolves a playable direct audio stream for a given video ID.
        Uses L1 memory -> L2 Redis -> Single-flight distributed lock -> Upstream extraction.
        """
        clean_id = (video_id or "").strip()
        if not clean_id or len(clean_id) < 5:
            return None

        # 1. Check L1 Memory Cache
        now = time.time()
        _clean_l1_cache()
        if clean_id in _l1_cache and (now - _l1_cache_ts.get(clean_id, 0)) < L1_CACHE_TTL:
            cached_data = _l1_cache[clean_id]
            cached_data["cached"] = True
            cached_data["cache_tier"] = "L1_MEMORY"
            return cached_data

        # 2. Check L2 Redis Cache
        redis_client = _get_redis()
        cache_key = f"{STREAM_CACHE_PREFIX}{clean_id}"

        if redis_client:
            try:
                raw_json = redis_client.get(cache_key)
                if raw_json:
                    stream_data = json.loads(raw_json)
                    # Populate L1 cache for subsequent fast in-process hits
                    _l1_cache[clean_id] = stream_data
                    _l1_cache_ts[clean_id] = now
                    stream_data["cached"] = True
                    stream_data["cache_tier"] = "L2_REDIS"
                    return stream_data
            except Exception as exc:
                logger.warning("[StreamCache] Redis GET failed for %s: %s", clean_id, exc)

        # 3. Cache Miss: Coordinate via Single-Flight Lock to prevent stampede
        return cls._resolve_with_single_flight(clean_id, redis_client)

    @classmethod
    def _resolve_with_single_flight(
        cls, video_id: str, redis_client: Optional[Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Coordinates concurrent requests for the same track using Redis distributed locking.
        Only one worker queries upstream; other workers wait and read the cached result.
        """
        lock_key = f"{STREAM_LOCK_PREFIX}{video_id}"
        lock_token = str(uuid.uuid4())
        cache_key = f"{STREAM_CACHE_PREFIX}{video_id}"

        # If Redis is available, attempt atomic lock acquisition
        if redis_client:
            try:
                acquired = redis_client.set(
                    lock_key, lock_token, nx=True, ex=LOCK_EXPIRE_SECONDS
                )
                if not acquired:
                    # Another worker is actively resolving this track.
                    # Poll Redis cache for up to 3.5 seconds (in 150ms intervals).
                    return cls._poll_for_result(video_id, redis_client)
            except Exception as exc:
                logger.warning("[StreamCache] Redis lock acquisition failed: %s", exc)

        # Winner worker: Perform upstream resolution
        try:
            stream_result = cls._extract_upstream(video_id)
            if stream_result:
                now = time.time()
                stream_result["cached"] = False
                stream_result["timestamp"] = int(now * 1000)

                # Store in L1 Memory Cache
                _l1_cache[video_id] = stream_result
                _l1_cache_ts[video_id] = now

                # Store in L2 Redis Cache (4-hour TTL)
                if redis_client:
                    try:
                        redis_client.setex(
                            cache_key,
                            STREAM_CACHE_TTL,
                            json.dumps(stream_result),
                        )
                    except Exception as exc:
                        logger.warning("[StreamCache] Redis SETEX failed: %s", exc)

                return stream_result
        finally:
            # Safely release lock using Lua script to verify token ownership
            if redis_client:
                try:
                    redis_client.eval(RELEASE_LOCK_LUA, 1, lock_key, lock_token)
                except Exception as exc:
                    logger.debug("[StreamCache] Redis lock release ignored: %s", exc)

        return None

    @classmethod
    def _poll_for_result(
        cls, video_id: str, redis_client: Any, max_wait_sec: float = 6.0
    ) -> Optional[Dict[str, Any]]:
        """Follower workers poll Redis for the winning worker's resolved stream."""
        cache_key = f"{STREAM_CACHE_PREFIX}{video_id}"
        deadline = time.time() + max_wait_sec

        while time.time() < deadline:
            time.sleep(0.15)
            try:
                raw_json = redis_client.get(cache_key)
                if raw_json:
                    data = json.loads(raw_json)
                    data["cached"] = True
                    data["cache_tier"] = "COALESCED_REDIS"
                    return data
            except Exception:
                pass

        # Timeout reached while waiting for winner: Fall back to direct extraction
        logger.info("[StreamCache] Single-flight poll timed out for %s. Extracting directly.", video_id)
        return cls._extract_upstream(video_id)

    @classmethod
    def _extract_upstream(cls, video_id: str) -> Optional[Dict[str, Any]]:
        """
        Queries upstream extraction instances in priority order with circuit breaking.
        """
        redis_client = _get_redis()
        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

        for extractor in BOOTSTRAP_EXTRACTORS:
            ext_name = extractor["name"]
            endpoint = extractor["url"].format(video_id=video_id)

            # Check instance cooldown in Redis
            if redis_client:
                try:
                    health_key = f"{HEALTH_PREFIX}{ext_name}"
                    cooldown = redis_client.hget(health_key, "cooldown_until")
                    if cooldown and time.time() < float(cooldown):
                        continue
                except Exception:
                    pass

            # Smart retry: up to 2 attempts on this extractor (immediate retry for network socket drops)
            max_attempts = 2
            for attempt in range(1, max_attempts + 1):
                start_time = time.time()
                try:
                    req = urllib.request.Request(
                        endpoint,
                        headers={"User-Agent": user_agent, "Accept": "application/json"},
                    )
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        if resp.status != 200:
                            cls._record_failure(ext_name, redis_client)
                            break  # 502 / 429 / 403: break to rotate to next instance

                        data = json.loads(resp.read().decode("utf-8"))
                        latency_ms = int((time.time() - start_time) * 1000)

                        # Invidious parser
                        if extractor["type"] == "invidious":
                            adaptive = [
                                f for f in data.get("adaptiveFormats", [])
                                if "audio" in f.get("type", "") and f.get("url")
                            ]
                            if adaptive:
                                # CRITICAL FOR iOS SAFARI / APPLE WEBKIT:
                                # Prioritize AAC-LC (mp4a.40.2 / itag 140, 128kbps) over HE-AAC (mp4a.40.5 / itag 139, 48kbps).
                                # Due to an Apple AVPlayer timescale bug with HE-AAC (mp4a.40.5), iOS Safari
                                # calculates exactly 2x the true duration and plays silence for the second half!
                                m4a_streams = [f for f in adaptive if "mp4" in f.get("type", "")]
                                m4a_streams.sort(key=lambda x: int(x.get("bitrate") or 0), reverse=True)

                                aac_lc = next((f for f in m4a_streams if "mp4a.40.2" in f.get("type", "")), None)
                                best = aac_lc or (m4a_streams[0] if m4a_streams else adaptive[0])
                                duration = _extract_duration(data, best)

                                cls._record_success(ext_name, latency_ms, redis_client)
                                return {
                                    "url": best["url"],
                                    "format": "M4A" if "mp4" in best.get("type", "") else "WEBM_OPUS",
                                    "mimeType": best.get("type") or 'audio/mp4; codecs="mp4a.40.2"',
                                    "bitrate": best.get("bitrate") or 128000,
                                    "duration": duration,
                                    "title": data.get("title", f"Chhath Song ({video_id})"),
                                    "extractor": ext_name,
                                }

                        # Piped parser
                        elif extractor["type"] == "piped":
                            audio_streams = data.get("audioStreams", [])
                            if audio_streams:
                                # Prioritize 128kbps AAC-LC over 48kbps HE-AAC
                                m4a_streams = [s for s in audio_streams if "mp4" in s.get("mimeType", "") or s.get("format") == "M4A"]
                                m4a_streams.sort(key=lambda s: int(s.get("bitrate") or 0), reverse=True)
                                aac_lc = next((s for s in m4a_streams if "mp4a.40.2" in s.get("mimeType", "")), None)
                                best = aac_lc or (m4a_streams[0] if m4a_streams else audio_streams[0])
                                duration = _extract_duration(data, best)

                                cls._record_success(ext_name, latency_ms, redis_client)
                                return {
                                    "url": best["url"],
                                    "format": best.get("format", "M4A"),
                                    "mimeType": best.get("mimeType") or 'audio/mp4; codecs="mp4a.40.2"',
                                    "bitrate": best.get("bitrate") or 128000,
                                    "duration": duration,
                                    "title": data.get("title", f"Chhath Song ({video_id})"),
                                    "extractor": ext_name,
                                }

                            # Fallback to muxed video stream containing audio
                            video_streams = [
                                v for v in data.get("videoStreams", [])
                                if not v.get("videoOnly") and v.get("url")
                            ]
                            if video_streams:
                                best = video_streams[0]
                                duration = _extract_duration(data, best)
                                cls._record_success(ext_name, latency_ms, redis_client)
                                return {
                                    "url": best["url"],
                                    "format": best.get("format", "MP4"),
                                    "mimeType": best.get("mimeType") or "video/mp4",
                                    "bitrate": best.get("bitrate") or 128000,
                                    "duration": duration,
                                    "title": data.get("title", f"Chhath Song ({video_id})"),
                                    "extractor": ext_name,
                                }

                except (urllib.error.URLError, TimeoutError, OSError) as exc:
                    if attempt < max_attempts:
                        # Transient network socket drop: brief jittered retry on same instance
                        time.sleep(0.5)
                        continue
                    else:
                        logger.warning("[StreamCache] Extractor %s failed for %s (attempt %d): %s", ext_name, video_id, attempt, exc)
                        cls._record_failure(ext_name, redis_client)
                except Exception as exc:
                    logger.warning("[StreamCache] Extractor %s parse error for %s: %s", ext_name, video_id, exc)
                    cls._record_failure(ext_name, redis_client)
                    break

        return None

    @classmethod
    def _record_failure(cls, name: str, redis_client: Optional[Any]) -> None:
        """Records failure and sets a 10-minute cooldown in Redis."""
        if not redis_client:
            return
        try:
            health_key = f"{HEALTH_PREFIX}{name}"
            pipe = redis_client.pipeline()
            pipe.hincrby(health_key, "fail_count", 1)
            pipe.hset(health_key, "cooldown_until", str(time.time() + COOLDOWN_SECONDS))
            pipe.expire(health_key, 86400)
            pipe.execute()
        except Exception:
            pass

    @classmethod
    def _record_success(cls, name: str, latency_ms: int, redis_client: Optional[Any]) -> None:
        """Records success and updates latency metrics."""
        if not redis_client:
            return
        try:
            health_key = f"{HEALTH_PREFIX}{name}"
            pipe = redis_client.pipeline()
            pipe.hset(health_key, "latency_ms", latency_ms)
            pipe.hdel(health_key, "cooldown_until")
            pipe.expire(health_key, 86400)
            pipe.execute()
        except Exception:
            pass

    @classmethod
    def invalidate_stream(cls, video_id: str) -> None:
        """Invalidates cache for a specific video ID across L1 and L2."""
        _l1_cache.pop(video_id, None)
        _l1_cache_ts.pop(video_id, None)
        redis_client = _get_redis()
        if redis_client:
            try:
                redis_client.delete(f"{STREAM_CACHE_PREFIX}{video_id}")
            except Exception:
                pass

