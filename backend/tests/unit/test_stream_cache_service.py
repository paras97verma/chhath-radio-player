"""
Unit tests for StreamCacheService with Redis caching and single-flight request coalescing.
"""

import json
import time
from dataclasses import dataclass, field
from threading import Event, Lock, Thread, current_thread
from typing import Dict, Optional
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request
from unittest.mock import MagicMock, patch
import unittest

try:
    import pytest
except ImportError:
    pytest = None

from app.services.stream_cache_service import (
    StreamCacheService,
    _extract_duration,
    _l1_cache,
    _l1_cache_ts,
    STREAM_CACHE_PREFIX,
    STREAM_METRICS_KEY,
    STREAM_LOCK_PREFIX,
    RELEASE_LOCK_LUA,
    extract_url_expiry,
    is_url_expired,
)
import app.services.stream_cache_service as cache_module


@pytest.fixture(autouse=True)
def clean_caches():
    """Clear in-memory L1 cache before each test."""
    _l1_cache.clear()
    _l1_cache_ts.clear()
    yield
    _l1_cache.clear()
    _l1_cache_ts.clear()


@dataclass(frozen=True)
class FakeOriginReply:
    """One deterministic HTTP response or failure for a resolver test."""

    status: int = 200
    body: bytes = b"{}"
    headers: Dict[str, str] = field(default_factory=dict)
    response_url: Optional[str] = None
    delay_seconds: float = 0.0
    error: Optional[Exception] = None


class FakeResolverClock:
    """Wall clock that tests can advance without sleeping."""

    def __init__(self, now: float):
        self.now = float(now)

    def time(self) -> float:
        return self.now

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class _FakeHTTPResponse:
    def __init__(self, reply: FakeOriginReply, request_url: str, on_close):
        self.status = reply.status
        self.headers = dict(reply.headers)
        self.url = reply.response_url or request_url
        self._body = reply.body
        self._on_close = on_close
        self._closed = False

    def read(self, size: int = -1) -> bytes:
        return self._body if size < 0 else self._body[:size]

    def geturl(self) -> str:
        return self.url

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._on_close()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


class FakeCacheRedis:
    """Thread-safe minimal Redis store for cache refresh/flush interleavings."""

    def __init__(self):
        self.values = {}
        self.hashes = {}
        self.sorted_sets = {}
        self.ttls = {}
        self._lock = Lock()

    def zadd(self, key, mapping):
        with self._lock:
            target = self.sorted_sets.setdefault(key, {})
            added = sum(member not in target for member in mapping)
            target.update({member: float(score) for member, score in mapping.items()})
            return added

    def zrem(self, key, *members):
        with self._lock:
            target = self.sorted_sets.get(key, {})
            removed = sum(member in target for member in members)
            for member in members:
                target.pop(member, None)
            return removed

    def zscore(self, key, member):
        with self._lock:
            return self.sorted_sets.get(key, {}).get(member)

    def zrangebyscore(self, key, min, max, start=0, num=None, withscores=False):
        lower = float("-inf") if min == "-inf" else float(min)
        upper = float("inf") if max == "+inf" else float(max)
        with self._lock:
            rows = sorted(
                (member, score)
                for member, score in self.sorted_sets.get(key, {}).items()
                if lower <= score <= upper
            )
        rows = rows[start: start + num if num is not None else None]
        return rows if withscores else [member for member, _score in rows]

    def pipeline(self, transaction=False):
        return FakeCachePipeline(self)

    def get(self, key):
        with self._lock:
            return self.values.get(key)

    def set(self, key, value, nx=False, ex=None):
        with self._lock:
            if nx and key in self.values:
                return False
            self.values[key] = value
            return True

    def setex(self, key, _ttl, value):
        with self._lock:
            self.values[key] = value
            self.ttls[key] = int(_ttl)
            return True

    def hgetall(self, key):
        with self._lock:
            return dict(self.hashes.get(key, {}))

    def delete(self, *keys):
        deleted = 0
        with self._lock:
            for key in keys:
                if key in self.values:
                    deleted += 1
                    del self.values[key]
                self.ttls.pop(key, None)
                self.hashes.pop(key, None)
                self.sorted_sets.pop(key, None)
        return deleted

    def scan(self, cursor=0, match="*", count=100):
        from fnmatch import fnmatch
        with self._lock:
            keys = list(self.values) + list(self.hashes)
            return 0, [key for key in keys if fnmatch(key, match)][:count]

    def eval(self, script, numkeys, *args):
        with self._lock:
            if script == cache_module.ADVANCE_FENCE_LUA:
                fence_key, token = args
                fence = self.hashes.setdefault(fence_key, {})
                generation = int(fence.get("generation", 0)) + 1
                fence.update({"generation": str(generation), "fence_token": token})
                return [generation, token]
            if script == cache_module.READ_FENCED_CACHE_LUA:
                cache_key, fence_key = args
                raw = self.values.get(cache_key)
                fence = self.hashes.get(fence_key, {})
                if not raw:
                    return None
                if not fence.get("fence_token"):
                    return ["generation_mismatch", raw]
                try:
                    record = json.loads(raw)
                except (TypeError, ValueError):
                    return ["invalid_cache_record", raw]
                if (
                    int(record.get("generation", 0)) != int(fence.get("generation", 0))
                    or record.get("fence_token") != fence.get("fence_token")
                ):
                    return ["generation_mismatch", raw]
                return raw
            if script == cache_module.INVALIDATE_CACHE_RAW_LUA:
                (cache_key, expected_raw) = args
                if self.values.get(cache_key) == expected_raw:
                    self.values.pop(cache_key, None)
                    self.ttls.pop(cache_key, None)
                    return 1
                return 0
            if script == cache_module.MATCH_FENCE_LUA:
                fence_key, generation, token = args
                fence = self.hashes.get(fence_key, {})
                return int(
                    str(fence.get("generation")) == str(generation)
                    and fence.get("fence_token") == token
                )
            if script == cache_module.COMMIT_FENCED_CACHE_LUA:
                (
                    fence_key, lock_key, cache_key, refresh_key,
                    expected_generation, expected_token, generation, fence_token,
                    lock_token, _ttl, raw, video_id, due_at,
                ) = args
                fence = self.hashes.get(fence_key, {})
                if (
                    str(fence.get("generation")) != str(expected_generation)
                    or fence.get("fence_token") != expected_token
                    or self.values.get(lock_key) != lock_token
                ):
                    return 0
                fence.update({"generation": str(generation), "fence_token": fence_token})
                self.values[cache_key] = raw
                self.ttls[cache_key] = int(_ttl)
                self.sorted_sets.setdefault(refresh_key, {})[video_id] = float(due_at)
                return 1
            if script == cache_module.WRITE_FENCED_CACHE_LUA:
                fence_key, cache_key, refresh_key, generation, fence_token, _ttl, raw, video_id, due_at = args
                fence = self.hashes.get(fence_key, {})
                if (
                    str(fence.get("generation")) != str(generation)
                    or fence.get("fence_token") != fence_token
                ):
                    return 0
                self.values[cache_key] = raw
                self.ttls[cache_key] = int(_ttl)
                self.sorted_sets.setdefault(refresh_key, {})[video_id] = float(due_at)
                return 1
            if script == cache_module.EVICT_FENCED_CACHE_LUA:
                fence_key, cache_key, lock_key, refresh_key, expected_token, new_token, video_id = args
                fence = self.hashes.setdefault(fence_key, {})
                if expected_token and fence.get("fence_token") != expected_token:
                    return [0, 0]
                generation = int(fence.get("generation", 0)) + 1
                fence.update({"generation": str(generation), "fence_token": new_token})
                deleted = int(cache_key in self.values)
                self.values.pop(cache_key, None)
                self.values.pop(lock_key, None)
                self.ttls.pop(cache_key, None)
                self.sorted_sets.get(refresh_key, {}).pop(video_id, None)
                return [generation, deleted]
            if script == cache_module.RENEW_LOCK_LUA:
                lock_key, token, _ttl = args
                return int(self.values.get(lock_key) == token)
            if script == RELEASE_LOCK_LUA:
                lock_key, token = args
                if self.values.get(lock_key) == token:
                    del self.values[lock_key]
                    return 1
        return 0

    def hincrby(self, key, field, amount):
        with self._lock:
            metrics = self.hashes.setdefault(key, {})
            metrics[field] = str(int(metrics.get(field, 0)) + int(amount))
            return int(metrics[field])


class FakeCachePipeline:
    def __init__(self, redis):
        self.redis = redis
        self.commands = []

    def eval(self, *args):
        self.commands.append(args)
        return self

    def execute(self):
        return [self.redis.eval(*args) for args in self.commands]


class FakeOriginLimiterRedis:
    """Shares origin limiter state between separate worker-local instances."""

    def __init__(self):
        self.slots = {}
        self.next_at = {}
        self.max_active = 0
        self._lock = Lock()

    def eval(self, script, _numkeys, *args):
        with self._lock:
            if script == cache_module.ORIGIN_LIMIT_ACQUIRE_LUA:
                slots_key, rate_key, token, concurrency, lease_ms, interval_ms, max_wait_ms = args
                now_ms = time.time() * 1000
                slots = self.slots.setdefault(slots_key, {})
                self.slots[slots_key] = {
                    key: expires for key, expires in slots.items() if expires > now_ms
                }
                slots = self.slots[slots_key]
                if len(slots) >= int(concurrency):
                    return [0, 1]
                start_at = max(now_ms, self.next_at.get(rate_key, now_ms))
                wait_ms = start_at - now_ms
                if wait_ms > int(max_wait_ms):
                    return [-1, wait_ms]
                slots[token] = now_ms + int(lease_ms)
                self.max_active = max(self.max_active, len(slots))
                self.next_at[rate_key] = start_at + int(interval_ms)
                return [1, wait_ms]
            if script == cache_module.ORIGIN_LIMIT_RELEASE_LUA:
                slots_key, token = args
                self.slots.setdefault(slots_key, {}).pop(token, None)
                return 1
            raise AssertionError("Unexpected Redis script")


class FakeResolverTransport:
    """URL-routed fake that records per-origin timing and open responses."""

    def __init__(self, clock: FakeResolverClock, replies, origin_limits):
        self.clock = clock
        self.replies = replies
        self.origin_limits = origin_limits
        self.requests = []
        self.active_by_origin = {}
        self.max_concurrency_by_origin = {}
        self._lock = Lock()

    def _finish(self, origin: str) -> None:
        with self._lock:
            self.active_by_origin[origin] -= 1

    def urlopen(self, request, timeout: Optional[float] = 5.0):
        request_url = request.full_url if hasattr(request, "full_url") else str(request)
        request_headers = dict(request.header_items()) if hasattr(request, "header_items") else {}
        parts = urlsplit(request_url)
        origin = f"{parts.scheme}://{parts.netloc}"
        with self._lock:
            self.requests.append({
                "url": request_url,
                "origin": origin,
                "headers": {key.lower(): value for key, value in request_headers.items()},
                "started_at": self.clock.time(),
                "timeout": timeout,
            })
            active = self.active_by_origin.get(origin, 0) + 1
            self.active_by_origin[origin] = active
            self.max_concurrency_by_origin[origin] = max(
                active, self.max_concurrency_by_origin.get(origin, 0)
            )

        reply = self.replies.get(request_url)
        if reply is None:
            self._finish(origin)
            raise AssertionError(f"Unexpected fake resolver request: {request_url}")

        if timeout is not None and reply.delay_seconds > timeout:
            self.clock.advance(float(timeout))
            self._finish(origin)
            raise TimeoutError(f"Fake origin exceeded {timeout}s request timeout")
        self.clock.advance(reply.delay_seconds)

        if reply.error is not None:
            self._finish(origin)
            raise reply.error

        return _FakeHTTPResponse(reply, request_url, lambda: self._finish(origin))


class FakeOriginHealthRedis:
    """Small Redis fake for resolver health and distributed-origin tests."""

    def __init__(self):
        self.hashes = {}
        self.expirations = {}

    def hget(self, key, field):
        return self.hashes.get(key, {}).get(field)

    def hset(self, key, field=None, value=None, mapping=None):
        target = self.hashes.setdefault(key, {})
        items = mapping if mapping is not None else {field: value}
        added = 0
        for item_key, item_value in items.items():
            added += item_key not in target
            target[item_key] = str(item_value)
        return added

    def hdel(self, key, *fields):
        target = self.hashes.setdefault(key, {})
        removed = 0
        for field in fields:
            removed += field in target
            target.pop(field, None)
        return removed

    def hincrby(self, key, field, amount):
        target = self.hashes.setdefault(key, {})
        target[field] = str(int(target.get(field, 0)) + int(amount))
        return int(target[field])

    def expire(self, key, seconds):
        self.expirations[key] = seconds
        return True

    def delete(self, *keys):
        for key in keys:
            self.hashes.pop(key, None)
            self.expirations.pop(key, None)
        return len(keys)

    def pipeline(self):
        return FakeOriginHealthPipeline(self)

    def eval(self, script, _numkeys, *args):
        if script == cache_module.ORIGIN_LIMIT_ACQUIRE_LUA:
            return [1, 0]
        if script == cache_module.ORIGIN_LIMIT_RELEASE_LUA:
            return 1
        raise AssertionError("Unexpected Redis script in resolver test")


class FakeOriginHealthPipeline:
    def __init__(self, redis):
        self.redis = redis
        self.commands = []

    def hincrby(self, *args):
        self.commands.append((self.redis.hincrby, args))
        return self

    def hset(self, *args, **kwargs):
        self.commands.append((self.redis.hset, args, kwargs))
        return self

    def hdel(self, *args):
        self.commands.append((self.redis.hdel, args))
        return self

    def expire(self, *args):
        self.commands.append((self.redis.expire, args))
        return self

    def execute(self):
        results = []
        for command in self.commands:
            method, args, *kwargs = command
            results.append(method(*args, **(kwargs[0] if kwargs else {})))
        return results


def make_source_candidate(
    mode, now, *, expires_at=None, resolved_at=None, refresh_at=None,
    video_id="fixture-video", url=None,
):
    if mode == "direct":
        source_url = url or f"https://media.test/videoplayback?id={video_id}&itag=140"
        if expires_at is not None and "expire=" not in source_url:
            source_url += f"&expire={int(expires_at)}"
    else:
        origin = cache_module.INVIDIOUS_REGISTRY[0].origin
        source_url = url or f"{origin}/latest_version?id={video_id}&itag=140&local=true"
    return {
        "mode": mode,
        "provider": "invidious",
        "provider_origin": cache_module.INVIDIOUS_REGISTRY[0].origin,
        "url": source_url,
        "itag": 140,
        "mime_type": 'audio/mp4; codecs="mp4a.40.2"',
        "codec": "mp4a.40.2",
        "resolved_at": now if resolved_at is None else resolved_at,
        "expires_at": expires_at,
        "refresh_at": (now if resolved_at is None else resolved_at) + 1800
        if refresh_at is None else refresh_at,
        "validation_state": "validated",
    }


def make_stream_record(
    video_id, now=None, *, direct_url=None, direct_expires_at=None,
    include_proxy=True, title="Test song",
):
    now = time.time() if now is None else float(now)
    sources = [make_source_candidate(
        "direct", now, video_id=video_id, url=direct_url, expires_at=direct_expires_at,
    )]
    if include_proxy:
        sources.append(make_source_candidate("proxy", now, video_id=video_id))
    record = make_cache_record(sources, now)
    record["video_id"] = video_id
    record["title"] = title
    return StreamCacheService._validate_cache_record(record, now, video_id)


def make_cache_record(sources, now):
    return {
        "schema_version": 1,
        "video_id": "fixture-video",
        "generation": 4,
        "fence_token": "fixture-fence",
        "refreshed_at": now,
        "sources": sources,
        "last_resolution": None,
    }


@pytest.fixture
def resolver_harness(monkeypatch):
    """Reusable deterministic expiry, transport, deadline, and budget cases."""
    now = 1_700_000_000.0
    clock = FakeResolverClock(now)
    origin_a = "https://invidious-a.test"
    origin_b = "https://invidious-b.test"
    limited_origin = "https://limited-invidious.test"
    media_url = f"https://media.test/videoplayback?itag=140&expire={int(now + 7200)}"
    proxy_url = f"{origin_a}/latest_version?id=fixture-video&itag=140&local=true"
    slow_url = f"{origin_a}/api/v1/videos/slow"
    outage_url = f"{origin_b}/api/v1/videos/outage"
    deadline_urls = (
        f"{origin_a}/api/v1/videos/deadline-a",
        f"{origin_b}/api/v1/videos/deadline-b",
    )
    budget_urls = (
        f"{limited_origin}/api/v1/videos/budget-a",
        f"{limited_origin}/api/v1/videos/budget-b",
    )
    origin_limits = {
        origin_a: {"requests_per_second": 2, "max_concurrency": 1},
        origin_b: {"requests_per_second": 1, "max_concurrency": 1},
        limited_origin: {"requests_per_second": 2, "max_concurrency": 2},
    }
    replies = {
        proxy_url: FakeOriginReply(
            status=302,
            headers={"Location": media_url},
            response_url=media_url,
        ),
        media_url: FakeOriginReply(
            status=206,
            body=b"a",
            headers={
                "Content-Type": 'audio/mp4; codecs="mp4a.40.2"',
                "Accept-Ranges": "bytes",
                "Content-Range": "bytes 0-0/1024",
            },
        ),
        "https://media.test/video-only": FakeOriginReply(
            status=206,
            body=b"v",
            headers={"Content-Type": "video/mp4", "Content-Range": "bytes 0-0/1024"},
        ),
        slow_url: FakeOriginReply(delay_seconds=4.5),
        outage_url: FakeOriginReply(error=URLError("simulated Invidious outage")),
        deadline_urls[0]: FakeOriginReply(delay_seconds=3.0),
        deadline_urls[1]: FakeOriginReply(delay_seconds=3.0),
        budget_urls[0]: FakeOriginReply(),
        budget_urls[1]: FakeOriginReply(),
    }
    transport = FakeResolverTransport(clock, replies, origin_limits)
    monkeypatch.setattr("app.services.stream_cache_service.time.time", clock.time)
    monkeypatch.setattr("app.services.stream_cache_service.urllib.request.urlopen", transport.urlopen)

    expiry_urls = {
        "valid": f"https://media.test/audio?expire={int(now + 7200)}",
        "near_expiry": f"https://media.test/audio?expire={int(now + 599)}",
        "expired": f"https://media.test/audio?expire={int(now - 1)}",
        "malformed": "https://media.test/audio?expire=not-a-timestamp",
        "unknown": "https://media.test/audio?itag=140",
    }
    return {
        "clock": clock,
        "transport": transport,
        "now": now,
        "expiry_urls": expiry_urls,
        "proxy_url": proxy_url,
        "media_url": media_url,
        "slow_url": slow_url,
        "outage_url": outage_url,
        "deadline_urls": deadline_urls,
        "deadline_seconds": 5.0,
        "budget_urls": budget_urls,
        "origin_limits": origin_limits,
        "unknown_expiry_max_age_seconds": 1800,
    }


class TestStreamCacheService:
    def test_invalid_video_id_returns_none(self):
        assert StreamCacheService.get_stream("") is None
        assert StreamCacheService.get_stream("abc") is None
        assert StreamCacheService.get_stream(None) is None

    @patch("app.services.stream_cache_service._get_redis")
    def test_l2_redis_cache_hit(self, mock_get_redis):
        mock_redis = FakeCacheRedis()
        mock_get_redis.return_value = mock_redis

        cached_payload = make_stream_record(
            "ZceCoo2p9Tw", direct_url="https://cdn.googlevideo.com/videoplayback?id=123",
            title="Chhath Geet",
        )
        mock_redis.values[f"{STREAM_CACHE_PREFIX}ZceCoo2p9Tw"] = json.dumps(cached_payload)
        mock_redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}ZceCoo2p9Tw"] = {
            "generation": str(cached_payload["generation"]),
            "fence_token": cached_payload["fence_token"],
        }

        result = StreamCacheService.get_stream("ZceCoo2p9Tw")

        assert result is not None
        assert result["url"] == cached_payload["sources"][0]["url"]
        assert result["cached"] is True
        assert result["cache_tier"] == "L2_REDIS"
        stored = json.loads(mock_redis.values[f"{STREAM_CACHE_PREFIX}ZceCoo2p9Tw"])
        assert "url" not in stored
        assert "direct_url" not in stored
        assert "proxy_url" not in stored

    @patch("app.services.stream_cache_service._get_redis")
    def test_valid_legacy_candidate_record_migrates_after_validation(self, mock_get_redis):
        redis = FakeCacheRedis()
        mock_get_redis.return_value = redis
        now = time.time()
        video_id = "legacy-valid"
        source = make_source_candidate("direct", now, video_id=video_id)
        source.update({"type": "direct", "format": "M4A", "mimeType": "audio/mp4", "bitrate": 192000})
        record = make_cache_record([source], now)
        record.update({"schema_version": 0, "video_id": video_id, "url": "https://old.example.test/audio"})
        cache_key = f"{STREAM_CACHE_PREFIX}{video_id}"
        redis.values[cache_key] = json.dumps(record)
        redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}{video_id}"] = {
            "generation": str(record["generation"]),
            "fence_token": record["fence_token"],
        }

        response = StreamCacheService.get_stream_fast(video_id)
        migrated = json.loads(redis.values[cache_key])

        assert response is not None
        assert response["url"] == source["url"]
        assert migrated["schema_version"] == 1
        assert migrated["bitrate"] == 192000
        assert "url" not in migrated
        assert "direct_url" not in migrated
        assert "proxy_url" not in migrated
        assert "format" not in migrated["sources"][0]
        assert "type" not in migrated["sources"][0]

    @patch("app.services.stream_cache_service._get_redis")
    def test_unsupported_schema_record_is_invalidated(self, mock_get_redis):
        redis = FakeCacheRedis()
        mock_get_redis.return_value = redis
        now = time.time()
        video_id = "legacy-invalid"
        record = make_cache_record([make_source_candidate("direct", now, video_id=video_id)], now)
        record.update({"schema_version": 2, "video_id": video_id})
        cache_key = f"{STREAM_CACHE_PREFIX}{video_id}"
        redis.values[cache_key] = json.dumps(record)
        redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}{video_id}"] = {
            "generation": str(record["generation"]),
            "fence_token": record["fence_token"],
        }

        assert StreamCacheService.get_stream_fast(video_id) is None
        assert cache_key not in redis.values

    @patch("app.services.stream_cache_service._get_redis")
    def test_catalog_cache_summary_reports_fenced_mode_readiness_and_overdue_age(self, mock_get_redis):
        redis = FakeCacheRedis()
        mock_get_redis.return_value = redis
        now = time.time()
        video_id = "overdue-video"
        origin = cache_module.INVIDIOUS_REGISTRY[0].origin
        sources = [
            make_source_candidate(
                "direct", now - 2000, video_id=video_id,
                expires_at=now + 500, refresh_at=now - 100,
            ),
            make_source_candidate(
                "proxy", now - 300, video_id=video_id, refresh_at=now + 1500,
            ),
        ]
        record = make_cache_record(sources, now - 2000)
        record["video_id"] = video_id
        cache_key = f"{STREAM_CACHE_PREFIX}{video_id}"
        fence_key = f"{cache_module.STREAM_FENCE_PREFIX}{video_id}"
        redis.values[cache_key] = json.dumps(record)
        redis.hashes[fence_key] = {
            "generation": str(record["generation"]),
            "fence_token": record["fence_token"],
        }

        summary = StreamCacheService.get_catalog_cache_summary([video_id, "missing-video"])

        assert summary["modes"]["direct"] == {
            "ready": 0, "expiring": 0, "overdue": 1, "missing": 1,
            "unavailable": 0, "oldest_overdue_age_seconds": pytest.approx(100, abs=2),
        }
        assert summary["modes"]["proxy"] == {
            "ready": 1, "expiring": 0, "overdue": 0, "missing": 1,
            "unavailable": 0, "oldest_overdue_age_seconds": 0,
        }
        assert "url" not in json.dumps(summary)
        assert origin not in json.dumps(summary)

    @patch("app.services.stream_cache_service._get_redis")
    def test_stale_fenced_record_is_not_served_or_deleted_for_overdue_diagnostics(self, mock_get_redis):
        redis = FakeCacheRedis()
        mock_get_redis.return_value = redis
        now = time.time()
        video_id = "expired-video"
        source = make_source_candidate(
            "direct", now - 2000, video_id=video_id,
            expires_at=now + 500, refresh_at=now - 100,
        )
        record = make_cache_record([source], now - 2000)
        record["video_id"] = video_id
        cache_key = f"{STREAM_CACHE_PREFIX}{video_id}"
        redis.values[cache_key] = json.dumps(record)
        redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}{video_id}"] = {
            "generation": str(record["generation"]),
            "fence_token": record["fence_token"],
        }

        assert StreamCacheService.get_stream_fast(video_id, record_metrics=False) is None
        assert cache_key in redis.values
        metrics = StreamCacheService.get_metrics()
        assert metrics["expired_candidates_rejected"] == 1
        assert metrics["stale_expired_serves"] == 0

    @patch("app.services.stream_cache_service._get_redis")
    def test_generation_mismatch_is_counted_and_cache_miss_is_safe(self, mock_get_redis):
        redis = FakeCacheRedis()
        mock_get_redis.return_value = redis
        video_id = "mismatched-video"
        record = make_stream_record(video_id)
        redis.values[f"{STREAM_CACHE_PREFIX}{video_id}"] = json.dumps(record)
        redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}{video_id}"] = {
            "generation": str(record["generation"] + 1),
            "fence_token": "newer-token",
        }

        assert StreamCacheService.get_stream_fast(video_id, record_metrics=False) is None
        metrics = StreamCacheService.get_metrics()
        assert metrics["generation_mismatches"] == 1
        assert metrics["stale_expired_serves"] == 0

    @patch("app.services.stream_cache_service._get_redis")
    @patch.object(StreamCacheService, "_extract_upstream")
    def test_cache_miss_acquires_lock_and_stores_in_redis(
        self, mock_extract, mock_get_redis
    ):
        mock_redis = FakeCacheRedis()
        mock_get_redis.return_value = mock_redis

        resolved_payload = make_stream_record(
            "ZceCoo2p9Tw", direct_url="https://cdn.googlevideo.com/videoplayback?id=fresh",
            title="New Chhath Track",
        )
        mock_extract.return_value = resolved_payload

        result = StreamCacheService.get_stream("ZceCoo2p9Tw")

        assert result is not None
        assert result["url"] == resolved_payload["sources"][0]["url"]
        assert result["cached"] is False

        cache_key = f"{STREAM_CACHE_PREFIX}ZceCoo2p9Tw"
        fence = mock_redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}ZceCoo2p9Tw"]
        assert cache_key in mock_redis.values
        assert mock_redis.ttls[cache_key] == 5400
        assert fence["generation"] == "1"
        assert f"{STREAM_LOCK_PREFIX}ZceCoo2p9Tw" not in mock_redis.values

    @patch("app.services.stream_cache_service._get_redis")
    @patch.object(StreamCacheService, "_extract_upstream")
    def test_single_flight_coalescing_follower_reads_winner_result(
        self, mock_extract, mock_get_redis
    ):
        mock_redis = FakeCacheRedis()
        mock_get_redis.return_value = mock_redis

        # Lock was already acquired by another worker (follower returns False on SET NX)
        winner_result = make_stream_record(
            "ZceCoo2p9Tw", direct_url="https://cdn.googlevideo.com/videoplayback?winner"
        )
        mock_redis.values[f"{STREAM_LOCK_PREFIX}ZceCoo2p9Tw"] = "another-worker"
        mock_redis.values[f"{STREAM_CACHE_PREFIX}ZceCoo2p9Tw"] = json.dumps(winner_result)
        mock_redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}ZceCoo2p9Tw"] = {
            "generation": str(winner_result["generation"]),
            "fence_token": winner_result["fence_token"],
        }

        with patch.object(StreamCacheService, "get_stream_fast", return_value=None):
            result = StreamCacheService.get_stream("ZceCoo2p9Tw")

        assert result is not None
        assert result["url"] == winner_result["sources"][0]["url"]
        assert result["cached"] is True
        assert result["cache_tier"] == "COALESCED_REDIS"

        # Verify follower NEVER called upstream extraction! Exactly 0 outbound requests!
        mock_extract.assert_not_called()

    @patch("app.services.stream_cache_service._get_redis")
    @patch.object(StreamCacheService, "_extract_upstream")
    def test_redis_unavailable_bypasses_local_cache_and_resolves_again(
        self, mock_extract, mock_get_redis
    ):
        # Simulate Redis offline (get_redis_client returns None)
        mock_get_redis.return_value = None

        direct_payload = make_stream_record(
            "ZceCoo2p9Tw", direct_url="https://cdn.googlevideo.com/videoplayback?direct"
        )
        mock_extract.return_value = direct_payload

        # Call 1: Direct extraction
        result1 = StreamCacheService.get_stream("ZceCoo2p9Tw")
        assert result1 is not None
        assert result1["url"] == direct_payload["sources"][0]["url"]
        assert mock_extract.call_count == 1

        # Without Redis, L1 is not authoritative and cannot serve the previous result.
        result2 = StreamCacheService.get_stream("ZceCoo2p9Tw")
        assert result2 is not None
        assert result2["cached"] is False
        assert mock_extract.call_count == 2

    @patch("app.services.stream_cache_service._get_redis")
    def test_invalidate_stream_clears_both_tiers(self, mock_get_redis):
        mock_redis = FakeCacheRedis()
        mock_get_redis.return_value = mock_redis

        # Pre-seed L1 cache
        _l1_cache["vid123"] = {"url": "test"}
        _l1_cache_ts["vid123"] = 1000

        StreamCacheService.invalidate_stream("vid123")

        assert "vid123" not in _l1_cache
        assert "vid123" not in _l1_cache_ts
        fence = mock_redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}vid123"]
        assert fence["generation"] == "1"

    def test_extract_duration_prefers_explicit_metadata_or_url_dur(self):
        # 1. From Invidious lengthSeconds
        data = {"lengthSeconds": 308}
        best = {"url": "https://googlevideo.com/videoplayback?itag=140"}
        assert _extract_duration(data, best) == 308.0

        # 2. From the legacy extractor duration field
        data = {"duration": 245}
        assert _extract_duration(data, best) == 245.0

        # 3. From approxDurationMs
        data = {}
        best = {"approxDurationMs": "308686", "url": "https://googlevideo.com/videoplayback?itag=140"}
        assert _extract_duration(data, best) == 308.69

        # 4. From YouTube CDN URL query param &dur=
        data = {}
        best = {"url": "https://googlevideo.com/videoplayback?itag=140&dur=195.42&expire=123"}
        assert _extract_duration(data, best) == 195.42

        # 5. Fallback zero
        assert _extract_duration({}, {}) == 0.0

    def test_extract_url_expiry_and_is_expired(self):
        # Expired in past
        past_url = "https://googlevideo.com/videoplayback?expire=1000000&itag=140"
        assert extract_url_expiry(past_url) == 1000000
        assert is_url_expired(past_url) is True

        # Valid far in future
        future_url = "https://googlevideo.com/videoplayback?expire=9999999999&itag=140"
        assert extract_url_expiry(future_url) == 9999999999
        assert is_url_expired(future_url) is False

        # No expire param
        assert extract_url_expiry("https://googlevideo.com/videoplayback?id=123") is None
        assert is_url_expired("https://googlevideo.com/videoplayback?id=123") is False

    def test_resolver_harness_covers_expiry_proxy_deadline_and_origin_budgets(self, resolver_harness):
        cases = resolver_harness
        expiry_urls = cases["expiry_urls"]
        now = cases["now"]

        assert extract_url_expiry(expiry_urls["valid"]) == int(now + 7200)
        assert is_url_expired(expiry_urls["valid"]) is False
        assert extract_url_expiry(expiry_urls["near_expiry"]) == int(now + 599)
        assert is_url_expired(expiry_urls["near_expiry"]) is True
        assert is_url_expired(expiry_urls["expired"]) is True
        assert extract_url_expiry(expiry_urls["malformed"]) is None
        assert extract_url_expiry(expiry_urls["unknown"]) is None
        assert cases["unknown_expiry_max_age_seconds"] == 1800

        transport = cases["transport"]
        with transport.urlopen(Request(cases["proxy_url"])) as response:
            assert response.status == 302
            assert response.headers["Location"] == cases["media_url"]
        with transport.urlopen(Request(cases["media_url"], headers={"Range": "bytes=0-0"})) as response:
            assert response.status == 206
            assert response.headers["Content-Type"].startswith("audio/mp4")
            assert response.headers["Content-Range"] == "bytes 0-0/1024"
        range_request = transport.requests[-1]
        assert range_request["headers"]["range"] == "bytes=0-0"
        with transport.urlopen(Request("https://media.test/video-only", headers={"Range": "bytes=0-0"})) as response:
            assert response.status == 206
            assert response.headers["Content-Type"] == "video/mp4"

        before_slow_request = cases["clock"].time()
        with transport.urlopen(Request(cases["slow_url"]), timeout=5.0):
            pass
        assert cases["clock"].time() - before_slow_request == 4.5
        with pytest.raises(URLError, match="simulated Invidious outage"):
            transport.urlopen(Request(cases["outage_url"]))

        before_deadline = cases["clock"].time()
        with transport.urlopen(Request(cases["deadline_urls"][0]), timeout=5.0):
            pass
        with pytest.raises(TimeoutError):
            transport.urlopen(Request(cases["deadline_urls"][1]), timeout=2.0)
        assert cases["clock"].time() - before_deadline == cases["deadline_seconds"]

        first = transport.urlopen(Request(cases["budget_urls"][0]))
        cases["clock"].advance(0.5)
        second = transport.urlopen(Request(cases["budget_urls"][1]))
        try:
            origin = "https://limited-invidious.test"
            requests = [request for request in transport.requests if request["origin"] == origin]
            assert requests[1]["started_at"] - requests[0]["started_at"] == 0.5
            assert transport.max_concurrency_by_origin[origin] == 2
            assert cases["origin_limits"][origin] == {
                "requests_per_second": 2,
                "max_concurrency": 2,
            }
        finally:
            first.close()
            second.close()

    def test_candidate_expiry_is_independent_and_uses_safety_margin(self):
        now = 1_700_000_000.0
        direct_near_expiry = make_source_candidate("direct", now, expires_at=now + 600)
        proxy_fresh = make_source_candidate("proxy", now, resolved_at=now - 30)

        valid = StreamCacheService._validate_source_candidates(
            [direct_near_expiry, proxy_fresh], now
        )

        assert [candidate["mode"] for candidate in valid] == ["proxy"]

    def test_unknown_expiry_candidate_is_valid_for_at_most_1800_seconds(self):
        now = 1_700_000_000.0
        fresh_unknown = make_source_candidate("direct", now, resolved_at=now - 1799)
        stale_unknown = make_source_candidate("proxy", now, resolved_at=now - 1800)

        valid = StreamCacheService._validate_source_candidates(
            [fresh_unknown, stale_unknown], now
        )

        assert [candidate["mode"] for candidate in valid] == ["direct"]

    def test_cache_record_retention_extends_past_latest_refresh_deadline(self):
        now = 1_700_000_000.0
        source = make_source_candidate(
            "direct", now, expires_at=now + 30_000, refresh_at=now + 20_000
        )
        record = make_cache_record([source], now)

        ttl = StreamCacheService._cache_retention_ttl(record, now)

        assert ttl >= 20_000 + 3_600
        assert ttl <= 86_400

    def test_legacy_aggregate_record_is_rejected_without_valid_candidates(self):
        now = 1_700_000_000.0
        legacy = {
            "url": f"https://media.test/audio?expire={int(now + 7200)}",
            "format": "M4A",
            "mimeType": "audio/mp4",
            "expires_at": int(now + 7200),
        }

        assert StreamCacheService._validate_cache_record(legacy, now) is None

    def test_candidate_validation_rejects_wrong_mode_provider_mime_and_proxy_itag(self):
        now = 1_700_000_000.0
        invalid_candidates = []

        wrong_mode = make_source_candidate("proxy", now)
        wrong_mode["mode"] = "fallback"
        invalid_candidates.append(wrong_mode)

        wrong_provider = make_source_candidate("proxy", now)
        wrong_provider["provider"] = "piped"
        invalid_candidates.append(wrong_provider)

        video_mime = make_source_candidate("proxy", now)
        video_mime["mime_type"] = 'video/mp4; codecs="avc1"'
        invalid_candidates.append(video_mime)

        unsupported_mime = make_source_candidate("proxy", now)
        unsupported_mime["mime_type"] = 'audio/ogg; codecs="vorbis"'
        unsupported_mime["codec"] = "vorbis"
        invalid_candidates.append(unsupported_mime)

        mismatched_proxy_itag = make_source_candidate("proxy", now)
        mismatched_proxy_itag["url"] = mismatched_proxy_itag["url"].replace("itag=140", "itag=251")
        invalid_candidates.append(mismatched_proxy_itag)

        mismatched_direct_itag = make_source_candidate("direct", now)
        mismatched_direct_itag["url"] = mismatched_direct_itag["url"].replace("itag=140", "itag=251")
        invalid_candidates.append(mismatched_direct_itag)

        unconfigured_origin = make_source_candidate("proxy", now)
        unconfigured_origin["provider_origin"] = "https://unconfigured-invidious.test"
        unconfigured_origin["url"] = unconfigured_origin["url"].replace(
            cache_module.INVIDIOUS_REGISTRY[0].origin, unconfigured_origin["provider_origin"]
        )
        invalid_candidates.append(unconfigured_origin)

        for candidate in invalid_candidates:
            assert StreamCacheService._validate_source_candidates([candidate], now) == []

    def test_compatibility_fields_derive_from_independently_valid_sources(self):
        now = 1_700_000_000.0
        direct_near_expiry = make_source_candidate("direct", now, expires_at=now + 600)
        proxy = make_source_candidate("proxy", now, resolved_at=now - 30)
        record = make_cache_record([direct_near_expiry, proxy], now)

        valid = StreamCacheService._validate_cache_record(record, now, "fixture-video")

        assert valid is not None
        assert valid["sources"] == [proxy]
        assert not {"url", "direct_url", "proxy_url", "status"}.intersection(valid)
        public = StreamCacheService._public_response(valid)
        assert public["url"] == proxy["url"]
        assert public["direct_url"] is None
        assert public["proxy_url"] == proxy["url"]
        assert public["status"] == "DEGRADED"
        assert public["expires_at"] is None

    def test_l1_hit_requires_the_matching_current_redis_fence(self, monkeypatch):
        video_id = "fenced-l1-video"
        now = time.time()
        redis = FakeCacheRedis()
        record = make_stream_record(video_id, now)
        record.update({"generation": 7, "fence_token": "current-token"})
        redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}{video_id}"] = {
            "generation": "7",
            "fence_token": "current-token",
        }
        monkeypatch.setattr(cache_module, "_get_redis", lambda: redis)
        cache_module._cache_l1(video_id, record, now)

        assert StreamCacheService.get_stream_fast(video_id)["url"] == record["sources"][0]["url"]

        redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}{video_id}"]["fence_token"] = "rotated-token"
        assert StreamCacheService.get_stream_fast(video_id) is None

    def test_l1_cache_evicts_oldest_entry_at_capacity(self, monkeypatch):
        monkeypatch.setattr(cache_module, "L1_CACHE_MAX_ENTRIES", 2)
        now = time.time()
        for video_id in ("lru-oldest", "lru-middle", "lru-newest"):
            cache_module._cache_l1(video_id, make_stream_record(video_id, now), now)

        assert list(cache_module._l1_cache) == ["lru-middle", "lru-newest"]
        assert "lru-oldest" not in cache_module._l1_cache_ts

    def test_single_flight_lease_renews_while_resolver_is_blocked(self, monkeypatch):
        redis = MagicMock()
        renewed = Event()

        def eval_script(script, *_args):
            if script == cache_module.RENEW_LOCK_LUA:
                renewed.set()
                return 1
            return 0

        redis.eval.side_effect = eval_script
        monkeypatch.setattr(cache_module, "LOCK_RENEW_INTERVAL_SECONDS", 0.01)
        with cache_module._renew_lock_lease(redis, "lock-key", "lock-token"):
            assert renewed.wait(timeout=1)

        assert any(call.args[0] == cache_module.RENEW_LOCK_LUA for call in redis.eval.call_args_list)

    def test_invidious_resolver_uses_selected_itag_and_keeps_proxy_url_raw(self, monkeypatch):
        now = 1_700_000_000.0
        origin = "https://invidious-a.test"
        video_id = "proxy-itag-video"
        instance = cache_module.InvidiousInstance(
            name="test origin",
            origin=origin,
            requests_per_second=2,
            max_concurrency=1,
        )
        direct_url = f"https://media.test/audio?itag=251&expire={int(now + 7200)}"
        metadata_url = f"{origin}/api/v1/videos/{video_id}?fields=title,adaptiveFormats,formatStreams"
        expected_proxy = f"{origin}/latest_version?id={video_id}&itag=251&local=true"
        body = json.dumps({
            "title": "Proxy itag test",
            "lengthSeconds": 120,
            "adaptiveFormats": [{
                "itag": 251,
                "type": 'audio/webm; codecs="opus"',
                "url": direct_url,
                "bitrate": 160000,
            }],
        }).encode()
        clock = FakeResolverClock(now)
        transport = FakeResolverTransport(
            clock,
            {metadata_url: FakeOriginReply(body=body)},
            {origin: {"requests_per_second": 2, "max_concurrency": 1}},
        )
        monkeypatch.setattr(cache_module, "INVIDIOUS_REGISTRY", (instance,))
        monkeypatch.setattr(cache_module.time, "time", clock.time)
        monkeypatch.setattr(cache_module.time, "monotonic", clock.monotonic)
        monkeypatch.setattr(cache_module.urllib.request, "urlopen", transport.urlopen)
        monkeypatch.setattr(cache_module, "_get_redis", lambda: None)

        result = StreamCacheService._extract_upstream(video_id)

        assert result is not None
        assert result["sources"][1]["url"] == expected_proxy
        assert "proxy_url" not in result
        assert [source["mode"] for source in result["sources"]] == ["direct", "proxy"]
        assert result["sources"][1]["itag"] == 251
        assert [request["url"] for request in transport.requests] == [metadata_url]
        assert all(instance.requests_per_second > 0 and instance.max_concurrency > 0
                   for instance in cache_module.INVIDIOUS_REGISTRY)

    def test_cache_miss_resolution_uses_at_most_two_origins_with_five_second_budget(self, monkeypatch):
        now = 1_700_000_000.0
        origins = [f"https://invidious-{letter}.test" for letter in "abc"]
        registry = tuple(
            cache_module.InvidiousInstance(
                name=f"origin {letter}",
                origin=origin,
                requests_per_second=2,
                max_concurrency=1,
            )
            for letter, origin in zip("abc", origins)
        )
        video_id = "bounded-resolution"
        urls = [
            f"{origin}/api/v1/videos/{video_id}?fields=title,adaptiveFormats,formatStreams"
            for origin in origins
        ]
        clock = FakeResolverClock(now)
        transport = FakeResolverTransport(
            clock,
            {url: FakeOriginReply(status=503, delay_seconds=3.0) for url in urls},
            {origin: {"requests_per_second": 2, "max_concurrency": 1} for origin in origins},
        )
        monkeypatch.setattr(cache_module, "INVIDIOUS_REGISTRY", registry)
        monkeypatch.setattr(cache_module.time, "time", clock.time)
        monkeypatch.setattr(cache_module.time, "monotonic", clock.monotonic)
        monkeypatch.setattr(cache_module.urllib.request, "urlopen", transport.urlopen)
        monkeypatch.setattr(cache_module, "_get_redis", lambda: None)

        assert StreamCacheService._extract_upstream(video_id) is None

        assert len(transport.requests) == 2
        assert clock.time() - now <= 5.0

    def test_one_video_upstream_failure_does_not_cool_origin_for_next_song(self, monkeypatch):
        now = 1_700_000_000.0
        origin = "https://origin-health.test"
        instance = cache_module.InvidiousInstance(
            name="origin-health.test",
            origin=origin,
            requests_per_second=1000,
            max_concurrency=1,
        )
        failed_id = "video-with-companion-timeout"
        working_id = "next-catalog-song"
        failed_url = f"{origin}/api/v1/videos/{failed_id}?fields=title,adaptiveFormats,formatStreams"
        working_url = f"{origin}/api/v1/videos/{working_id}?fields=title,adaptiveFormats,formatStreams"
        working_body = json.dumps({
            "title": "Working catalog song",
            "adaptiveFormats": [{
                "itag": 140,
                "type": 'audio/mp4; codecs="mp4a.40.2"',
                "url": f"https://media.test/audio?expire={int(now + 7200)}",
                "bitrate": 128000,
            }],
        }).encode()
        clock = FakeResolverClock(now)
        transport = FakeResolverTransport(
            clock,
            {
                failed_url: FakeOriginReply(status=503),
                working_url: FakeOriginReply(body=working_body),
            },
            {origin: {"requests_per_second": 1000, "max_concurrency": 1}},
        )
        redis = FakeOriginHealthRedis()
        monkeypatch.setattr(cache_module, "INVIDIOUS_REGISTRY", (instance,))
        monkeypatch.setattr(cache_module, "_origin_limiters", {})
        monkeypatch.setattr(cache_module.time, "time", clock.time)
        monkeypatch.setattr(cache_module.time, "monotonic", clock.monotonic)
        monkeypatch.setattr(cache_module.urllib.request, "urlopen", transport.urlopen)
        monkeypatch.setattr(cache_module, "_get_redis", lambda: redis)

        assert StreamCacheService._extract_upstream(failed_id) is None
        recovered = StreamCacheService._extract_upstream(working_id)

        assert recovered is not None
        assert [request["url"] for request in transport.requests] == [failed_url, working_url]
        assert redis.hget(f"{cache_module.HEALTH_PREFIX}{instance.name}", "cooldown_until") is None

    def test_origin_cooldown_requires_repeated_systemic_failures_and_success_clears_it(self):
        name = "repeated-failure-origin.test"
        health_key = f"{cache_module.HEALTH_PREFIX}{name}"
        failure_key = f"{cache_module.ORIGIN_FAILURE_PREFIX}{name}"
        redis = FakeOriginHealthRedis()

        for _ in range(cache_module.ORIGIN_FAILURE_THRESHOLD - 1):
            StreamCacheService._record_failure(name, redis, origin_level_failure=True)

        assert redis.hget(health_key, "cooldown_until") is None

        StreamCacheService._record_failure(name, redis, origin_level_failure=True)

        assert float(redis.hget(health_key, "cooldown_until")) > time.time()
        assert redis.expirations[failure_key] == cache_module.ORIGIN_FAILURE_WINDOW_SECONDS

        StreamCacheService._record_success(name, 12, redis)

        assert redis.hget(health_key, "cooldown_until") is None
        assert failure_key not in redis.hashes

    def test_origin_limiter_enforces_configured_rate_and_concurrency(self):
        instance = cache_module.InvidiousInstance(
            name="limited origin",
            origin="https://limited-origin.test",
            requests_per_second=40,
            max_concurrency=1,
        )
        limiter = cache_module._get_origin_limiter(instance)
        request_times = []

        for _ in range(2):
            with limiter.acquire(time.monotonic() + 1):
                request_times.append(time.monotonic())

        assert request_times[1] - request_times[0] >= 0.02

        first_entered = Event()
        release_first = Event()
        second_entered = Event()

        def hold_first_request():
            with limiter.acquire(time.monotonic() + 1):
                first_entered.set()
                assert release_first.wait(timeout=1)

        def start_second_request():
            with limiter.acquire(time.monotonic() + 1):
                second_entered.set()

        first = Thread(target=hold_first_request, daemon=True)
        second = Thread(target=start_second_request, daemon=True)
        first.start()
        assert first_entered.wait(timeout=1)
        second.start()
        assert not second_entered.wait(timeout=0.01)
        release_first.set()
        assert second_entered.wait(timeout=1)
        first.join(timeout=1)
        second.join(timeout=1)

    def test_origin_limiter_coordinates_rate_and_concurrency_across_workers(self):
        instance = cache_module.InvidiousInstance(
            name="shared limited origin",
            origin="https://shared-limited-origin.test",
            requests_per_second=25,
            max_concurrency=1,
        )
        redis = FakeOriginLimiterRedis()
        worker_one = cache_module._OriginRequestLimiter(instance)
        worker_two = cache_module._OriginRequestLimiter(instance)

        first_started = time.monotonic()
        with worker_one.acquire(first_started + 1, redis):
            pass
        second_started = time.monotonic()
        with worker_two.acquire(second_started + 1, redis):
            assert time.monotonic() - second_started >= 0.03

        first_entered = Event()
        release_first = Event()
        second_entered = Event()

        def hold_first_worker_slot():
            with worker_one.acquire(time.monotonic() + 1, redis):
                first_entered.set()
                assert release_first.wait(timeout=1)

        def wait_for_second_worker_slot():
            with worker_two.acquire(time.monotonic() + 1, redis):
                second_entered.set()

        first = Thread(target=hold_first_worker_slot, daemon=True)
        second = Thread(target=wait_for_second_worker_slot, daemon=True)
        first.start()
        assert first_entered.wait(timeout=1)
        second.start()
        assert not second_entered.wait(timeout=0.02)
        release_first.set()
        assert second_entered.wait(timeout=1)
        first.join(timeout=1)
        second.join(timeout=1)
        assert redis.max_active == 1

    @patch("app.services.stream_cache_service._get_redis")
    def test_l1_value_is_not_served_without_redis_fence_after_restart(self, mock_get_redis):
        video_id = "evicted-video"
        mock_redis = FakeCacheRedis()
        mock_redis.values[f"{STREAM_CACHE_PREFIX}{video_id}"] = json.dumps({
            "url": "https://media.test/audio?expire=9999999999",
            "format": "M4A",
        })
        mock_get_redis.return_value = mock_redis
        _l1_cache[video_id] = {
            "url": "https://media.test/old-audio?expire=9999999999",
            "format": "M4A",
        }
        _l1_cache_ts[video_id] = time.time()

        assert StreamCacheService.get_stream_fast(video_id) is None

    @patch.object(StreamCacheService, "_extract_upstream")
    def test_two_worker_flush_rejects_delayed_old_refresh(self, mock_extract):
        video_id = "race-video-123"
        redis = FakeCacheRedis()
        old_started = Event()
        release_old = Event()
        old_result = make_stream_record(
            video_id, direct_url="https://media.test/old?itag=140&expire=9999999999",
            direct_expires_at=9_999_999_999,
        )
        fresh_result = make_stream_record(
            video_id, direct_url="https://media.test/fresh?itag=140&expire=9999999999",
            direct_expires_at=9_999_999_999,
        )

        def resolve(_video_id):
            if current_thread().name == "old-refresh":
                old_started.set()
                assert release_old.wait(timeout=2)
                return old_result
            return fresh_result

        mock_extract.side_effect = resolve
        results = {}
        with patch("app.services.stream_cache_service._get_redis", return_value=redis):
            old_worker = Thread(
                name="old-refresh",
                target=lambda: results.setdefault(
                    "old", StreamCacheService._resolve_with_single_flight(video_id, redis)
                ),
                daemon=True,
            )
            old_worker.start()
            assert old_started.wait(timeout=1)

            StreamCacheService.flush_stream_cache([video_id])
            results["fresh"] = StreamCacheService._resolve_with_single_flight(video_id, redis)
            release_old.set()
            old_worker.join(timeout=2)
            stale_write_rejections = StreamCacheService.get_metrics()["stale_write_rejections"]

        assert not old_worker.is_alive()
        assert results["old"] is None
        cached = json.loads(redis.get(f"{STREAM_CACHE_PREFIX}{video_id}"))
        assert "url" not in cached
        assert cached["sources"][0]["url"] == fresh_result["sources"][0]["url"]
        assert stale_write_rejections == 1

    @patch("app.services.stream_cache_service._get_redis")
    @patch.object(StreamCacheService, "_extract_upstream")
    def test_evicts_expired_url_from_redis_cache_and_refetches(
        self, mock_extract, mock_get_redis
    ):
        mock_redis = FakeCacheRedis()
        mock_get_redis.return_value = mock_redis

        # Stale cached URL with expire in the past
        now = time.time()
        expired_source = make_source_candidate(
            "direct", now, video_id="vidExpired", expires_at=1_000_000,
        )
        expired_payload = make_cache_record([expired_source], now)
        expired_payload["video_id"] = "vidExpired"
        expired_payload.update({"generation": 2, "fence_token": "expired-token"})
        mock_redis.values[f"{STREAM_CACHE_PREFIX}vidExpired"] = json.dumps(expired_payload)
        mock_redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}vidExpired"] = {
            "generation": "2", "fence_token": "expired-token",
        }

        fresh_payload = make_stream_record(
            "vidExpired", direct_url="https://googlevideo.com/videoplayback?itag=140&expire=9999999999",
            direct_expires_at=9_999_999_999,
        )
        mock_extract.return_value = fresh_payload

        result = StreamCacheService.get_stream("vidExpired")

        # Expired key must be deleted from Redis
        refreshed = json.loads(mock_redis.values[f"{STREAM_CACHE_PREFIX}vidExpired"])
        assert "url" not in refreshed
        assert refreshed["sources"][0]["url"] == fresh_payload["sources"][0]["url"]
        assert refreshed["fence_token"] != "expired-token"
        # Fresh payload extracted and returned
        assert result is not None
        assert result["url"] == fresh_payload["sources"][0]["url"]

    @patch("app.services.stream_cache_service._get_redis")
    def test_flush_stream_cache_all(self, mock_get_redis):
        mock_redis = FakeCacheRedis()
        mock_get_redis.return_value = mock_redis
        for video_id in ("vid1", "vid2"):
            mock_redis.values[f"{STREAM_CACHE_PREFIX}{video_id}"] = "record"
        mock_redis.values[STREAM_METRICS_KEY] = "metrics"

        count = StreamCacheService.flush_stream_cache()
        assert count == 2
        assert f"{STREAM_CACHE_PREFIX}vid1" not in mock_redis.values
        assert f"{STREAM_CACHE_PREFIX}vid2" not in mock_redis.values
        assert STREAM_METRICS_KEY not in mock_redis.values
        assert all(
            key in mock_redis.hashes
            for key in (
                f"{cache_module.STREAM_FENCE_PREFIX}vid1",
                f"{cache_module.STREAM_FENCE_PREFIX}vid2",
            )
        )

    @patch("app.services.stream_cache_service._get_redis")
    def test_flush_stream_cache_selective_preserves_metrics(self, mock_get_redis):
        mock_redis = FakeCacheRedis()
        mock_get_redis.return_value = mock_redis
        mock_redis.values[STREAM_METRICS_KEY] = "metrics"
        for video_id in ("vid12345", "vid67890", "vidABCDE"):
            mock_redis.values[f"{STREAM_CACHE_PREFIX}{video_id}"] = "record"

        # Test comma and newline separated inputs
        count = StreamCacheService.flush_stream_cache("vid12345, vid67890\nvidABCDE")
        assert count == 3
        assert STREAM_METRICS_KEY in mock_redis.values
        for video_id in ("vid12345", "vid67890", "vidABCDE"):
            assert f"{STREAM_CACHE_PREFIX}{video_id}" not in mock_redis.values
            assert mock_redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}{video_id}"]["generation"] == "1"

    @patch("app.services.stream_cache_service.urllib.request.urlopen")
    @patch("app.services.stream_cache_service._get_redis")
    def test_invidious_extractor_rejects_video_only_formats(self, mock_get_redis, mock_urlopen):
        """Ensures an Invidious response with no pure audio format is rejected."""
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        invidious_video_only_response = {
            "title": "Chhath Video",
            "adaptiveFormats": [
                {
                    "itag": 22,
                    "url": "https://googlevideo.com/videoplayback?mime=video%2Fmp4",
                    "type": "video/mp4; codecs=\"avc1.64001F\"",
                    "bitrate": 500000,
                }
            ],
        }

        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps(invidious_video_only_response).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        result = StreamCacheService._extract_upstream("vidNoAudioStreams")
        # Pure audio requirement: must NOT return the muxed video stream!
        assert result is None

    @patch("app.services.stream_cache_service._get_redis")
    @patch.object(StreamCacheService, "_extract_upstream")
    def test_force_fresh_bypasses_cache(self, mock_extract, mock_get_redis):
        mock_redis = FakeCacheRedis()
        mock_get_redis.return_value = mock_redis

        # Prepopulate L1 and Redis mock
        _l1_cache["vidFresh"] = {"url": "https://cached.url"}
        _l1_cache_ts["vidFresh"] = 9999999999

        fresh_result = make_stream_record("vidFresh", direct_url="https://fresh.url")
        mock_extract.return_value = fresh_result

        res = StreamCacheService.get_stream("vidFresh", force_fresh=True)
        assert res["url"] == "https://fresh.url"
        mock_extract.assert_called_once_with("vidFresh")

    @patch("app.services.stream_cache_service._get_redis")
    def test_invalidate_stream_direct_promotes_proxy_to_degraded(self, mock_get_redis):
        mock_redis = FakeCacheRedis()
        mock_get_redis.return_value = mock_redis
        record = make_stream_record("vidDegrade")
        record.update({"generation": 2, "fence_token": "old-token"})
        mock_redis.values[f"{STREAM_CACHE_PREFIX}vidDegrade"] = json.dumps(record)
        mock_redis.hashes[f"{cache_module.STREAM_FENCE_PREFIX}vidDegrade"] = {
            "generation": "2", "fence_token": "old-token",
        }

        StreamCacheService.invalidate_stream("vidDegrade", source_type="direct")

        cached = json.loads(mock_redis.values[f"{STREAM_CACHE_PREFIX}vidDegrade"])
        assert [source["mode"] for source in cached["sources"]] == ["proxy"]
        assert not {"url", "direct_url", "proxy_url", "status"}.intersection(cached)
        assert cached["generation"] == 3
        response = StreamCacheService.get_stream_fast("vidDegrade")
        assert response["status"] == "DEGRADED"
        assert response["url"] == response["proxy_url"]
