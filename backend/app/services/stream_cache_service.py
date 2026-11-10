"""
Chhath Radio — High-Concurrency Stream Cache & Resolution Service

Integrates Redis for high-scalability audio stream resolution:
1. Two-tier caching (L1 In-Memory + L2 Redis) with proactive expiry detection (10-minute safety buffer).
2. Fast-path cache lookup for instant user song selection (returns in 1-2ms).
3. Direct-first, Invidious local proxy fallback extraction strategy.
4. Single-flight request coalescing using Redis distributed locking (SET NX EX).
5. Safe atomic lock release via Lua script (verifies token ownership).
6. Shared upstream instance health, latency tracking, and cooldown blacklist.
7. Strict audio-only format validation (rejects any video-containing stream).
8. Real-time metrics tracking in Redis (hit rates, misses, latency, fallbacks).
"""

import os
import json
import hashlib
import logging
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass
from threading import BoundedSemaphore, Event, Lock, Thread
from typing import Any, Dict, List, Literal, Optional, TypedDict, Union

from app.core.redis import get_redis_client as _get_redis

logger = logging.getLogger(__name__)

StreamSourceMode = Literal["direct", "proxy"]
StreamValidationState = Literal["validated", "unvalidated", "expired", "rejected"]


class SourceCandidate(TypedDict):
    """Canonical metadata for one independently expiring Invidious source."""

    mode: StreamSourceMode
    provider: Literal["invidious"]
    provider_origin: str
    url: str
    itag: int
    mime_type: str
    codec: Optional[str]
    resolved_at: float
    expires_at: Optional[float]
    refresh_at: float
    validation_state: StreamValidationState


class LegacySourceCandidate(TypedDict, total=False):
    """Current source fields retained until the stream API migration."""

    url: str
    type: Literal["direct", "direct_alt", "proxy", "proxy_fallback", "fallback"]
    format: str
    mimeType: str
    bitrate: int
    expires_at: Optional[float]


class StreamCacheFence(TypedDict):
    """Internal authority record; fence tokens must never be sent to clients."""

    generation: int
    fence_token: str


class StreamCacheRecord(TypedDict):
    """Metadata-only cache entry guarded by a separate StreamCacheFence."""

    schema_version: int
    video_id: str
    generation: int
    fence_token: str
    refreshed_at: float
    sources: List[SourceCandidate]
    last_resolution: Optional[str]


class LegacyStreamResponse(TypedDict, total=False):
    """Compatibility mapping returned by the current resolver/API path."""

    url: str
    direct_url: Optional[str]
    proxy_url: Optional[str]
    status: str
    sources: List[Union[SourceCandidate, LegacySourceCandidate]]
    format: str
    quality: str
    mimeType: str
    codec: str
    bitrate: int
    duration: float
    cache_tier: str
    title: str
    extractor: str
    expires_at: Optional[float]
    is_audio_only: bool
    cached: bool

# ─── Redis Configuration ───────────────────────────────────────────────────────

STREAM_CACHE_PREFIX = "chhath:stream:"
STREAM_FENCE_PREFIX = "chhath:stream:fence:"
STREAM_LOCK_PREFIX = "chhath:lock:stream:"
STREAM_REFRESH_DUE_KEY = "chhath:stream:refresh_due"
HEALTH_PREFIX = "chhath:invidious:health:"
STREAM_METRICS_KEY = "chhath:metrics:stream"

CONSERVATIVE_TTL = 1800          # 30 Minutes when expiry timestamp is unknown
EXPIRY_BUFFER_SECONDS = 600      # 10 Minutes safety buffer before known expiry
REFRESH_LEAD_SECONDS = 900       # Refresh metadata 15 minutes before its serving deadline
CACHE_RETENTION_GRACE_SECONDS = 3600
MAX_CACHE_RETENTION_SECONDS = 86400
LOCK_EXPIRE_SECONDS = 8          # Max lock hold time to prevent deadlocks
LOCK_RENEW_INTERVAL_SECONDS = 2.0
L1_CACHE_MAX_ENTRIES = 512
COOLDOWN_SECONDS = 600           # 10 minutes cooldown for failed upstream instances
ORIGIN_FAILURE_PREFIX = "chhath:invidious:failure:"
ORIGIN_FAILURE_WINDOW_SECONDS = 60
ORIGIN_FAILURE_THRESHOLD = 5
STREAM_RESOLUTION_TIMEOUT_SECONDS = 5.0
MAX_ORIGINS_PER_RESOLUTION = 2
DEFAULT_INVIDIOUS_REQUESTS_PER_SECOND = 2.0
DEFAULT_INVIDIOUS_MAX_CONCURRENCY = 1
INVIDIOUS_LIMIT_PREFIX = "chhath:invidious:limit:"
INVIDIOUS_LIMIT_LEASE_MS = 15_000
INVIDIOUS_LIMIT_RETRY_SECONDS = 0.025

DEFAULT_INVIDIOUS_ORIGINS = (
    "https://yt.chocolatemoo53.com",
    "https://invidious.nerdvpn.de",
    "https://inv.nadeko.net",
    "https://invidious.tiekoetter.com",
)


@dataclass(frozen=True)
class InvidiousInstance:
    name: str
    origin: str
    requests_per_second: float
    max_concurrency: int


def _load_invidious_registry() -> tuple[InvidiousInstance, ...]:
    configured = os.getenv("INVIDIOUS_INSTANCES", "").strip()
    origins = configured.split(",") if configured else DEFAULT_INVIDIOUS_ORIGINS
    try:
        requests_per_second = float(os.getenv(
            "INVIDIOUS_REQUESTS_PER_SECOND", str(DEFAULT_INVIDIOUS_REQUESTS_PER_SECOND)
        ))
    except ValueError:
        requests_per_second = DEFAULT_INVIDIOUS_REQUESTS_PER_SECOND
    try:
        max_concurrency = int(os.getenv(
            "INVIDIOUS_MAX_CONCURRENCY", str(DEFAULT_INVIDIOUS_MAX_CONCURRENCY)
        ))
    except ValueError:
        max_concurrency = DEFAULT_INVIDIOUS_MAX_CONCURRENCY

    if not math.isfinite(requests_per_second) or requests_per_second <= 0:
        requests_per_second = DEFAULT_INVIDIOUS_REQUESTS_PER_SECOND
    if max_concurrency <= 0:
        max_concurrency = DEFAULT_INVIDIOUS_MAX_CONCURRENCY

    registry = []
    seen = set()
    for raw_origin in origins:
        origin = raw_origin.strip().rstrip("/")
        parsed = urllib.parse.urlsplit(origin)
        if parsed.scheme != "https" or not parsed.netloc or parsed.path or parsed.query or parsed.fragment:
            continue
        if origin in seen:
            continue
        seen.add(origin)
        registry.append(InvidiousInstance(
            name=parsed.netloc,
            origin=origin,
            requests_per_second=requests_per_second,
            max_concurrency=max_concurrency,
        ))
    return tuple(registry)


INVIDIOUS_REGISTRY = _load_invidious_registry()
_origin_rotation_lock = Lock()
_origin_rotation_cursor = 0


def _rotated_invidious_instances() -> tuple[InvidiousInstance, ...]:
    """Return a thread-safe round-robin view so retries cover every configured origin."""
    global _origin_rotation_cursor
    registry = INVIDIOUS_REGISTRY
    if not registry:
        return ()

    with _origin_rotation_lock:
        start = _origin_rotation_cursor % len(registry)
        _origin_rotation_cursor = (
            start + min(MAX_ORIGINS_PER_RESOLUTION, len(registry))
        ) % len(registry)

    return tuple(
        registry[(start + offset) % len(registry)]
        for offset in range(len(registry))
    )


class _OriginRequestLimiter:
    """Enforces per-origin concurrency and minimum spacing between requests."""

    def __init__(self, instance: InvidiousInstance):
        self._instance = instance
        self._semaphore = BoundedSemaphore(instance.max_concurrency)
        self._rate_lock = Lock()
        self._next_allowed_at = 0.0
        self._interval = 1.0 / instance.requests_per_second

    @contextmanager
    def acquire(self, deadline: float, redis_client: Optional[Any] = None):
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not self._semaphore.acquire(timeout=remaining):
            raise TimeoutError("Invidious request budget exhausted")
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not self._rate_lock.acquire(timeout=remaining):
                raise TimeoutError("Invidious request budget exhausted")
            try:
                delay = max(0.0, self._next_allowed_at - time.monotonic())
                remaining = deadline - time.monotonic()
                if delay >= remaining:
                    raise TimeoutError("Invidious request budget exhausted")
                if delay > 0:
                    time.sleep(delay)
                self._next_allowed_at = time.monotonic() + self._interval
            finally:
                self._rate_lock.release()
            with _distributed_origin_slot(self._instance, redis_client, deadline):
                yield
        finally:
            self._semaphore.release()


_origin_limiters: Dict[tuple[str, float, int], _OriginRequestLimiter] = {}
_origin_limiters_lock = Lock()


def _get_origin_limiter(instance: InvidiousInstance) -> _OriginRequestLimiter:
    key = (instance.origin, instance.requests_per_second, instance.max_concurrency)
    with _origin_limiters_lock:
        limiter = _origin_limiters.get(key)
        if limiter is None:
            limiter = _OriginRequestLimiter(instance)
            _origin_limiters[key] = limiter
        return limiter


ORIGIN_LIMIT_ACQUIRE_LUA = """
local now_parts = redis.call("TIME")
local now_ms = now_parts[1] * 1000 + math.floor(now_parts[2] / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now_ms)
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[2]) then
    return {0, 1}
end
local next_at = tonumber(redis.call("GET", KEYS[2]) or now_ms)
local start_at = math.max(now_ms, next_at)
local wait_ms = start_at - now_ms
if wait_ms > tonumber(ARGV[5]) then
    return {-1, wait_ms}
end
redis.call("ZADD", KEYS[1], now_ms + tonumber(ARGV[3]), ARGV[1])
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[3]) * 2)
redis.call("SET", KEYS[2], start_at + tonumber(ARGV[4]), "PX", math.max(tonumber(ARGV[4]) * 2, tonumber(ARGV[3])))
return {1, wait_ms}
"""

ORIGIN_LIMIT_RELEASE_LUA = """
return redis.call("ZREM", KEYS[1], ARGV[1])
"""


@contextmanager
def _distributed_origin_slot(instance: InvidiousInstance, redis_client: Optional[Any], deadline: float):
    """Share origin rate and concurrency limits across backend worker processes."""
    if redis_client is None:
        yield
        return

    digest = hashlib.sha256(instance.origin.encode("utf-8")).hexdigest()
    key_prefix = f"{INVIDIOUS_LIMIT_PREFIX}{{{digest}}}"
    slots_key = f"{key_prefix}:slots"
    rate_key = f"{key_prefix}:next"
    token = uuid.uuid4().hex
    interval_ms = max(1, math.ceil(1000 / instance.requests_per_second))
    acquired = False

    while not acquired:
        remaining_ms = max(0, math.floor((deadline - time.monotonic()) * 1000))
        if remaining_ms <= 0:
            raise TimeoutError("Invidious request budget exhausted")
        result = redis_client.eval(
            ORIGIN_LIMIT_ACQUIRE_LUA,
            2,
            slots_key,
            rate_key,
            token,
            instance.max_concurrency,
            INVIDIOUS_LIMIT_LEASE_MS,
            interval_ms,
            remaining_ms,
        )
        status, wait_ms = int(result[0]), max(0, int(result[1]))
        if status < 0:
            raise TimeoutError("Invidious request budget exhausted")
        if status == 0:
            time.sleep(min(INVIDIOUS_LIMIT_RETRY_SECONDS, remaining_ms / 1000))
            continue

        wait_seconds = wait_ms / 1000
        if time.monotonic() + wait_seconds >= deadline:
            redis_client.eval(ORIGIN_LIMIT_RELEASE_LUA, 1, slots_key, token)
            raise TimeoutError("Invidious request budget exhausted")
        if wait_seconds:
            time.sleep(wait_seconds)
        acquired = True

    try:
        yield
    finally:
        try:
            redis_client.eval(ORIGIN_LIMIT_RELEASE_LUA, 1, slots_key, token)
        except Exception:
            # The lease expires automatically if a worker dies or Redis is unavailable.
            logger.warning("Could not release Invidious origin slot for %s", instance.name)

# Atomic lock release Lua script (only delete if current value matches token)
RELEASE_LOCK_LUA = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
"""

ADVANCE_FENCE_LUA = """
local generation = redis.call("HINCRBY", KEYS[1], "generation", 1)
redis.call("HSET", KEYS[1], "fence_token", ARGV[1])
return {generation, ARGV[1]}
"""

READ_FENCED_CACHE_LUA = """
local raw = redis.call("GET", KEYS[1])
if not raw then return nil end
local generation = redis.call("HGET", KEYS[2], "generation")
local token = redis.call("HGET", KEYS[2], "fence_token")
if not generation or not token then return {'generation_mismatch', raw} end
local ok, record = pcall(cjson.decode, raw)
if not ok then return {'invalid_cache_record', raw} end
if tonumber(record.generation) ~= tonumber(generation) or record.fence_token ~= token then
    return {'generation_mismatch', raw}
end
return raw
"""

INVALIDATE_CACHE_RAW_LUA = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
end
return 0
"""

MATCH_FENCE_LUA = """
if redis.call("HGET", KEYS[1], "generation") == ARGV[1]
and redis.call("HGET", KEYS[1], "fence_token") == ARGV[2] then
    return 1
end
return 0
"""

COMMIT_FENCED_CACHE_LUA = """
if redis.call("HGET", KEYS[1], "generation") ~= ARGV[1]
or redis.call("HGET", KEYS[1], "fence_token") ~= ARGV[2]
or redis.call("GET", KEYS[2]) ~= ARGV[5] then
    return 0
end
redis.call("HSET", KEYS[1], "generation", ARGV[3], "fence_token", ARGV[4])
redis.call("SET", KEYS[3], ARGV[7], "EX", tonumber(ARGV[6]))
redis.call("ZADD", KEYS[4], tonumber(ARGV[9]), ARGV[8])
return 1
"""

WRITE_FENCED_CACHE_LUA = """
if redis.call("HGET", KEYS[1], "generation") ~= ARGV[1]
or redis.call("HGET", KEYS[1], "fence_token") ~= ARGV[2] then
    return 0
end
redis.call("SET", KEYS[2], ARGV[4], "EX", tonumber(ARGV[3]))
redis.call("ZADD", KEYS[3], tonumber(ARGV[6]), ARGV[5])
return 1
"""

EVICT_FENCED_CACHE_LUA = """
local current_token = redis.call("HGET", KEYS[1], "fence_token")
if ARGV[1] ~= "" and current_token ~= ARGV[1] then return {0, 0} end
local generation = redis.call("HINCRBY", KEYS[1], "generation", 1)
redis.call("HSET", KEYS[1], "fence_token", ARGV[2])
local deleted = redis.call("DEL", KEYS[2])
redis.call("DEL", KEYS[3])
redis.call("ZREM", KEYS[4], ARGV[3])
return {generation, deleted}
"""

RENEW_LOCK_LUA = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
"""

# In-Memory L1 Cache (ultra-fast local hits within process)
_l1_cache: OrderedDict[str, Dict[str, Any]] = OrderedDict()
_l1_cache_ts: Dict[str, float] = {}
L1_CACHE_TTL = 300  # 5 minutes in-memory

def _clean_l1_cache() -> None:
    """Prune expired L1 entries and enforce the in-process capacity limit."""
    now = time.time()
    expired = [k for k, ts in _l1_cache_ts.items() if now - ts > L1_CACHE_TTL]
    for k in expired:
        _l1_cache.pop(k, None)
        _l1_cache_ts.pop(k, None)
    while len(_l1_cache) > L1_CACHE_MAX_ENTRIES:
        oldest, _ = _l1_cache.popitem(last=False)
        _l1_cache_ts.pop(oldest, None)


def _cache_l1(video_id: str, record: Dict[str, Any], now: Optional[float] = None) -> None:
    """Insert or refresh one L1 entry, keeping most recently used entries last."""
    _l1_cache[video_id] = record
    _l1_cache.move_to_end(video_id)
    _l1_cache_ts[video_id] = time.time() if now is None else now
    _clean_l1_cache()


@contextmanager
def _renew_lock_lease(redis_client: Any, lock_key: str, lock_token: str):
    """Keep a single-flight lock alive while its token still owns it."""
    stopped = Event()

    def renew() -> None:
        while not stopped.wait(LOCK_RENEW_INTERVAL_SECONDS):
            try:
                owned = redis_client.eval(
                    RENEW_LOCK_LUA, 1, lock_key, lock_token, LOCK_EXPIRE_SECONDS * 1000
                )
                if not owned:
                    return
            except Exception as exc:
                logger.warning("Could not renew stream resolution lease: %s", exc)
                return

    thread = Thread(target=renew, name="stream-lock-renewal", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stopped.set()
        thread.join(timeout=LOCK_RENEW_INTERVAL_SECONDS + 0.1)


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
    # 2. Legacy extractor duration field
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

    @staticmethod
    def _public_response(record: Dict[str, Any]) -> Dict[str, Any]:
        """Build temporary resolver compatibility fields from validated sources."""
        response = dict(record)
        response.pop("fence_token", None)
        sources = response.get("sources")
        if not isinstance(sources, list):
            return response

        direct = next((source for source in sources if source.get("mode") == "direct"), None)
        proxy = next((source for source in sources if source.get("mode") == "proxy"), None)
        primary = direct or proxy
        if not primary:
            return response

        mime_type = primary["mime_type"]
        media_type = mime_type.split(";", 1)[0].strip().lower()
        try:
            bitrate = int(response.get("bitrate") or primary.get("bitrate") or 128000)
        except (TypeError, ValueError):
            bitrate = 128000
        if bitrate <= 0:
            bitrate = 128000
        response.update({
            "url": primary["url"],
            "direct_url": direct["url"] if direct else None,
            "proxy_url": proxy["url"] if proxy else None,
            "status": "READY" if direct else "DEGRADED",
            "format": "M4A" if media_type == "audio/mp4" else "WEBM_OPUS",
            "quality": f"{round(bitrate / 1000)}kbps",
            "mimeType": mime_type,
            "codec": primary.get("codec") or "",
            "bitrate": bitrate,
            "expires_at": direct.get("expires_at") if direct else None,
            "is_audio_only": True,
        })
        return response

    @staticmethod
    def _fenced_read_payload(result: Any) -> Optional[str]:
        """Decode fenced reads and count coherence failures without exposing payloads."""
        if isinstance(result, (list, tuple)):
            status = result[0].decode("utf-8") if isinstance(result[0], bytes) else str(result[0])
            if status == "generation_mismatch":
                _record_metric("generation_mismatches")
            elif status == "invalid_cache_record":
                _record_metric("invalid_cache_records")
            return None
        if isinstance(result, bytes):
            return result.decode("utf-8")
        return result if isinstance(result, str) else None

    @staticmethod
    def _expired_candidate_count(record: Any, now: float) -> int:
        if not isinstance(record, dict) or not isinstance(record.get("sources"), list):
            return 0
        expired = 0
        for source in record["sources"]:
            if not isinstance(source, dict) or source.get("validation_state") != "validated":
                continue
            try:
                refresh_at = float(source.get("refresh_at"))
            except (TypeError, ValueError):
                continue
            if math.isfinite(refresh_at) and refresh_at <= now:
                expired += 1
        return expired

    @staticmethod
    def _read_current_record(redis_client: Any, video_id: str) -> Optional[Dict[str, Any]]:
        """Read a cache record only when its generation and token match the live fence."""
        result = redis_client.eval(
            READ_FENCED_CACHE_LUA,
            2,
            f"{STREAM_CACHE_PREFIX}{video_id}",
            f"{STREAM_FENCE_PREFIX}{video_id}",
        )
        raw = StreamCacheService._fenced_read_payload(result)
        if not raw:
            return None
        record = StreamCacheService._validate_cache_record(json.loads(raw), time.time(), video_id)
        if not record:
            return None
        if not isinstance(record.get("generation"), int) or not record.get("fence_token"):
            return None
        return record

    @staticmethod
    def _invalidate_raw_cache_record(redis_client: Any, video_id: str, raw_record: Any) -> bool:
        """Delete only the exact invalid record observed, without disrupting a newer refresh lock."""
        if not isinstance(raw_record, (str, bytes)):
            return False
        return bool(redis_client.eval(
            INVALIDATE_CACHE_RAW_LUA,
            1,
            f"{STREAM_CACHE_PREFIX}{video_id}",
            raw_record,
        ))

    @staticmethod
    def _advance_fence(redis_client: Any, video_id: str) -> Dict[str, Any]:
        token = uuid.uuid4().hex
        generation, returned_token = redis_client.eval(
            ADVANCE_FENCE_LUA, 1, f"{STREAM_FENCE_PREFIX}{video_id}", token
        )
        return {"generation": int(generation), "fence_token": str(returned_token)}

    @staticmethod
    def _evict_fenced_record(
        redis_client: Any, video_id: str, expected_token: Optional[str] = None
    ) -> int:
        result = redis_client.eval(
            EVICT_FENCED_CACHE_LUA,
            4,
            f"{STREAM_FENCE_PREFIX}{video_id}",
            f"{STREAM_CACHE_PREFIX}{video_id}",
            f"{STREAM_LOCK_PREFIX}{video_id}",
            STREAM_REFRESH_DUE_KEY,
            expected_token or "",
            uuid.uuid4().hex,
            video_id,
        )
        if expected_token and int(result[0]) == 0:
            _record_metric("generation_mismatches")
        return int(result[1])

    @staticmethod
    def _matches_fence(redis_client: Any, video_id: str, record: Dict[str, Any]) -> bool:
        generation = record.get("generation")
        token = record.get("fence_token")
        if not isinstance(generation, int) or not isinstance(token, str) or not token:
            return False
        matched = bool(redis_client.eval(
            MATCH_FENCE_LUA,
            1,
            f"{STREAM_FENCE_PREFIX}{video_id}",
            str(generation),
            token,
        ))
        if not matched:
            _record_metric("generation_mismatches")
        return matched

    @staticmethod
    def _validate_source_candidates(
        sources: Any, now: Optional[float] = None, video_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Keep only current, canonical Invidious audio candidates."""
        now = time.time() if now is None else float(now)
        if not isinstance(sources, list):
            return []

        valid: List[Dict[str, Any]] = []
        seen_modes = set()
        configured_origins = {
            instance.origin.rstrip("/").lower() for instance in INVIDIOUS_REGISTRY
        }
        for candidate in sources:
            if not isinstance(candidate, dict):
                continue
            mode = candidate.get("mode")
            if mode not in ("direct", "proxy") or mode in seen_modes:
                continue
            if candidate.get("provider") != "invidious":
                continue

            try:
                provider_origin = str(candidate.get("provider_origin") or "")
                origin_parts = urllib.parse.urlsplit(provider_origin)
                provider_host = origin_parts.hostname
                url = str(candidate.get("url") or "")
                url_parts = urllib.parse.urlsplit(url)
                url_host = url_parts.hostname
                itag = int(candidate.get("itag"))
                resolved_at = float(candidate.get("resolved_at"))
                refresh_at = float(candidate.get("refresh_at"))
                expiry_value = candidate.get("expires_at")
                expires_at = None if expiry_value is None else float(expiry_value)
            except (TypeError, ValueError):
                continue

            if (
                not provider_origin
                or origin_parts.scheme != "https"
                or not provider_host
                or origin_parts.path
                or origin_parts.query
                or origin_parts.fragment
                or origin_parts.username
                or origin_parts.password
                or not url
                or url_parts.scheme != "https"
                or not url_host
                or url_parts.username
                or url_parts.password
                or itag <= 0
                or not math.isfinite(resolved_at)
                or not math.isfinite(refresh_at)
                or resolved_at <= 0
                or resolved_at > now
                or refresh_at <= now
                or candidate.get("validation_state") != "validated"
            ):
                continue

            normalized_origin = f"{origin_parts.scheme}://{origin_parts.netloc}".lower()
            if normalized_origin not in configured_origins:
                continue

            mime_type = str(candidate.get("mime_type") or "").strip()
            media_type = mime_type.split(";", 1)[0].strip().lower()
            if media_type not in {"audio/mp4", "audio/webm"}:
                continue
            codec = candidate.get("codec")
            codec = str(codec).strip() if codec is not None else ""
            if len(codec) > 100:
                continue
            declared_codec = re.search(r'codecs\s*=\s*["\']?([^;"\']+)', mime_type, re.IGNORECASE)
            if declared_codec and codec and declared_codec.group(1).strip().lower() != codec.lower():
                continue

            source_expiry = extract_url_expiry(url)
            if mode == "direct":
                direct_params = urllib.parse.parse_qs(url_parts.query)
                declared_itags = direct_params.get("itag")
                if declared_itags and declared_itags != [str(itag)]:
                    continue
                if expires_at is None:
                    if source_expiry is not None or now - resolved_at >= CONSERVATIVE_TTL:
                        continue
                    if refresh_at > resolved_at + CONSERVATIVE_TTL:
                        continue
                else:
                    if (
                        not math.isfinite(expires_at)
                        or expires_at <= now + EXPIRY_BUFFER_SECONDS
                        or (source_expiry is not None and int(expires_at) != source_expiry)
                        or refresh_at > expires_at - EXPIRY_BUFFER_SECONDS
                    ):
                        continue
            else:
                if expires_at is not None or source_expiry is not None:
                    continue
                if now - resolved_at >= CONSERVATIVE_TTL:
                    continue
                if refresh_at > resolved_at + CONSERVATIVE_TTL:
                    continue

                proxy_params = urllib.parse.parse_qs(url_parts.query)
                origin_netloc = origin_parts.netloc.lower()
                expected_id = video_id or proxy_params.get("id", [""])[0]
                if (
                    url_parts.netloc.lower() != origin_netloc
                    or url_parts.path != "/latest_version"
                    or set(proxy_params) != {"id", "itag", "local"}
                    or proxy_params.get("id") != [expected_id]
                    or proxy_params.get("itag") != [str(itag)]
                    or proxy_params.get("local") != ["true"]
                ):
                    continue

            alias = candidate.get("type")
            allowed_aliases = {"direct", "direct_alt"} if mode == "direct" else {
                "proxy", "proxy_fallback", "fallback"
            }
            if alias is not None and alias not in allowed_aliases:
                continue

            normalized = {
                "mode": mode,
                "provider": "invidious",
                "provider_origin": f"{origin_parts.scheme}://{origin_parts.netloc}",
                "url": url,
                "itag": itag,
                "mime_type": mime_type,
                "codec": codec or (declared_codec.group(1).strip() if declared_codec else None),
                "resolved_at": resolved_at,
                "expires_at": expires_at,
                "refresh_at": refresh_at,
                "validation_state": "validated",
            }
            valid.append(normalized)
            seen_modes.add(mode)
            if len(valid) == 2:
                break

        return sorted(valid, key=lambda candidate: 0 if candidate["mode"] == "direct" else 1)

    @classmethod
    def _validate_cache_record(
        cls, record: Any, now: Optional[float] = None, video_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Migrate only fully validated legacy candidates into the canonical record."""
        if not isinstance(record, dict) or not isinstance(record.get("sources"), list):
            return None
        schema_version = record.get("schema_version", 0)
        if (
            isinstance(schema_version, bool)
            or not isinstance(schema_version, int)
            or schema_version not in (0, 1)
        ):
            return None
        now = time.time() if now is None else float(now)
        record_video_id = str(record.get("video_id") or video_id or "")
        if video_id and record_video_id and record_video_id != video_id:
            return None
        sources = cls._validate_source_candidates(record["sources"], now, record_video_id or None)
        if not sources:
            return None

        direct = next((source for source in sources if source["mode"] == "direct"), None)
        proxy = next((source for source in sources if source["mode"] == "proxy"), None)
        primary = direct or proxy
        source_metadata = next(
            (
                source for source in record["sources"]
                if isinstance(source, dict) and source.get("mode") == primary["mode"]
            ),
            {},
        )
        bitrate = record.get("bitrate", source_metadata.get("bitrate"))
        try:
            bitrate = int(bitrate) if bitrate is not None else 128000
        except (TypeError, ValueError):
            bitrate = 128000
        if bitrate <= 0:
            bitrate = 128000

        result = dict(record)
        for compatibility_field in (
            "url", "direct_url", "proxy_url", "status", "format", "quality",
            "mimeType", "codec", "expires_at", "is_audio_only", "timestamp",
            "cached", "cache_tier",
        ):
            result.pop(compatibility_field, None)
        result.update({
            "schema_version": 1,
            "video_id": record_video_id or None,
            "sources": sources,
            "bitrate": bitrate,
        })
        return result

    @staticmethod
    def _cache_retention_ttl(record: Any, now: Optional[float] = None) -> int:
        """Retain source metadata beyond its latest refresh deadline for safe recache."""
        now = time.time() if now is None else float(now)
        if not isinstance(record, dict) or not isinstance(record.get("sources"), list):
            return 0
        deadlines = []
        for source in record["sources"]:
            if not isinstance(source, dict):
                continue
            try:
                deadline = float(source.get("refresh_at"))
            except (TypeError, ValueError):
                continue
            if math.isfinite(deadline):
                deadlines.append(deadline)
        if not deadlines:
            return 0
        retain_until = max(deadlines) + CACHE_RETENTION_GRACE_SECONDS
        return max(1, min(MAX_CACHE_RETENTION_SECONDS, math.ceil(retain_until - now)))

    @staticmethod
    def _refresh_due_at(
        record: Optional[Dict[str, Any]],
        now: float,
        retry_delay: Optional[float] = None,
    ) -> Optional[float]:
        if retry_delay is not None:
            return now + max(1.0, float(retry_delay))
        sources = record.get("sources", []) if isinstance(record, dict) else []
        deadlines = []
        for source in (sources if isinstance(sources, list) else []):
            if not isinstance(source, dict):
                continue
            try:
                deadline = float(source.get("refresh_at"))
            except (TypeError, ValueError):
                continue
            if math.isfinite(deadline):
                deadlines.append(deadline)
        if not deadlines:
            return None
        return max(now, min(deadlines) - REFRESH_LEAD_SECONDS)

    @classmethod
    def schedule_stream_refresh(
        cls,
        video_id: str,
        record: Optional[Dict[str, Any]] = None,
        *,
        retry_delay: Optional[float] = None,
        now: Optional[float] = None,
    ) -> bool:
        """Persist the next metadata refresh deadline without storing media bytes or raw URLs."""
        clean_id = (video_id or "").strip()
        redis_client = _get_redis()
        if not clean_id or not redis_client:
            return False

        current_time = time.time() if now is None else float(now)
        due_at = cls._refresh_due_at(record, current_time, retry_delay)
        if due_at is None:
            return False

        try:
            redis_client.zadd(STREAM_REFRESH_DUE_KEY, {clean_id: due_at})
            return True
        except Exception as exc:
            logger.warning("[StreamCache] Could not schedule refresh for %s: %s", clean_id, exc)
            return False

    @classmethod
    def get_stream_fast(
        cls, video_id: str, *, record_metrics: bool = True
    ) -> Optional[LegacyStreamResponse]:
        """
        Fast-path cache lookup for user song selection (L1 in-memory -> L2 Redis).
        Returns immediately without blocking on network if a valid, unexpired stream exists.
        Target latency: < 2ms.
        """
        clean_id = (video_id or "").strip()
        if not clean_id or len(clean_id) < 5:
            return None

        redis_client = _get_redis()
        if not redis_client:
            _l1_cache.pop(clean_id, None)
            _l1_cache_ts.pop(clean_id, None)
            return None

        now = time.time()
        _clean_l1_cache()
        if clean_id in _l1_cache and (now - _l1_cache_ts.get(clean_id, 0)) < L1_CACHE_TTL:
            cached_record = _l1_cache[clean_id]
            if cls._matches_fence(redis_client, clean_id, cached_record):
                cached_data = cls._validate_cache_record(cached_record, now, clean_id)
            else:
                cached_data = None
            if cached_data:
                if record_metrics:
                    _record_metric("l1_hits")
                _cache_l1(clean_id, cached_data, now)
                cached_response = cls._public_response(cached_data)
                cached_response["cached"] = True
                cached_response["cache_tier"] = "L1_MEMORY"
                return cached_response
            else:
                _l1_cache.pop(clean_id, None)
                _l1_cache_ts.pop(clean_id, None)

        try:
            cache_key = f"{STREAM_CACHE_PREFIX}{clean_id}"
            raw_result = redis_client.eval(
                READ_FENCED_CACHE_LUA,
                2,
                cache_key,
                f"{STREAM_FENCE_PREFIX}{clean_id}",
            )
            raw_json = cls._fenced_read_payload(raw_result)
            if raw_json is None and isinstance(raw_result, (list, tuple)):
                status = raw_result[0].decode("utf-8") if isinstance(raw_result[0], bytes) else str(raw_result[0])
                if status == "invalid_cache_record" and len(raw_result) > 1:
                    cls._invalidate_raw_cache_record(redis_client, clean_id, raw_result[1])
            if raw_json:
                try:
                    raw_record = json.loads(raw_json)
                except (TypeError, ValueError):
                    cls._invalidate_raw_cache_record(redis_client, clean_id, raw_json)
                    _record_metric("invalid_cache_records")
                    return None
                expired_count = cls._expired_candidate_count(raw_record, now)
                if expired_count:
                    _record_metric("expired_candidates_rejected", expired_count)
                    _record_metric("expirations_detected", expired_count)
                stream_data = cls._validate_cache_record(raw_record, now, clean_id)
                if stream_data and cls._matches_fence(redis_client, clean_id, stream_data):
                    if raw_record != stream_data:
                        ttl = cls._cache_retention_ttl(stream_data, now)
                        if ttl <= 0:
                            cls._invalidate_raw_cache_record(redis_client, clean_id, raw_json)
                            return None
                        migrated = redis_client.eval(
                            WRITE_FENCED_CACHE_LUA,
                            3,
                            f"{STREAM_FENCE_PREFIX}{clean_id}",
                            cache_key,
                            STREAM_REFRESH_DUE_KEY,
                            str(stream_data["generation"]),
                            stream_data["fence_token"],
                            ttl,
                            json.dumps(stream_data),
                            clean_id,
                            cls._refresh_due_at(stream_data, now),
                        )
                        if not migrated:
                            return None
                    if record_metrics:
                        _record_metric("redis_hits")
                    _cache_l1(clean_id, stream_data, now)
                    cached_response = cls._public_response(stream_data)
                    cached_response["cached"] = True
                    cached_response["cache_tier"] = "L2_REDIS"
                    return cached_response
                schema_version = raw_record.get("schema_version", 0) if isinstance(raw_record, dict) else None
                retain_expired_metadata = (
                    expired_count > 0
                    and isinstance(schema_version, int)
                    and not isinstance(schema_version, bool)
                    and schema_version in (0, 1)
                )
                if not stream_data and not retain_expired_metadata:
                    cls._invalidate_raw_cache_record(redis_client, clean_id, raw_json)
                _l1_cache.pop(clean_id, None)
                _l1_cache_ts.pop(clean_id, None)
                if not expired_count:
                    _record_metric("invalid_cache_records")
        except Exception as exc:
            logger.warning("[StreamCache] Fenced Redis read failed for %s: %s", clean_id, exc)

        return None

    @classmethod
    def get_stream(cls, video_id: str, priority: str = "high", force_fresh: bool = False) -> Optional[LegacyStreamResponse]:
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
    ) -> Optional[LegacyStreamResponse]:
        """
        Coordinates concurrent requests for the same track using Redis distributed locking.
        Only one worker queries upstream; other workers wait and read the cached result.
        """
        lock_key = f"{STREAM_LOCK_PREFIX}{video_id}"
        lock_token = str(uuid.uuid4())
        cache_key = f"{STREAM_CACHE_PREFIX}{video_id}"
        previous_record = None
        fence = None
        expected_fence = None
        lock_acquired = False
        if redis_client:
            try:
                lock_acquired = bool(redis_client.set(
                    lock_key, lock_token, nx=True, ex=LOCK_EXPIRE_SECONDS
                ))
                if not lock_acquired:
                    poll_interval = 0.05 if priority == "high" else 0.15
                    max_wait = STREAM_RESOLUTION_TIMEOUT_SECONDS + LOCK_RENEW_INTERVAL_SECONDS
                    return cls._poll_for_result(video_id, redis_client, poll_interval=poll_interval, max_wait_sec=max_wait)
                previous_record = cls._read_current_record(redis_client, video_id)
                if previous_record:
                    expected_fence = {
                        "generation": previous_record["generation"],
                        "fence_token": previous_record["fence_token"],
                    }
                    fence = {
                        "generation": int(previous_record["generation"]) + 1,
                        "fence_token": uuid.uuid4().hex,
                    }
                else:
                    fence = cls._advance_fence(redis_client, video_id)
                    expected_fence = dict(fence)
                    _l1_cache.pop(video_id, None)
                    _l1_cache_ts.pop(video_id, None)
            except Exception as exc:
                logger.warning("[StreamCache] Redis coordination failed for %s: %s", video_id, exc)
                if lock_acquired:
                    try:
                        redis_client.eval(RELEASE_LOCK_LUA, 1, lock_key, lock_token)
                    except Exception:
                        pass
                redis_client = None
                lock_acquired = False
                fence = None
                expected_fence = None
                previous_record = None

        def preserve_current_candidates(now: float) -> Optional[LegacyStreamResponse]:
            """Return old, still-valid candidates while a failed refresh leaves the cache intact."""
            if not (redis_client and lock_acquired and previous_record):
                return None
            if not cls._matches_fence(redis_client, video_id, previous_record):
                return None
            sources = cls._validate_source_candidates(previous_record.get("sources"), now, video_id)
            if not sources:
                return None

            fallback = dict(previous_record)
            fallback["sources"] = sources
            fallback = cls._validate_cache_record(fallback, now, video_id)
            if not fallback:
                return None

            response = cls._public_response(fallback)
            response["cached"] = True
            response["cache_tier"] = "L2_STALE_WHILE_REFRESH"
            cls.schedule_stream_refresh(video_id, retry_delay=60, now=now)
            return response

        def resolve_and_commit() -> Optional[LegacyStreamResponse]:
            nonlocal previous_record, fence
            stream_result = cls._extract_upstream(video_id)
            now = time.time()
            stream_result = cls._validate_cache_record(stream_result, now, video_id)

            if stream_result and previous_record:
                existing_modes = {source["mode"] for source in stream_result["sources"]}
                alternates = cls._validate_source_candidates(
                    previous_record.get("sources"), now, video_id
                )
                stream_result["sources"].extend(
                    source for source in alternates if source["mode"] not in existing_modes
                )

            if not stream_result:
                _record_metric("extractions_failed")
                return preserve_current_candidates(now)

            if fence:
                stream_result.update(fence)
                stream_result["schema_version"] = 1
                stream_result["video_id"] = video_id
                stream_result["refreshed_at"] = now
            stream_result = cls._validate_cache_record(stream_result, now, video_id)
            if not stream_result:
                _record_metric("extractions_failed")
                return preserve_current_candidates(now)

            if redis_client and lock_acquired and fence:
                ttl = cls._cache_retention_ttl(stream_result, now)
                if ttl <= 0:
                    return preserve_current_candidates(now)
                committed = redis_client.eval(
                    COMMIT_FENCED_CACHE_LUA,
                    4,
                    f"{STREAM_FENCE_PREFIX}{video_id}",
                    lock_key,
                    cache_key,
                    STREAM_REFRESH_DUE_KEY,
                    str(expected_fence["generation"]),
                    expected_fence["fence_token"],
                    str(fence["generation"]),
                    fence["fence_token"],
                    lock_token,
                    ttl,
                    json.dumps(stream_result),
                    video_id,
                    cls._refresh_due_at(stream_result, now),
                )
                if not committed:
                    _record_metric("stale_write_rejections")
                    return None
                stream_result["cached"] = False
                _cache_l1(video_id, stream_result, now)
                _record_metric("extractions_success")
            else:
                stream_result["generation"] = 0
                stream_result.pop("fence_token", None)
                stream_result["cached"] = False

            return cls._public_response(stream_result)

        try:
            if redis_client and lock_acquired:
                with _renew_lock_lease(redis_client, lock_key, lock_token):
                    return resolve_and_commit()
            return resolve_and_commit()
        finally:
            if redis_client and lock_acquired:
                try:
                    redis_client.eval(RELEASE_LOCK_LUA, 1, lock_key, lock_token)
                except Exception as exc:
                    logger.debug("[StreamCache] Redis lock release ignored: %s", exc)

        return None

    @classmethod
    def _poll_for_result(
        cls, video_id: str, redis_client: Any, poll_interval: float = 0.1, max_wait_sec: float = 4.0
    ) -> Optional[LegacyStreamResponse]:
        """Follower workers poll Redis for the winning worker's resolved stream."""
        deadline = time.time() + max_wait_sec

        while time.time() < deadline:
            time.sleep(poll_interval)
            try:
                data = cls._read_current_record(redis_client, video_id)
                if data:
                    data["cached"] = True
                    data["cache_tier"] = "COALESCED_REDIS"
                    return cls._public_response(data)
            except Exception:
                pass

        logger.info("[StreamCache] Single-flight poll timed out for %s.", video_id)
        return None

    @classmethod
    def _extract_upstream(cls, video_id: str) -> Optional[LegacyStreamResponse]:
        """Resolve audio metadata from at most two rate-limited Invidious origins."""
        if not video_id:
            return None

        deadline = time.monotonic() + STREAM_RESOLUTION_TIMEOUT_SECONDS
        redis_client = _get_redis()
        user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        fields = "title,adaptiveFormats,formatStreams"

        attempted_origins = 0
        for instance in _rotated_invidious_instances():
            if attempted_origins >= MAX_ORIGINS_PER_RESOLUTION:
                break
            if time.monotonic() >= deadline:
                break

            health_key = f"{HEALTH_PREFIX}{instance.name}"
            if redis_client:
                try:
                    cooldown = redis_client.hget(health_key, "cooldown_until")
                    if cooldown and time.time() < float(cooldown):
                        continue
                except Exception:
                    pass

            # Cooled origins are skipped without using this resolution's bounded
            # request allowance; keep walking so a healthy later mirror can fill it.
            attempted_origins += 1
            endpoint = (
                f"{instance.origin}/api/v1/videos/"
                f"{urllib.parse.quote(video_id, safe='')}?fields={fields}"
            )
            request = urllib.request.Request(
                endpoint,
                headers={"User-Agent": user_agent, "Accept": "application/json"},
            )
            request_started = time.monotonic()
            try:
                limiter = _get_origin_limiter(instance)
                with limiter.acquire(deadline, redis_client):
                    timeout = deadline - time.monotonic()
                    if timeout <= 0:
                        raise TimeoutError("Invidious resolution deadline exceeded")
                    with urllib.request.urlopen(request, timeout=timeout) as response:
                        if response.status != 200:
                            cls._record_failure(
                                instance.name,
                                redis_client,
                                origin_level_failure=(
                                    response.status in {401, 403, 429} or response.status >= 500
                                ),
                            )
                            continue
                        data = json.loads(response.read().decode("utf-8"))

                audio_formats = []
                for candidate in data.get("adaptiveFormats", []):
                    mime_type = str(candidate.get("type") or "")
                    url = str(candidate.get("url") or "")
                    media_type = mime_type.split(";", 1)[0].strip().lower()
                    try:
                        itag = int(candidate.get("itag") or 0)
                    except (TypeError, ValueError):
                        continue
                    if (
                        itag > 0
                        and media_type in {"audio/mp4", "audio/webm"}
                        and url.startswith("https://")
                    ):
                        audio_formats.append(candidate)

                if not audio_formats:
                    cls._record_failure(instance.name, redis_client)
                    continue

                aac_lc = next(
                    (item for item in audio_formats if "mp4a.40.2" in str(item.get("type", ""))),
                    None,
                )
                m4a_formats = [
                    item for item in audio_formats
                    if "audio/mp4" in str(item.get("type", "")).lower()
                ]
                best = aac_lc or max(
                    m4a_formats or audio_formats,
                    key=lambda item: int(item.get("bitrate") or 0),
                )
                mime_type = str(best.get("type") or "audio/mp4")
                media_type = mime_type.split(";", 1)[0].strip().lower()
                codec_match = re.search(r'codecs\s*=\s*["\']?([^;"\']+)', mime_type, re.IGNORECASE)
                codec = codec_match.group(1).strip() if codec_match else (
                    "mp4a.40.2" if media_type == "audio/mp4" else "opus"
                )
                stream_format = "M4A" if media_type == "audio/mp4" else "WEBM_OPUS"
                bitrate = int(best.get("bitrate") or 128000)
                itag = int(best["itag"])
                direct_url = str(best["url"])
                resolved_at = time.time()
                expiry = extract_url_expiry(direct_url)
                direct_source: Optional[SourceCandidate] = None

                if expiry is None or expiry > resolved_at + EXPIRY_BUFFER_SECONDS:
                    direct_source = {
                        "mode": "direct",
                        "provider": "invidious",
                        "provider_origin": instance.origin,
                        "url": direct_url,
                        "itag": itag,
                        "mime_type": mime_type,
                        "codec": codec,
                        "resolved_at": resolved_at,
                        "expires_at": float(expiry) if expiry is not None else None,
                        "refresh_at": float(expiry - EXPIRY_BUFFER_SECONDS)
                        if expiry is not None else resolved_at + CONSERVATIVE_TTL,
                        "validation_state": "validated",
                        "type": "direct",
                        "format": stream_format,
                        "mimeType": mime_type,
                        "bitrate": bitrate,
                    }

                proxy_query = urllib.parse.urlencode({
                    "id": video_id,
                    "itag": itag,
                    "local": "true",
                })
                proxy_url = f"{instance.origin}/latest_version?{proxy_query}"
                proxy_source: SourceCandidate = {
                    "mode": "proxy",
                    "provider": "invidious",
                    "provider_origin": instance.origin,
                    "url": proxy_url,
                    "itag": itag,
                    "mime_type": mime_type,
                    "codec": codec,
                    "resolved_at": resolved_at,
                    "expires_at": None,
                    "refresh_at": resolved_at + CONSERVATIVE_TTL,
                    "validation_state": "validated",
                    "type": "proxy",
                    "format": stream_format,
                    "mimeType": mime_type,
                    "bitrate": bitrate,
                }
                sources = ([direct_source] if direct_source else []) + [proxy_source]
                latency_ms = int((time.monotonic() - request_started) * 1000)
                response = {
                    "schema_version": 1,
                    "video_id": video_id,
                    "refreshed_at": resolved_at,
                    "sources": sources,
                    "duration": _extract_duration(data, best),
                    "title": data.get("title", f"Chhath Song ({video_id})"),
                    "extractor": instance.name,
                }
                validated_response = cls._validate_cache_record(response, resolved_at, video_id)
                if not validated_response:
                    cls._record_failure(instance.name, redis_client)
                    continue
                cls._record_success(instance.name, latency_ms, redis_client)
                return validated_response
            except urllib.error.HTTPError as exc:
                logger.info(
                    "[StreamCache] Invidious origin %s returned HTTP %d for video %s.",
                    instance.name,
                    exc.code,
                    video_id,
                )
                exc.close()
                cls._record_failure(
                    instance.name,
                    redis_client,
                    origin_level_failure=(exc.code in {401, 403, 429} or exc.code >= 500),
                )
                if time.monotonic() >= deadline:
                    break
            except Exception as exc:
                logger.info(
                    "[StreamCache] Invidious origin %s failed resolving video %s (%s).",
                    instance.name,
                    video_id,
                    type(exc).__name__,
                )
                origin_level_failure = isinstance(
                    exc,
                    (TimeoutError, urllib.error.URLError, ConnectionError, OSError),
                ) and not (
                    isinstance(exc, TimeoutError)
                    and "budget exhausted" in str(exc).lower()
                )
                cls._record_failure(
                    instance.name,
                    redis_client,
                    origin_level_failure=origin_level_failure,
                )
                if time.monotonic() >= deadline:
                    break

        return None

    @classmethod
    def _record_failure(
        cls,
        name: str,
        redis_client: Optional[Any],
        *,
        origin_level_failure: bool = False,
    ) -> None:
        """Record video failure; cool the origin only after repeated systemic failures."""
        if not redis_client:
            return
        try:
            health_key = f"{HEALTH_PREFIX}{name}"
            failure_key = f"{ORIGIN_FAILURE_PREFIX}{name}"
            pipe = redis_client.pipeline()
            pipe.hincrby(health_key, "fail_count", 1)
            pipe.expire(health_key, 86400)
            if origin_level_failure:
                pipe.hincrby(failure_key, "count", 1)
                pipe.expire(failure_key, ORIGIN_FAILURE_WINDOW_SECONDS)
            results = pipe.execute()
            if origin_level_failure and int(results[2]) >= ORIGIN_FAILURE_THRESHOLD:
                redis_client.hset(
                    health_key,
                    "cooldown_until",
                    str(time.time() + COOLDOWN_SECONDS),
                )
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
            redis_client.delete(f"{ORIGIN_FAILURE_PREFIX}{name}")
        except Exception:
            pass

    @classmethod
    def invalidate_stream(cls, video_id: str, source_type: str = "all") -> None:
        """Fence and invalidate one source set, preserving a valid proxy on direct demotion."""
        clean_id = (video_id or "").strip()
        if not clean_id:
            return

        redis_client = _get_redis()
        _l1_cache.pop(clean_id, None)
        _l1_cache_ts.pop(clean_id, None)
        if not redis_client:
            return

        try:
            current = cls._read_current_record(redis_client, clean_id)
            if source_type == "direct" and current:
                proxy_sources = [
                    source for source in cls._validate_source_candidates(
                        current.get("sources"), time.time(), clean_id
                    ) if source["mode"] == "proxy"
                ]
                if proxy_sources:
                    fence = cls._advance_fence(redis_client, clean_id)
                    current.update(fence)
                    current["sources"] = proxy_sources
                    current = cls._validate_cache_record(current, time.time(), clean_id)
                    ttl = cls._cache_retention_ttl(current, time.time()) if current else 0
                    if current and ttl > 0:
                        written = redis_client.eval(
                            WRITE_FENCED_CACHE_LUA,
                            3,
                            f"{STREAM_FENCE_PREFIX}{clean_id}",
                            f"{STREAM_CACHE_PREFIX}{clean_id}",
                            STREAM_REFRESH_DUE_KEY,
                            str(fence["generation"]),
                            fence["fence_token"],
                            ttl,
                            json.dumps(current),
                            clean_id,
                            cls._refresh_due_at(current, time.time()),
                        )
                        if written:
                            _cache_l1(clean_id, current)
                            _record_metric("degraded_promotions")
                            return
                        _record_metric("stale_write_rejections")

            expected_token = current.get("fence_token") if current else None
            cls._evict_fenced_record(redis_client, clean_id, expected_token)
            _record_metric("invalidations")
        except Exception as exc:
            logger.warning("[StreamCache] Fenced invalidation failed for %s: %s", clean_id, exc)

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
                        deleted_count += cls._evict_fenced_record(redis_client, cid)
                    except Exception as exc:
                        logger.warning("[StreamCache] Fenced flush failed for %s: %s", cid, exc)
            _record_metric("invalidations", len(clean_ids))
            logger.info("[StreamCache] Selectively flushed %d stream(s) for %d requested track(s). Telemetry preserved.", deleted_count, len(clean_ids))
        else:
            # ENTIRE CATALOG FLUSH: Flush all cached streams and reset telemetry metrics.
            known_ids = set(_l1_cache)
            _l1_cache.clear()
            _l1_cache_ts.clear()
            if redis_client:
                try:
                    cursor = 0
                    while True:
                        cursor, keys = redis_client.scan(cursor=cursor, match=f"{STREAM_CACHE_PREFIX}*", count=100)
                        known_ids.update(
                            key.decode("utf-8") if isinstance(key, bytes) else str(key)
                            for key in keys
                        )
                        if cursor == 0:
                            break

                    for cache_key in known_ids:
                        if cache_key.startswith(STREAM_CACHE_PREFIX):
                            cache_key = cache_key[len(STREAM_CACHE_PREFIX):]
                        try:
                            deleted_count += cls._evict_fenced_record(redis_client, cache_key)
                        except Exception as exc:
                            logger.warning("[StreamCache] Fenced flush failed for %s: %s", cache_key, exc)

                    # Reset metrics counters ONLY on full on-demand cache flush
                    redis_client.delete(STREAM_METRICS_KEY)
                    redis_client.delete(STREAM_REFRESH_DUE_KEY)
                except Exception as exc:
                    logger.warning("[StreamCache] Redis flush all failed: %s", exc)

            logger.info("[StreamCache] Flushed entire stream cache (%d streams) and reset telemetry metrics.", deleted_count)

        return deleted_count

    @classmethod
    def get_catalog_cache_summary(cls, video_ids: List[str]) -> Dict[str, Any]:
        """Summarize fenced source readiness without returning URLs or counting playback hits."""
        clean_ids = list(dict.fromkeys(
            value.strip() for value in video_ids
            if isinstance(value, str) and len(value.strip()) >= 5
        ))
        modes: Dict[str, Dict[str, Union[int, float]]] = {
            mode: {
                "ready": 0,
                "expiring": 0,
                "overdue": 0,
                "missing": 0,
                "unavailable": 0,
                "oldest_overdue_age_seconds": 0,
            }
            for mode in ("direct", "proxy")
        }
        result: Dict[str, Any] = {
            "cache_available": False,
            "lookup_errors": 0,
            "songs_ready": 0,
            "songs_missing": len(clean_ids),
            "songs_fully_warm": 0,
            "songs_partial": 0,
            "songs_expiring": 0,
            "modes": modes,
        }
        if not clean_ids:
            return result

        redis_client = _get_redis()
        if not redis_client:
            for summary in modes.values():
                summary["missing"] = 0
                summary["unavailable"] = len(clean_ids)
            return result
        result["cache_available"] = True

        now = time.time()
        ready_song_count = 0
        fully_warm_count = 0
        partial_song_count = 0
        expiring_song_count = 0
        read_results = None
        pipeline_factory = getattr(redis_client, "pipeline", None)
        if callable(pipeline_factory):
            try:
                pipeline = pipeline_factory(transaction=False)
                for video_id in clean_ids:
                    pipeline.eval(
                        READ_FENCED_CACHE_LUA,
                        2,
                        f"{STREAM_CACHE_PREFIX}{video_id}",
                        f"{STREAM_FENCE_PREFIX}{video_id}",
                    )
                candidate_results = pipeline.execute()
                if isinstance(candidate_results, (list, tuple)) and len(candidate_results) == len(clean_ids):
                    read_results = candidate_results
            except Exception as exc:
                logger.debug("[StreamCache] Batched catalog inspection unavailable: %s", exc)

        for index, video_id in enumerate(clean_ids):
            try:
                raw_result = (
                    read_results[index]
                    if read_results is not None
                    else redis_client.eval(
                        READ_FENCED_CACHE_LUA,
                        2,
                        f"{STREAM_CACHE_PREFIX}{video_id}",
                        f"{STREAM_FENCE_PREFIX}{video_id}",
                    )
                )
                raw = cls._fenced_read_payload(raw_result)
                if not raw:
                    for summary in modes.values():
                        summary["missing"] += 1
                    continue

                record = json.loads(raw)
                if (
                    not isinstance(record, dict)
                    or record.get("schema_version") != 1
                    or record.get("video_id") != video_id
                    or type(record.get("generation")) is not int
                    or record["generation"] < 1
                    or not isinstance(record.get("fence_token"), str)
                ):
                    _record_metric("invalid_cache_records")
                    for summary in modes.values():
                        summary["missing"] += 1
                    continue

                sources = record.get("sources", [])
                valid_sources = cls._validate_source_candidates(sources, now, video_id)
                valid_by_mode = {source["mode"]: source for source in valid_sources}
                source_list = sources if isinstance(sources, list) else []
                song_expiring = False

                for mode, summary in modes.items():
                    current = valid_by_mode.get(mode)
                    if current:
                        summary["ready"] += 1
                        if current["refresh_at"] - now <= REFRESH_LEAD_SECONDS:
                            summary["expiring"] += 1
                            song_expiring = True
                        continue

                    overdue_ages = []
                    for source in source_list:
                        if not isinstance(source, dict) or source.get("mode") != mode:
                            continue
                        try:
                            deadline = float(source.get("refresh_at"))
                            resolved_at = float(source.get("resolved_at"))
                        except (TypeError, ValueError):
                            continue
                        reference_time = min(now, deadline - 0.001)
                        if (
                            math.isfinite(deadline)
                            and deadline <= now
                            and reference_time >= resolved_at
                            and cls._validate_source_candidates([source], reference_time, video_id)
                        ):
                            overdue_ages.append(max(0.0, now - deadline))

                    if overdue_ages:
                        summary["overdue"] += 1
                        summary["oldest_overdue_age_seconds"] = max(
                            summary["oldest_overdue_age_seconds"], max(overdue_ages)
                        )
                    else:
                        summary["missing"] += 1

                if valid_by_mode:
                    ready_song_count += 1
                is_fully_warm = all(
                    mode in valid_by_mode
                    and valid_by_mode[mode]["refresh_at"] - now > REFRESH_LEAD_SECONDS
                    for mode in ("direct", "proxy")
                )
                if is_fully_warm:
                    fully_warm_count += 1
                elif valid_by_mode:
                    partial_song_count += 1
                if song_expiring:
                    expiring_song_count += 1
            except Exception as exc:
                logger.debug("[StreamCache] Catalog cache inspection failed for %s: %s", video_id, exc)
                result["lookup_errors"] += 1
                for summary in modes.values():
                    summary["unavailable"] += 1

        result["songs_ready"] = ready_song_count
        result["songs_missing"] = max(0, len(clean_ids) - ready_song_count)
        result["songs_fully_warm"] = fully_warm_count
        result["songs_partial"] = partial_song_count
        result["songs_expiring"] = expiring_song_count
        return result

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
            "expired_candidates_rejected": 0,
            "generation_mismatches": 0,
            "stale_write_rejections": 0,
            "invalid_cache_records": 0,
            "stale_expired_serves": 0,
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
