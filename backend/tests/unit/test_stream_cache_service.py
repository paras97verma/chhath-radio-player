"""
Unit tests for StreamCacheService with Redis caching and single-flight request coalescing.
"""

import json
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
    STREAM_LOCK_PREFIX,
    RELEASE_LOCK_LUA,
    extract_url_expiry,
    is_url_expired,
)


@pytest.fixture(autouse=True)
def clean_caches():
    """Clear in-memory L1 cache before each test."""
    _l1_cache.clear()
    _l1_cache_ts.clear()
    yield
    _l1_cache.clear()
    _l1_cache_ts.clear()


class TestStreamCacheService:
    def test_invalid_video_id_returns_none(self):
        assert StreamCacheService.get_stream("") is None
        assert StreamCacheService.get_stream("abc") is None
        assert StreamCacheService.get_stream(None) is None

    @patch("app.services.stream_cache_service._get_redis")
    def test_l2_redis_cache_hit(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        cached_payload = {
            "url": "https://cdn.googlevideo.com/videoplayback?id=123",
            "format": "M4A",
            "mimeType": 'audio/mp4; codecs="mp4a.40.2"',
            "bitrate": 128000,
            "title": "Chhath Geet",
        }
        mock_redis.get.return_value = json.dumps(cached_payload)

        result = StreamCacheService.get_stream("ZceCoo2p9Tw")

        assert result is not None
        assert result["url"] == cached_payload["url"]
        assert result["cached"] is True
        assert result["cache_tier"] == "L2_REDIS"
        mock_redis.get.assert_called_once_with(f"{STREAM_CACHE_PREFIX}ZceCoo2p9Tw")

    @patch("app.services.stream_cache_service._get_redis")
    @patch.object(StreamCacheService, "_extract_upstream")
    def test_cache_miss_acquires_lock_and_stores_in_redis(
        self, mock_extract, mock_get_redis
    ):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.get.return_value = None  # Cache MISS
        mock_redis.set.return_value = True  # Lock acquired successfully

        resolved_payload = {
            "url": "https://cdn.googlevideo.com/videoplayback?id=fresh",
            "format": "M4A",
            "mimeType": 'audio/mp4; codecs="mp4a.40.2"',
            "bitrate": 128000,
            "title": "New Chhath Track",
        }
        mock_extract.return_value = resolved_payload

        result = StreamCacheService.get_stream("ZceCoo2p9Tw")

        assert result is not None
        assert result["url"] == resolved_payload["url"]
        assert result["cached"] is False

        # Verify Redis SET NX lock was requested
        mock_redis.set.assert_called_once()
        args, kwargs = mock_redis.set.call_args
        assert args[0] == f"{STREAM_LOCK_PREFIX}ZceCoo2p9Tw"
        assert kwargs["nx"] is True
        assert kwargs["ex"] == 8

        # Verify stream was cached in Redis with TTL
        mock_redis.setex.assert_called_once()
        setex_args = mock_redis.setex.call_args[0]
        assert setex_args[0] == f"{STREAM_CACHE_PREFIX}ZceCoo2p9Tw"
        assert setex_args[1] == 14400

        # Verify lock was released via Lua
        mock_redis.eval.assert_called_once()
        eval_args = mock_redis.eval.call_args[0]
        assert eval_args[0] == RELEASE_LOCK_LUA
        assert eval_args[2] == f"{STREAM_LOCK_PREFIX}ZceCoo2p9Tw"

    @patch("app.services.stream_cache_service._get_redis")
    @patch.object(StreamCacheService, "_extract_upstream")
    def test_single_flight_coalescing_follower_reads_winner_result(
        self, mock_extract, mock_get_redis
    ):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        # Lock was already acquired by another worker (follower returns False on SET NX)
        mock_redis.set.return_value = False

        # On first cache check (before lock), returns None
        # On follower polling, winner has finished and set the cache
        winner_result = {
            "url": "https://cdn.googlevideo.com/videoplayback?winner",
            "format": "M4A",
            "mimeType": "audio/mp4",
            "bitrate": 128000,
        }
        mock_redis.get.side_effect = [None, json.dumps(winner_result)]

        result = StreamCacheService.get_stream("ZceCoo2p9Tw")

        assert result is not None
        assert result["url"] == winner_result["url"]
        assert result["cached"] is True
        assert result["cache_tier"] == "COALESCED_REDIS"

        # Verify follower NEVER called upstream extraction! Exactly 0 outbound requests!
        mock_extract.assert_not_called()

    @patch("app.services.stream_cache_service._get_redis")
    @patch.object(StreamCacheService, "_extract_upstream")
    def test_redis_failure_falls_back_gracefully_to_memory_and_direct(
        self, mock_extract, mock_get_redis
    ):
        # Simulate Redis offline (get_redis_client returns None)
        mock_get_redis.return_value = None

        direct_payload = {
            "url": "https://cdn.googlevideo.com/videoplayback?direct",
            "format": "M4A",
            "mimeType": "audio/mp4",
            "bitrate": 128000,
        }
        mock_extract.return_value = direct_payload

        # Call 1: Direct extraction
        result1 = StreamCacheService.get_stream("ZceCoo2p9Tw")
        assert result1 is not None
        assert result1["url"] == direct_payload["url"]
        assert mock_extract.call_count == 1

        # Call 2: Served from L1 in-memory cache without hitting upstream again
        result2 = StreamCacheService.get_stream("ZceCoo2p9Tw")
        assert result2 is not None
        assert result2["cached"] is True
        assert result2["cache_tier"] == "L1_MEMORY"
        assert mock_extract.call_count == 1  # Still 1!

    @patch("app.services.stream_cache_service._get_redis")
    def test_invalidate_stream_clears_both_tiers(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        # Pre-seed L1 cache
        _l1_cache["vid123"] = {"url": "test"}
        _l1_cache_ts["vid123"] = 1000

        StreamCacheService.invalidate_stream("vid123")

        assert "vid123" not in _l1_cache
        assert "vid123" not in _l1_cache_ts
        mock_redis.delete.assert_called_once_with(f"{STREAM_CACHE_PREFIX}vid123")

    def test_extract_duration_prefers_explicit_metadata_or_url_dur(self):
        # 1. From Invidious lengthSeconds
        data = {"lengthSeconds": 308}
        best = {"url": "https://googlevideo.com/videoplayback?itag=140"}
        assert _extract_duration(data, best) == 308.0

        # 2. From Piped duration
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

    @patch("app.services.stream_cache_service._get_redis")
    @patch.object(StreamCacheService, "_extract_upstream")
    def test_evicts_expired_url_from_redis_cache_and_refetches(
        self, mock_extract, mock_get_redis
    ):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        # Stale cached URL with expire in the past
        expired_payload = {
            "url": "https://googlevideo.com/videoplayback?expire=1000000",
            "format": "M4A",
            "bitrate": 128000,
        }
        mock_redis.get.return_value = json.dumps(expired_payload)
        mock_redis.set.return_value = True

        fresh_payload = {
            "url": "https://googlevideo.com/videoplayback?expire=9999999999",
            "format": "M4A",
            "bitrate": 128000,
        }
        mock_extract.return_value = fresh_payload

        result = StreamCacheService.get_stream("vidExpired")

        # Expired key must be deleted from Redis
        mock_redis.delete.assert_called_with(f"{STREAM_CACHE_PREFIX}vidExpired")
        # Fresh payload extracted and returned
        assert result is not None
        assert result["url"] == fresh_payload["url"]

    @patch("app.services.stream_cache_service._get_redis")
    def test_flush_stream_cache_all(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.scan.side_effect = [
            (0, ["chhath:stream:vid1", "chhath:stream:vid2"]),
            (0, ["chhath:lock:stream:vid1"]),
        ]
        mock_redis.delete.return_value = 2

        count = StreamCacheService.flush_stream_cache()
        assert count == 2
        mock_redis.delete.assert_any_call("chhath:stream:vid1", "chhath:stream:vid2")
        from app.services.stream_cache_service import STREAM_METRICS_KEY
        mock_redis.delete.assert_any_call(STREAM_METRICS_KEY)

    @patch("app.services.stream_cache_service._get_redis")
    def test_flush_stream_cache_selective_preserves_metrics(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.delete.return_value = 1

        # Test comma and newline separated inputs
        count = StreamCacheService.flush_stream_cache("vid12345, vid67890\nvidABCDE")
        assert count == 3
        mock_redis.delete.assert_any_call(f"{STREAM_CACHE_PREFIX}vid12345")
        mock_redis.delete.assert_any_call(f"{STREAM_CACHE_PREFIX}vid67890")
        mock_redis.delete.assert_any_call(f"{STREAM_CACHE_PREFIX}vidABCDE")

        from app.services.stream_cache_service import STREAM_METRICS_KEY
        # Verify STREAM_METRICS_KEY was NOT deleted during selective flush
        for call_item in mock_redis.delete.call_args_list:
            assert STREAM_METRICS_KEY not in call_item[0]

    @patch("app.services.stream_cache_service.urllib.request.urlopen")
    @patch("app.services.stream_cache_service._get_redis")
    def test_extractor_enforces_audio_only_no_video_fallback(self, mock_get_redis, mock_urlopen):
        """Ensures that upstream responses containing only muxed video streams are rejected."""
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        # Mock Piped response with videoStreams but NO audioStreams
        piped_video_only_response = {
            "title": "Chhath Video",
            "audioStreams": [],
            "videoStreams": [
                {
                    "url": "https://googlevideo.com/videoplayback?mime=video%2Fmp4",
                    "format": "MP4",
                    "quality": "720p",
                    "mimeType": "video/mp4",
                    "videoOnly": False,
                }
            ],
        }

        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps(piped_video_only_response).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        result = StreamCacheService._extract_upstream("vidNoAudioStreams")
        # Pure audio requirement: must NOT return the muxed video stream!
        assert result is None

    @patch("app.services.stream_cache_service._get_redis")
    @patch.object(StreamCacheService, "_extract_upstream")
    def test_force_fresh_bypasses_cache(self, mock_extract, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        # Prepopulate L1 and Redis mock
        _l1_cache["vidFresh"] = {"url": "https://cached.url"}
        _l1_cache_ts["vidFresh"] = 9999999999

        fresh_result = {"url": "https://fresh.url", "format": "M4A"}
        mock_extract.return_value = fresh_result
        mock_redis.set.return_value = True

        res = StreamCacheService.get_stream("vidFresh", force_fresh=True)
        assert res["url"] == "https://fresh.url"
        mock_extract.assert_called_once_with("vidFresh")

    @patch("app.services.stream_cache_service._get_redis")
    def test_invalidate_stream_direct_promotes_proxy_to_degraded(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.ttl.return_value = 5000

        # Seed L1 cache with direct and proxy
        _l1_cache["vidDegrade"] = {
            "url": "https://direct.googlevideo.com/videoplayback",
            "proxy_url": "https://proxy.chocolatemoo.com/videoplayback",
            "status": "READY",
        }
        _l1_cache_ts["vidDegrade"] = 1000

        StreamCacheService.invalidate_stream("vidDegrade", source_type="direct")

        # Must promote proxy_url to url and set status to DEGRADED
        assert _l1_cache["vidDegrade"]["url"] == "https://proxy.chocolatemoo.com/videoplayback"
        assert _l1_cache["vidDegrade"]["status"] == "DEGRADED"
        mock_redis.setex.assert_called_once()
