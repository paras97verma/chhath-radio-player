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
    _l1_cache,
    _l1_cache_ts,
    STREAM_CACHE_PREFIX,
    STREAM_LOCK_PREFIX,
    RELEASE_LOCK_LUA,
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
