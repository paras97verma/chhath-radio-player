"""
Unit tests for QueuePrewarmer service.
"""

from unittest.mock import MagicMock, patch, AsyncMock
import pytest

from app.services.queue_prewarmer import (
    QueuePrewarmer,
    start_prewarmer,
    stop_prewarmer,
    STREAM_CACHE_PREFIX,
)


@pytest.fixture(autouse=True)
def cleanup():
    stop_prewarmer()
    yield
    stop_prewarmer()


class TestQueuePrewarmer:
    @patch("app.services.queue_prewarmer._get_redis")
    def test_is_song_warm_true_when_ttl_sufficient(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.ttl.return_value = 7200  # 2 hours remaining

        assert QueuePrewarmer.is_song_warm("vid123", min_ttl=3600) is True
        mock_redis.ttl.assert_called_once_with(f"{STREAM_CACHE_PREFIX}vid123")

    @patch("app.services.queue_prewarmer._get_redis")
    def test_is_song_warm_false_when_ttl_low_or_missing(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        # Expired or key missing (-2 in Redis)
        mock_redis.ttl.return_value = -2
        assert QueuePrewarmer.is_song_warm("vid123", min_ttl=3600) is False

        # Low TTL (< 3600)
        mock_redis.ttl.return_value = 1800
        assert QueuePrewarmer.is_song_warm("vid123", min_ttl=3600) is False

    @patch.object(QueuePrewarmer, "is_song_warm", return_value=True)
    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream")
    def test_warm_song_skips_when_already_warm(self, mock_get_stream, mock_is_warm):
        result = QueuePrewarmer.warm_song("vid123", force=False)
        assert result is True
        mock_get_stream.assert_not_called()

    @patch.object(QueuePrewarmer, "is_song_warm", return_value=False)
    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream")
    def test_warm_song_resolves_when_cold(self, mock_get_stream, mock_is_warm):
        mock_get_stream.return_value = {
            "url": "https://googlevideo.com/playback?id=123",
            "format": "M4A",
        }

        result = QueuePrewarmer.warm_song("vid123", force=False)
        assert result is True
        mock_get_stream.assert_called_once_with("vid123", priority="normal")

    @patch.object(QueuePrewarmer, "is_song_warm", return_value=False)
    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream", return_value=None)
    def test_warm_song_returns_false_on_extraction_failure(self, mock_get_stream, mock_is_warm):
        result = QueuePrewarmer.warm_song("brokenVid", force=False)
        assert result is False

    @pytest.mark.asyncio
    @patch.object(QueuePrewarmer, "warm_song")
    async def test_warm_queue_pass_collects_failures(self, mock_warm):
        # vid1 succeeds, vid2 fails, vid3 succeeds
        mock_warm.side_effect = lambda vid: vid != "vid2"

        failures = await QueuePrewarmer.warm_queue_pass(["vid1", "vid2", "vid3"], pace_delay=0.01)
        assert failures == ["vid2"]
        assert mock_warm.call_count == 3

    @pytest.mark.asyncio
    @patch("app.services.queue_prewarmer.SECOND_PASS_WAIT_SECONDS", 0.01)
    @patch("app.services.queue_prewarmer.SONG_PACE_DELAY_SECONDS", 0.01)
    @patch("app.services.queue_prewarmer.SessionLocal")
    @patch("app.services.queue_prewarmer.SongService.get_all_enabled")
    @patch.object(QueuePrewarmer, "warm_song")
    async def test_run_prewarmer_cycle_with_second_pass(
        self, mock_warm, mock_get_songs, mock_session_local
    ):
        mock_db = MagicMock()
        mock_session_local.return_value = mock_db

        song1 = MagicMock(youtube_video_id="vid1")
        song2 = MagicMock(youtube_video_id="vid2")
        mock_get_songs.return_value = [song1, song2]

        # On Pass 1: vid2 fails. On Pass 2: vid2 succeeds!
        call_counts = {"vid2": 0}

        def mock_warm_behavior(vid):
            if vid == "vid1":
                return True
            if vid == "vid2":
                call_counts["vid2"] += 1
                return call_counts["vid2"] > 1  # Fails 1st time, succeeds 2nd time
            return False

        mock_warm.side_effect = mock_warm_behavior

        summary = await QueuePrewarmer.run_prewarmer_cycle()

        assert summary["total"] == 2
        assert summary["warmed"] == 2
        assert summary["failed"] == []
        assert call_counts["vid2"] == 2  # Retried in pass 2

    def test_start_and_stop_lifecycle(self):
        with patch("asyncio.get_running_loop") as mock_get_loop:
            mock_loop = MagicMock()
            mock_task = MagicMock()
            mock_task.done.return_value = False
            mock_loop.create_task.return_value = mock_task
            mock_get_loop.return_value = mock_loop

            start_prewarmer()
            mock_loop.create_task.assert_called_once()

            stop_prewarmer()
            mock_task.cancel.assert_called_once()
