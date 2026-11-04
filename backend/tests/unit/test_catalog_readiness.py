"""
Unit and resilience tests for Catalog Readiness, Metadata Synchronization,
Stream Caching, and Multi-Worker Lease Coordination.
"""

import json
import time
from unittest.mock import MagicMock, patch
import pytest

from app.models.song import Song
from app.services.song_service import (
    SongService,
    fetch_video_metadata,
    enqueue_priority_warming,
    RECONCILER_PRIORITY_KEY,
    QUEUE_CACHE_KEY,
)
from app.services.stream_cache_service import (
    StreamCacheService,
    _l1_cache,
    _l1_cache_ts,
    STREAM_CACHE_PREFIX,
    STREAM_LOCK_PREFIX,
)
from app.services.queue_prewarmer import (
    CatalogReconciliationService,
    LEADER_KEY,
    WORKER_ID,
)


@pytest.fixture(autouse=True)
def clean_stream_caches():
    _l1_cache.clear()
    _l1_cache_ts.clear()
    yield
    _l1_cache.clear()
    _l1_cache_ts.clear()


class TestMetadataSynchronization:
    """Tests for metadata retrieval and persistence."""

    @patch("urllib.request.urlopen")
    def test_fetch_video_metadata_invidious_success(self, mock_urlopen):
        # Mock Invidious response with title, author, lengthSeconds, videoThumbnails
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({
            "title": "Chhathi Maiya Ke Geet",
            "author": "Sharda Sinha",
            "lengthSeconds": 315,
            "videoThumbnails": [
                {"quality": "high", "url": "https://i.ytimg.com/vi/test12345/hqdefault.jpg"}
            ]
        }).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        meta = fetch_video_metadata("test12345")
        assert meta["title"] == "Chhathi Maiya Ke Geet"
        assert meta["artist"] == "Sharda Sinha"
        assert meta["duration_seconds"] == 315
        assert "hqdefault.jpg" in meta["thumbnail_url"]

    @patch("urllib.request.urlopen")
    def test_fetch_video_metadata_oembed_fallback(self, mock_urlopen):
        # Invidious fails, oEmbed succeeds
        call_count = 0

        def side_effect(req, timeout=None):
            nonlocal call_count
            call_count += 1
            if "youtube.com/oembed" in req.full_url:
                resp = MagicMock()
                resp.status = 200
                resp.read.return_value = json.dumps({
                    "title": "Uga Ho Suruj Dev",
                    "author_name": "Anuradha Paudwal",
                    "thumbnail_url": "https://i.ytimg.com/vi/oembed123/hqdefault.jpg"
                }).encode("utf-8")
                ctx = MagicMock()
                ctx.__enter__.return_value = resp
                return ctx
            raise Exception("Invidious timeout")

        mock_urlopen.side_effect = side_effect

        meta = fetch_video_metadata("oembed123")
        assert meta["title"] == "Uga Ho Suruj Dev"
        assert meta["artist"] == "Anuradha Paudwal"
        assert "hqdefault.jpg" in meta["thumbnail_url"]

    @patch("app.services.song_service.fetch_video_metadata")
    def test_sync_song_metadata_preserves_custom_title_and_artist(self, mock_meta):
        mock_meta.return_value = {
            "title": "Upstream Title",
            "artist": "Upstream Artist",
            "duration_seconds": 240,
            "thumbnail_url": "https://i.ytimg.com/vi/custom123/hqdefault.jpg",
        }
        mock_db = MagicMock()
        song = Song(
            title="My Custom Title",
            artist="My Custom Artist",
            youtube_video_id="custom123",
            youtube_url="https://youtube.com/watch?v=custom123",
            metadata_status="pending",
        )

        success = SongService.sync_song_metadata(mock_db, song, force=True)
        assert success is True
        # Custom title and artist should be preserved!
        assert song.title == "My Custom Title"
        assert song.artist == "My Custom Artist"
        assert song.duration_seconds == 240
        assert song.metadata_status == "complete"
        mock_db.commit.assert_called_once()

    @patch("app.services.song_service._get_redis")
    def test_enqueue_priority_warming(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        enqueue_priority_warming("vid_urgent")
        mock_redis.lpush.assert_called_once_with(RECONCILER_PRIORITY_KEY, "vid_urgent")
        mock_redis.ltrim.assert_called_once_with(RECONCILER_PRIORITY_KEY, 0, 999)


class TestStreamFastLookupAndFallback:
    """Tests for instant cache lookup and proxy fallback URL generation."""

    def test_get_stream_fast_l1_hit_returns_immediately(self):
        now = time.time()
        _l1_cache["fast_vid"] = {
            "url": "https://cdn.googlevideo.com/videoplayback?id=fast&expire=9999999999",
            "format": "M4A",
            "duration": 300,
            "proxy_url": "https://yt.chocolatemoo53.com/latest_version?id=fast_vid&itag=140&local=true",
        }
        _l1_cache_ts["fast_vid"] = now

        result = StreamCacheService.get_stream_fast("fast_vid")
        assert result is not None
        assert result["cached"] is True
        assert result["cache_tier"] == "L1_MEMORY"
        assert "proxy_url" in result

    @patch("app.services.stream_cache_service._get_redis")
    def test_get_stream_fast_redis_hit_populates_l1(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        cached_payload = {
            "url": "https://cdn.googlevideo.com/videoplayback?id=redis_fast&expire=9999999999",
            "format": "M4A",
            "duration": 280,
            "proxy_url": "https://yt.chocolatemoo53.com/latest_version?id=redis_fast&itag=140&local=true",
        }
        mock_redis.get.return_value = json.dumps(cached_payload)

        result = StreamCacheService.get_stream_fast("redis_fast")
        assert result is not None
        assert result["cached"] is True
        assert result["cache_tier"] == "L2_REDIS"
        assert "redis_fast" in _l1_cache  # L1 populated

    @patch("app.services.stream_cache_service._get_redis")
    def test_get_stream_fast_miss_returns_none(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.get.return_value = None

        result = StreamCacheService.get_stream_fast("unknown_vid")
        assert result is None

    @patch("app.services.stream_cache_service._get_redis")
    def test_invalidate_stream_clears_l1_and_redis(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        _l1_cache["to_clear"] = {"url": "http://example.com"}
        _l1_cache_ts["to_clear"] = time.time()

        StreamCacheService.invalidate_stream("to_clear")
        assert "to_clear" not in _l1_cache
        mock_redis.delete.assert_called_once_with(f"{STREAM_CACHE_PREFIX}to_clear")


class TestDistributedCoordinationAndReconciliation:
    """Tests for multi-worker coordination and catalog reconciliation."""

    @pytest.mark.asyncio
    @patch("app.services.queue_prewarmer.SONG_PACE_DELAY_SECONDS", 0.0)
    @patch("app.services.queue_prewarmer.SongService.get_catalog_batch")
    @patch.object(CatalogReconciliationService, "warm_song", return_value=True)
    async def test_reconciliation_batch_processes_songs(self, mock_warm, mock_batch):
        song1 = Song(title="Song 1", artist="Artist 1", youtube_video_id="vid1", metadata_status="complete", duration_seconds=180, thumbnail_url="http://thumb1.jpg")
        song2 = Song(title="Song 2", artist="Artist 2", youtube_video_id="vid2", metadata_status="complete", duration_seconds=200, thumbnail_url="http://thumb2.jpg")
        mock_batch.return_value = [song1, song2]

        res = await CatalogReconciliationService.run_reconciliation_batch(offset=0, limit=2)
        assert res["count"] == 2
        assert res["has_more"] is True

    @patch("app.services.queue_prewarmer._get_redis")
    @patch("app.services.queue_prewarmer.SessionLocal")
    @patch("app.services.queue_prewarmer.SongService.get_all")
    def test_get_catalog_readiness_status(self, mock_get_all, mock_session, mock_get_redis):
        mock_db = MagicMock()
        mock_session.return_value = mock_db

        song1 = Song(title="S1", artist="A1", youtube_video_id="v1", enabled=True, metadata_status="complete", duration_seconds=120)
        song2 = Song(title="S2", artist="A2", youtube_video_id="v2", enabled=True, metadata_status="pending", duration_seconds=None)
        mock_get_all.return_value = [song1, song2]

        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        # v1 is cached in Redis with valid unexpired url
        mock_redis.get.side_effect = lambda k: json.dumps({"url": "http://cdn.com?expire=9999999999"}).encode("utf-8") if "v1" in k else None

        status = CatalogReconciliationService.get_catalog_readiness_status()
        assert status["catalog"]["total_songs"] == 2
        assert status["catalog"]["eligible_songs"] == 2
        assert status["catalog"]["metadata_ready"] == 1
        assert status["catalog"]["stream_ready"] == 1
        assert status["catalog"]["stream_missing"] == 1

    @pytest.mark.asyncio
    @patch("app.services.queue_prewarmer.SONG_PACE_DELAY_SECONDS", 0.0)
    @patch("app.services.queue_prewarmer.SongService.get_catalog_batch")
    @patch.object(CatalogReconciliationService, "warm_song", return_value=True)
    async def test_large_synthetic_catalog_pagination_resilience(self, mock_warm, mock_batch):
        """Simulates paginating over a synthetic catalog of 200 songs in batches of 20."""
        # 10 pages of 20 songs
        pages = []
        for p in range(10):
            page_songs = [
                Song(
                    title=f"Song {p * 20 + i}",
                    artist=f"Artist {p * 20 + i}",
                    youtube_video_id=f"vid_{p}_{i}",
                    enabled=True,
                    metadata_status="complete",
                    duration_seconds=180,
                    thumbnail_url="http://thumb.jpg",
                )
                for i in range(20)
            ]
            pages.append(page_songs)

        def get_batch(db, limit=20, offset=0):
            page_idx = offset // limit
            if page_idx < len(pages):
                return pages[page_idx]
            return []

        mock_batch.side_effect = get_batch

        total_scanned = 0
        offset = 0
        has_more = True
        while has_more:
            res = await CatalogReconciliationService.run_reconciliation_batch(offset=offset, limit=20)
            count = res["count"]
            has_more = res["has_more"]
            total_scanned += count
            offset += count

        assert total_scanned == 200
