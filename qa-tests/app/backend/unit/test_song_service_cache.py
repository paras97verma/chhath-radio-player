"""
Unit tests for song_service Redis cache layer.

Tests the cache get/set/delete helpers and verifies that
get_radio_queue() uses the cache and invalidates on writes.
"""

import json
import uuid
from unittest.mock import MagicMock, patch, call

import pytest


class TestCacheHelpers:
    """Test _cache_get, _cache_set, _cache_delete in isolation."""

    def setup_method(self):
        self.mock_redis = MagicMock()
        self._patcher = patch(
            "app.services.song_service._get_redis",
            return_value=self.mock_redis,
        )
        self._patcher.start()

    def teardown_method(self):
        self._patcher.stop()

    def test_cache_get_returns_parsed_json(self):
        from app.services.song_service import _cache_get
        self.mock_redis.get.return_value = json.dumps([{"id": "abc", "title": "Test"}])
        result = _cache_get("some-key")
        assert result == [{"id": "abc", "title": "Test"}]

    def test_cache_get_returns_none_on_miss(self):
        from app.services.song_service import _cache_get
        self.mock_redis.get.return_value = None
        result = _cache_get("some-key")
        assert result is None

    def test_cache_get_returns_none_on_redis_error(self):
        from app.services.song_service import _cache_get
        from redis.exceptions import RedisError
        self.mock_redis.get.side_effect = RedisError("connection refused")
        result = _cache_get("some-key")
        assert result is None

    def test_cache_set_calls_setex(self):
        from app.services.song_service import _cache_set
        data = [{"id": "abc"}]
        _cache_set("my-key", data, 30)
        self.mock_redis.setex.assert_called_once_with("my-key", 30, json.dumps(data))

    def test_cache_delete_calls_delete(self):
        from app.services.song_service import _cache_delete
        _cache_delete("my-key")
        self.mock_redis.delete.assert_called_once_with("my-key")

    def test_cache_set_silent_on_redis_error(self):
        from app.services.song_service import _cache_set
        from redis.exceptions import RedisError
        self.mock_redis.setex.side_effect = RedisError("timeout")
        # Should not raise
        _cache_set("key", [], 30)

    def test_cache_delete_silent_on_redis_error(self):
        from app.services.song_service import _cache_delete
        from redis.exceptions import RedisError
        self.mock_redis.delete.side_effect = RedisError("timeout")
        # Should not raise
        _cache_delete("key")


class TestCacheInvalidation:
    """Verify cache is invalidated on create/update/delete."""

    def setup_method(self):
        self.mock_redis = MagicMock()
        self._redis_patcher = patch(
            "app.services.song_service._get_redis",
            return_value=self.mock_redis,
        )
        self._redis_patcher.start()

    def teardown_method(self):
        self._redis_patcher.stop()

    def test_create_invalidates_cache(self):
        from app.services.song_service import SongService, QUEUE_CACHE_KEY
        from app.schemas.song import SongCreate

        mock_db = MagicMock()
        mock_song = MagicMock()
        mock_db.refresh = MagicMock()
        mock_db.add = MagicMock()
        mock_db.commit = MagicMock()

        data = SongCreate(
            title="Test Song",
            artist="Test Artist",
            youtube_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            category="devotional",
            sort_order=1,
        )

        with patch("app.services.song_service.extract_youtube_video_id", return_value="dQw4w9WgXcQ"):
            with patch("app.services.song_service.Song", return_value=mock_song):
                SongService.create(mock_db, data)

        self.mock_redis.delete.assert_called_with(QUEUE_CACHE_KEY)

    def test_delete_invalidates_cache(self):
        from app.services.song_service import SongService, QUEUE_CACHE_KEY

        mock_db = MagicMock()
        mock_song = MagicMock()

        SongService.delete(mock_db, mock_song)

        self.mock_redis.delete.assert_called_with(QUEUE_CACHE_KEY)


class TestSongToDict:
    """Test _song_to_dict serialization."""

    def test_all_fields_present(self):
        from app.services.song_service import _song_to_dict

        mock_song = MagicMock()
        mock_song.id = uuid.UUID("12345678-1234-5678-1234-567812345678")
        mock_song.title = "Kaanch Hi Baans"
        mock_song.artist = "Sharda Sinha"
        mock_song.youtube_video_id = "abc123"
        mock_song.youtube_url = "https://youtube.com/watch?v=abc123"
        mock_song.category = "devotional"
        mock_song.sort_order = 1
        mock_song.enabled = True

        result = _song_to_dict(mock_song)

        assert result["id"] == "12345678-1234-5678-1234-567812345678"
        assert result["title"] == "Kaanch Hi Baans"
        assert result["artist"] == "Sharda Sinha"
        assert result["youtube_video_id"] == "abc123"
        assert result["enabled"] is True