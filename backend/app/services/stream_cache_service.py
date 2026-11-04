"""
Chhath Radio — High-Concurrency Stream Cache & Resolution Service

Integrates Redis for high-scalability audio stream resolution:
1. Two-tier caching (L1 In-Memory + L2 Redis) with proactive expiry detection (10-minute safety buffer).
2. Fast-path cache lookup for instant user song selection (returns in 1-2ms).
3. Direct-first, proxy-fallback extraction strategy:
   - AAC-LC (itag 140 / mp4a.40.2) direct adaptive stream.
   - Invidious local proxy fallback: /latest_version?id={video_id}&itag=140&local=true.
   - Opus / Piped secondary fallback.
4. Single-flight request coalescing using Redis distributed locking (SET NX EX).
5. Safe atomic lock release via Lua script (verifies token ownership).
6. Shared upstream instance health, latency tracking, and cooldown blacklist.
7. Strict audio-only format validation (rejects any video-containing stream).
8. Real-time metrics tracking in Redis (hit rates, misses, latency, fallbacks).
"""

import asyncio
import json
import logging
import re
import time
import urllib.parse
import urllib.request
import uuid
from typing import Optional, Dict, Any, List, Union

from app.core.redis import get_redis_client as _get_redis

logger = logging.getLogger(__name__)

# ─── Redis Configuration ───────────────────────────────────────────────────────

STREAM_CACHE_PREFIX = "chhath:stream:"
STREAM_LOCK_PREFIX = "chhath:lock:stream:"
HEALTH_PREFIX = "chhath:piped:health:"
STREAM_METRICS_KEY = "chhath:metrics:stream"

STREAM_CACHE_TTL = 14400         # 4 Hours max (Google CDN tokens valid for 6h)
CONSERVATIVE_TTL = 1800          # 30 Minutes when expiry timestamp is unknown
EXPIRY_BUFFER_SECONDS = 600      # 10 Minutes safety buffer before known expiry
LOCK_EXPIRE_SECONDS = 8          # Max lock hold time to prevent deadlocks
COOLDOWN_SECONDS = 600           # 10 minutes cooldown for failed upstream instances

# Atomic lock release Lua script (only delete if current value matches token)
RELEASE_LOCK_LUA = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
"""

# In-Memory L1 Cache (ultra-fast local hits within process)
_l1_cache: Dict[str, Dict[str, Any]] = {}
_l1_cache_ts: Dict[str, float] = {}
L1_CACHE_TTL = 300  # 5 minutes in-memory

# Candidate upstream extraction instances — prioritized by reliability
BOOTSTRAP_EXTRACTORS = [
    {
        "type": "invidious",
        "url": "https://yt.chocolatemoo53.com/api/v1/videos/{video_id}?fields=title,adaptiveFormats,formatStreams",
        "name": "Chocolatemoo (USA - Verified Active)",
        "origin": "https://yt.chocolatemoo53.com",
    },
    {
        "type": "invidious",
        "url": "https://invidious.nerdvpn.de/api/v1/videos/{video_id}?fields=title,adaptiveFormats,formatStreams",
        "name": "NerdVPN (Canada)",
        "origin": "https://invidious.nerdvpn.de",
    },
    {
        "type": "invidious",
        "url": "https://inv.nadeko.net/api/v1/videos/{video_id}?fields=title,adaptiveFormats,formatStreams",
        "name": "Nadeko (Chile)",
        "origin": "https://inv.nadeko.net",
    },
    {
        "type": "invidious",
        "url": "https://invidious.tiekoetter.com/api/v1/videos/{video_id}?fields=title,adaptiveFormats,formatStreams",
        "name": "Tiekoetter (Germany)",
        "origin": "https://invidious.tiekoetter.com",
    },
    {
        "type": "piped",
        "url": "https://api.piped.private.coffee/streams/{video_id}",
        "name": "Private Coffee",
        "origin": "https://api.piped.private.coffee",
    },
    {
        "type": "piped",
        "url": "https://pipedapi.ducks.party/streams/{video_id}",
        "name": "Ducks Party",
        "origin": "https://pipedapi.ducks.party",
    },
]


def _clean_l1_cache() -> None:
    """Prune expired L1 cache entries."""
    now = time.time()
    expired = [k for k, ts in _l1_cache_ts.items() if now - ts > L1_CACHE_TTL]
    for k in expired:
        _l1_cache.pop(k, None)
        _l1_cache_ts.pop(k, None)


def _record_metric(metric_field: str, amount: int = 1) -> None:
    """Record stream resolution telemetry metric in Redis."""
    try:
        client = _get_redis()
        if client:
            client.hincrby(STREAM_METRICS_KEY, metric_field, amount)
    except Exception:
        pass


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


def extract_url_expiry(url: str) -> Optional[int]:
    """Extract unix timestamp from expire= query parameter in stream URL."""
    if not url:
        return None
    match = re.search(r"[?&]expire=([0-9]+)", url)
    if match:
        try:
            return int(match.group(1))
        except (ValueError, TypeError):
            pass
    return None


def is_url_expired(url: str, buffer_seconds: int = EXPIRY_BUFFER_SECONDS) -> bool:
    """
    Returns True if the URL's expire parameter is in the past or within buffer_seconds.
    Defaults to 10 minutes (600s) buffer for proactive refreshment.
    """
    expiry = extract_url_expiry(url)
    if expiry is None:
        return False
    return time.time() >= (expiry - buffer_seconds)


class StreamCacheService:
    """High-concurrency stream resolution service with Redis single-flight and caching."""

    @classmethod
    def get_stream_fast(cls, video_id: str) -> Optional[Dict[str, Any]]:
        """
        Fast-path cache lookup for user song selection (L1 in-memory -> L2 Redis).
        Returns immediately without blocking on network if a valid, unexpired stream exists.
        Target latency: < 2ms.
        """
        clean_id = (video_id or "").strip()
        if not clean_id or len(clean_id) < 5:
            return None

        # 1. Check L1 In-Memory Cache
        now = time.time()
        _clean_l1_cache()
        if clean_id in _l1_cache and (now - _l1_cache_ts.get(clean_id, 0)) < L1_CACHE_TTL:
            cached_data = _l1_cache[clean_id]
            if not is_url_expired(cached_data.get("url", ""), buffer_seconds=EXPIRY_BUFFER_SECONDS):
                _record_metric("l1_hits")
                cached_data["cached"] = True
                cached_data["cache_tier"] = "L1_MEMORY"
                return cached_data
            else:
                _l1_cache.pop(clean_id, None)
                _l1_cache_ts.pop(clean_id, None)

        # 2. Check L2 Redis Cache
        redis_client = _get_redis()
        cache_key = f"{STREAM_CACHE_PREFIX}{clean_id}"

        if redis_client:
            try:
                raw_json = redis_client.get(cache_key)
                if raw_json:
                    stream_data = json.loads(raw_json)
                    if not is_url_expired(stream_data.get("url", ""), buffer_seconds=EXPIRY_BUFFER_SECONDS):
                        _record_metric("redis_hits")
                        _l1_cache[clean_id] = stream_data
                        _l1_cache_ts[clean_id] = now
                        stream_data["cached"] = True
                        stream_data["cache_tier"] = "L2_REDIS"
                        return stream_data
                    else:
                        logger.info("[StreamCache] Evicting expired stream from Redis for %s", clean_id)
                        redis_client.delete(cache_key)
                        _l1_cache.pop(clean_id, None)
                        _l1_cache_ts.pop(clean_id, None)
                        _record_metric("expirations_detected")
            except Exception as exc:
                logger.warning("[StreamCache] Redis GET failed for %s: %s", clean_id, exc)

        return None

    @classmethod
    def get_stream(cls, video_id: str, priority: str = "high", force_fresh: bool = False) -> Optional[Dict[str, Any]]:
        """
        Main entry point: Resolves a playable direct audio stream for a given video ID.
        Checks fast cache first. On miss (or force_fresh), coordinates via single-flight distributed lock.
        """
        clean_id = (video_id or "").strip()
        if not clean_id or len(clean_id) < 5:
            return None

        # 1. Fast cache check (bypassed if force_fresh is requested)
        if not force_fresh:
            cached = cls.get_stream_fast(clean_id)
            if cached:
                return cached

        # 2. Cache miss or force_fresh: Coordinate via single-flight lock
        # Only record user-selected playback as a cache miss to prevent background prewarming
        # from artificially lowering the overall playback hit ratio.
        if priority == "high":
            _record_metric("cache_misses")
        redis_client = _get_redis()
        return cls._resolve_with_single_flight(clean_id, redis_client, priority=priority, force_fresh=force_fresh)

    @classmethod
    def _resolve_with_single_flight(
        cls, video_id: str, redis_client: Optional[Any], priority: str = "high", force_fresh: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        Coordinates concurrent requests for the same track using Redis distributed locking.
        Only one worker queries upstream; other workers wait and read the cached result.
        """
        lock_key = f"{STREAM_LOCK_PREFIX}{video_id}"
        lock_token = str(uuid.uuid4())
        cache_key = f"{STREAM_CACHE_PREFIX}{video_id}"

        # If force_fresh, invalidate local L1 and L2 first
        if force_fresh:
            _l1_cache.pop(video_id, None)
            _l1_cache_ts.pop(video_id, None)
            if redis_client:
                try:
                    redis_client.delete(cache_key)
                except Exception:
                    pass

        # If Redis is available, attempt atomic lock acquisition
        if redis_client:
            try:
                acquired = redis_client.set(
                    lock_key, lock_token, nx=True, ex=LOCK_EXPIRE_SECONDS
                )
                if not acquired:
                    # Another worker is actively resolving this track.
                    # Poll Redis cache (faster 50ms polling if user-selected high priority)
                    poll_interval = 0.05 if priority == "high" else 0.15
                    max_wait = 3.5 if priority == "high" else 6.0
                    return cls._poll_for_result(video_id, redis_client, poll_interval=poll_interval, max_wait_sec=max_wait)
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

                # Store in L2 Redis Cache with TTL aligned to CDN expiry
                if redis_client:
                    try:
                        ttl = STREAM_CACHE_TTL
                        exp = stream_result.get("expires_at") or extract_url_expiry(stream_result.get("url", ""))
                        if exp:
                            rem = int(exp - time.time() - EXPIRY_BUFFER_SECONDS)
                            if rem > 60:
                                ttl = min(ttl, rem)
                            else:
                                ttl = 60

                        redis_client.setex(
                            cache_key,
                            ttl,
                            json.dumps(stream_result),
                        )
                        _record_metric("extractions_success")
                    except Exception as exc:
                        logger.warning("[StreamCache] Redis SETEX failed: %s", exc)

                return stream_result
            else:
                _record_metric("extractions_failed")
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
        cls, video_id: str, redis_client: Any, poll_interval: float = 0.1, max_wait_sec: float = 4.0
    ) -> Optional[Dict[str, Any]]:
        """Follower workers poll Redis for the winning worker's resolved stream."""
        cache_key = f"{STREAM_CACHE_PREFIX}{video_id}"
        deadline = time.time() + max_wait_sec

        while time.time() < deadline:
            time.sleep(poll_interval)
            try:
                raw_json = redis_client.get(cache_key)
                if raw_json:
                    data = json.loads(raw_json)
                    if not is_url_expired(data.get("url", ""), buffer_seconds=EXPIRY_BUFFER_SECONDS):
                        data["cached"] = True
                        data["cache_tier"] = "COALESCED_REDIS"
                        return data
            except Exception:
                pass

        logger.info("[StreamCache] Single-flight poll timed out for %s. Extracting directly.", video_id)
        return cls._extract_upstream(video_id)

    @staticmethod
    def _resolve_final_proxy_url(proxy_url: str, timeout: float = 4.0) -> Optional[str]:
        """
        Follows Invidious 302 redirects ahead of time during background extraction.
        Eliminates 2 round-trip redirects (3-5s delay) so the browser directly streams
        from the final companion audio endpoint with 0 redirects and immediate TTFB.
        """
        if not proxy_url:
            return None
        try:
            req = urllib.request.Request(
                proxy_url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Range": "bytes=0-0"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                final_url = resp.geturl()
                if final_url and ("videoplayback" in final_url or "companion" in final_url):
                    return final_url
        except urllib.error.HTTPError as exc:
            if exc.code in (200, 206) and hasattr(exc, "url") and exc.url:
                return exc.url
        except Exception as e:
            logger.warning("[StreamCache] Could not pre-resolve proxy redirect: %s", e)
        return proxy_url

    @staticmethod
    def _check_url_accessibility(url: str, timeout: float = 2.0) -> bool:
        """
        Lightweight probe to verify if direct stream URL is accessible or IP-blocked (403).
        """
        if not url:
            return False
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Range": "bytes=0-0"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status in (200, 206)
        except urllib.error.HTTPError as exc:
            if exc.code == 403:
                return False
            return exc.code in (416, 302, 301)
        except Exception:
            return True

    @classmethod
    def _extract_upstream(cls, video_id: str) -> Optional[Dict[str, Any]]:
        """
        Direct-First, Proxy-Fallback Strategy:
        1. Attempt direct AAC-LC adaptive stream (itag 140 / mp4a.40.2).
        2. Construct and validate Invidious proxy fallback (/latest_version?id=...&itag=140&local=true).
        3. Fall back to Opus (audio/webm) or Piped instances.
        Strictly rejects any video-containing streams.
        """
        redis_client = _get_redis()
        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        for extractor in BOOTSTRAP_EXTRACTORS:
            ext_name = extractor["name"]
            endpoint = extractor["url"].format(video_id=video_id)
            origin = extractor.get("origin") or ""

            # Check instance cooldown in Redis
            if redis_client:
                try:
                    health_key = f"{HEALTH_PREFIX}{ext_name}"
                    cooldown = redis_client.hget(health_key, "cooldown_until")
                    if cooldown and time.time() < float(cooldown):
                        continue
                except Exception:
                    pass

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
                            break

                        data = json.loads(resp.read().decode("utf-8"))
                        latency_ms = int((time.time() - start_time) * 1000)

                        # Invidious parser
                        if extractor["type"] == "invidious":
                            adaptive = [
                                f for f in data.get("adaptiveFormats", [])
                                if "audio" in f.get("type", "") and not f.get("type", "").startswith("video/") and f.get("url")
                            ]
                            if adaptive:
                                # Prioritize AAC-LC (mp4a.40.2 / itag 140) for universal browser support
                                m4a_streams = [f for f in adaptive if "mp4" in f.get("type", "")]
                                m4a_streams.sort(key=lambda x: int(x.get("bitrate") or 0), reverse=True)

                                aac_lc = next((f for f in m4a_streams if "mp4a.40.2" in f.get("type", "")), None)
                                best = aac_lc or (m4a_streams[0] if m4a_streams else adaptive[0])
                                duration = _extract_duration(data, best)
                                direct_url = best["url"]
                                expiry = extract_url_expiry(direct_url)

                                # Immediate Invidious proxy fallback URL and pre-resolution
                                raw_proxy_url = f"{origin}/latest_version?id={video_id}&itag=140&local=true" if origin else None
                                resolved_proxy_url = cls._resolve_final_proxy_url(raw_proxy_url) if raw_proxy_url else None
                                final_proxy_url = resolved_proxy_url or raw_proxy_url

                                # Independent validation: check if direct_url has IP-binding lock or returns 403
                                has_ip_restriction = bool(re.search(r"[?&]ip=", direct_url))
                                is_direct_accessible = cls._check_url_accessibility(direct_url) if not has_ip_restriction else False

                                # Build prioritized candidate sources (Constraint 3)
                                sources = [
                                    {
                                        "url": direct_url,
                                        "type": "direct",
                                        "format": "M4A" if "mp4" in best.get("type", "") else "WEBM_OPUS",
                                        "mimeType": best.get("type") or 'audio/mp4; codecs="mp4a.40.2"',
                                        "bitrate": best.get("bitrate") or 128000,
                                        "expires_at": expiry,
                                    }
                                ]

                                # Priority 2: Alternative direct format
                                alt_stream = next((f for f in adaptive if f.get("url") and f.get("url") != direct_url), None)
                                if alt_stream:
                                    sources.append({
                                        "url": alt_stream["url"],
                                        "type": "direct_alt",
                                        "format": "WEBM_OPUS" if "webm" in alt_stream.get("type", "") else "M4A",
                                        "mimeType": alt_stream.get("type") or "audio/webm",
                                        "bitrate": alt_stream.get("bitrate") or 128000,
                                        "expires_at": extract_url_expiry(alt_stream["url"]),
                                    })

                                # Priority 3: Pre-resolved companion proxy endpoint
                                if final_proxy_url:
                                    sources.append({
                                        "url": final_proxy_url,
                                        "type": "proxy",
                                        "format": "M4A",
                                        "mimeType": 'audio/mp4; codecs="mp4a.40.2"',
                                        "bitrate": 128000,
                                    })

                                # Priority 4: Fallback Invidious raw endpoint
                                if raw_proxy_url and raw_proxy_url != final_proxy_url:
                                    sources.append({
                                        "url": raw_proxy_url,
                                        "type": "proxy_fallback",
                                        "format": "M4A",
                                        "mimeType": 'audio/mp4; codecs="mp4a.40.2"',
                                        "bitrate": 128000,
                                    })

                                # Determine authoritative stream readiness status
                                if is_direct_accessible and not has_ip_restriction:
                                    stream_status = "READY"
                                    stream_url = direct_url
                                elif final_proxy_url:
                                    stream_status = "DEGRADED"
                                    # If direct is IP-bound or failed, serve the verified proxy as primary
                                    # to prevent client from waiting 15s for browser native retry loop!
                                    stream_url = final_proxy_url
                                else:
                                    stream_status = "FAILED"
                                    stream_url = direct_url

                                cls._record_success(ext_name, latency_ms, redis_client)
                                return {
                                    "url": stream_url,
                                    "direct_url": direct_url,
                                    "proxy_url": final_proxy_url,
                                    "status": stream_status,
                                    "sources": sources,
                                    "format": "M4A" if "mp4" in best.get("type", "") else "WEBM_OPUS",
                                    "mimeType": best.get("type") or 'audio/mp4; codecs="mp4a.40.2"',
                                    "bitrate": best.get("bitrate") or 128000,
                                    "duration": duration,
                                    "title": data.get("title", f"Chhath Song ({video_id})"),
                                    "extractor": ext_name,
                                    "expires_at": expiry,
                                    "is_audio_only": True,
                                }

                        # Piped parser
                        elif extractor["type"] == "piped":
                            audio_streams = [
                                s for s in data.get("audioStreams", [])
                                if not (s.get("mimeType") or "").startswith("video/") and s.get("url")
                            ]
                            if audio_streams:
                                m4a_streams = [s for s in audio_streams if "mp4" in s.get("mimeType", "") or s.get("format") == "M4A"]
                                m4a_streams.sort(key=lambda s: int(s.get("bitrate") or 0), reverse=True)
                                aac_lc = next((s for s in m4a_streams if "mp4a.40.2" in s.get("mimeType", "")), None)
                                best = aac_lc or (m4a_streams[0] if m4a_streams else audio_streams[0])
                                duration = _extract_duration(data, best)
                                direct_url = best["url"]
                                expiry = extract_url_expiry(direct_url)

                                has_ip_restriction = bool(re.search(r"[?&]ip=", direct_url))
                                is_direct_accessible = cls._check_url_accessibility(direct_url) if not has_ip_restriction else False
                                stream_status = "READY" if is_direct_accessible and not has_ip_restriction else "DEGRADED"

                                sources = [{
                                    "url": direct_url,
                                    "type": "direct",
                                    "format": best.get("format", "M4A"),
                                    "mimeType": best.get("mimeType") or 'audio/mp4; codecs="mp4a.40.2"',
                                    "bitrate": best.get("bitrate") or 128000,
                                    "expires_at": expiry,
                                }]

                                cls._record_success(ext_name, latency_ms, redis_client)
                                return {
                                    "url": direct_url,
                                    "direct_url": direct_url,
                                    "proxy_url": None,
                                    "status": stream_status,
                                    "sources": sources,
                                    "format": best.get("format", "M4A"),
                                    "mimeType": best.get("mimeType") or 'audio/mp4; codecs="mp4a.40.2"',
                                    "bitrate": best.get("bitrate") or 128000,
                                    "duration": duration,
                                    "title": data.get("title", f"Chhath Song ({video_id})"),
                                    "extractor": ext_name,
                                    "expires_at": expiry,
                                    "is_audio_only": True,
                                }

                            cls._record_failure(ext_name, redis_client)

                except (urllib.error.URLError, TimeoutError, OSError) as exc:
                    if attempt < max_attempts:
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
    def invalidate_stream(cls, video_id: str, source_type: str = "all") -> None:
        """
        Invalidates stream cache for video_id.
        If source_type == 'direct' and a valid proxy_url exists in cache:
        Downgrades cache entry to DEGRADED and promotes proxy_url to url,
        avoiding cold eviction and allowing other clients to play instantly!
        """
        clean_id = (video_id or "").strip()
        if not clean_id:
            return

        redis_client = _get_redis()
        cache_key = f"{STREAM_CACHE_PREFIX}{clean_id}"

        if source_type == "direct":
            # Check if we can do an in-place promotion of proxy_url
            cached = _l1_cache.get(clean_id)
            if not cached and redis_client:
                try:
                    raw = redis_client.get(cache_key)
                    if raw:
                        cached = json.loads(raw)
                except Exception:
                    pass

            if cached and cached.get("proxy_url") and cached.get("proxy_url") != cached.get("url"):
                logger.info("[StreamCache] Demoting direct stream for %s to DEGRADED and promoting proxy URL.", clean_id)
                cached["url"] = cached["proxy_url"]
                cached["status"] = "DEGRADED"
                _l1_cache[clean_id] = cached
                _l1_cache_ts[clean_id] = time.time()
                if redis_client:
                    try:
                        ttl = redis_client.ttl(cache_key)
                        if ttl and ttl > 60:
                            redis_client.setex(cache_key, ttl, json.dumps(cached))
                    except Exception:
                        pass
                _record_metric("degraded_promotions")
                return

        _l1_cache.pop(clean_id, None)
        _l1_cache_ts.pop(clean_id, None)
        if redis_client:
            try:
                redis_client.delete(cache_key)
                _record_metric("invalidations")
            except Exception:
                pass

    @classmethod
    def reset_metrics(cls) -> None:
        """Resets all stream resolution telemetry and hit/miss counters in Redis."""
        redis_client = _get_redis()
        if redis_client:
            try:
                redis_client.delete(STREAM_METRICS_KEY)
                logger.info("[StreamCache] Successfully reset telemetry metrics in Redis.")
            except Exception as exc:
                logger.warning("[StreamCache] Failed to reset metrics key in Redis: %s", exc)

    @classmethod
    def flush_stream_cache(cls, video_id: Optional[Union[str, List[str]]] = None) -> int:
        """
        Flushes stream cache entries from L1 in-memory and L2 Redis.
        - If video_id(s) is provided (single ID, list, or comma/newline-separated string):
          Flushes only those specific tracks, and PRESERVES overall telemetry hit/miss metrics.
        - If video_id is None or empty:
          Flushes ALL streams and RESETS telemetry metrics (hits, misses, extractions).
        Returns the count of Redis keys deleted.
        """
        global _l1_cache, _l1_cache_ts
        deleted_count = 0
        redis_client = _get_redis()

        clean_ids: List[str] = []
        if video_id is not None:
            if isinstance(video_id, list):
                raw_list = video_id
            else:
                raw_list = re.split(r"[\s,\n\r;]+", str(video_id))

            seen = set()
            for item in raw_list:
                item = (item or "").strip()
                if not item:
                    continue
                # Extract 11-char ID if full YouTube URL was pasted
                match = re.search(r"(?:v=|\/|be\/|embed\/)([0-9A-Za-z_-]{11})", item)
                vid = match.group(1) if match else item
                vid = vid.strip()
                if vid and len(vid) >= 5 and vid not in seen:
                    seen.add(vid)
                    clean_ids.append(vid)

        if clean_ids:
            # SELECTIVE FLUSH: Invalidate only specified tracks. DO NOT reset telemetry metrics!
            for cid in clean_ids:
                _l1_cache.pop(cid, None)
                _l1_cache_ts.pop(cid, None)
                if redis_client:
                    try:
                        deleted = redis_client.delete(f"{STREAM_CACHE_PREFIX}{cid}")
                        redis_client.delete(f"{STREAM_LOCK_PREFIX}{cid}")
                        deleted_count += deleted
                    except Exception as exc:
                        logger.warning("[StreamCache] Redis delete failed for %s: %s", cid, exc)
            _record_metric("invalidations", len(clean_ids))
            logger.info("[StreamCache] Selectively flushed %d stream(s) for %d requested track(s). Telemetry preserved.", deleted_count, len(clean_ids))
        else:
            # ENTIRE CATALOG FLUSH: Flush all cached streams and reset telemetry metrics.
            _l1_cache.clear()
            _l1_cache_ts.clear()
            if redis_client:
                try:
                    cursor = 0
                    while True:
                        cursor, keys = redis_client.scan(cursor=cursor, match=f"{STREAM_CACHE_PREFIX}*", count=100)
                        if keys:
                            deleted_count += redis_client.delete(*keys)
                        if cursor == 0:
                            break
                    # Also clear any locks
                    cursor = 0
                    while True:
                        cursor, keys = redis_client.scan(cursor=cursor, match=f"{STREAM_LOCK_PREFIX}*", count=100)
                        if keys:
                            redis_client.delete(*keys)
                        if cursor == 0:
                            break

                    # Reset metrics counters ONLY on full on-demand cache flush
                    redis_client.delete(STREAM_METRICS_KEY)
                except Exception as exc:
                    logger.warning("[StreamCache] Redis flush all failed: %s", exc)

            logger.info("[StreamCache] Flushed entire stream cache (%d streams) and reset telemetry metrics.", deleted_count)

        return deleted_count

    @classmethod
    def get_metrics(cls) -> Dict[str, Any]:
        """Returns resolution metrics and cache hit statistics."""
        redis_client = _get_redis()
        metrics = {
            "l1_hits": 0,
            "redis_hits": 0,
            "cache_misses": 0,
            "extractions_success": 0,
            "extractions_failed": 0,
            "expirations_detected": 0,
            "invalidations": 0,
            "hit_ratio": 1.0,
            "total_requests": 0,
        }
        if redis_client:
            try:
                raw = redis_client.hgetall(STREAM_METRICS_KEY)
                if raw:
                    for k, v in raw.items():
                        decoded_k = k.decode("utf-8") if isinstance(k, bytes) else str(k)
                        try:
                            val = int(v)
                            metrics[decoded_k] = val
                        except (ValueError, TypeError):
                            pass
                total_hits = metrics["l1_hits"] + metrics["redis_hits"]
                total_requests = total_hits + metrics["cache_misses"]
                metrics["total_requests"] = total_requests
                if total_requests > 0:
                    metrics["hit_ratio"] = round(total_hits / total_requests, 4)
                else:
                    metrics["hit_ratio"] = 1.0
            except Exception:
                pass
        return metrics
