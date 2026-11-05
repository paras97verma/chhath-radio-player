"""
Unit and resilience tests for Catalog Readiness, Metadata Synchronization,
Stream Caching, and Multi-Worker Lease Coordination.
"""

import json
import time
from unittest.mock import MagicMock, patch
from fastapi import Response
import pytest

import app.services.queue_prewarmer as prewarmer_module
from app.api.admin.songs import get_admin_catalog_status
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
    STREAM_FENCE_PREFIX,
)
import app.services.stream_cache_service as cache_module
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

    @patch("app.services.stream_cache_service._get_redis")
    def test_get_stream_fast_l1_hit_returns_immediately(self, mock_get_redis):
        now = time.time()
        record = self._record("fast_vid", now)
        _l1_cache["fast_vid"] = record
        _l1_cache_ts["fast_vid"] = now
        mock_redis = MagicMock()
        mock_redis.eval.return_value = 1
        mock_get_redis.return_value = mock_redis

        result = StreamCacheService.get_stream_fast("fast_vid")
        assert result is not None
        assert result["cached"] is True
        assert result["cache_tier"] == "L1_MEMORY"
        assert "proxy_url" in result
        assert "fence_token" not in result

    @staticmethod
    def _record(video_id, now):
        origin = cache_module.INVIDIOUS_REGISTRY[0].origin
        expires_at = now + 7200
        proxy_url = f"{origin}/latest_version?id={video_id}&itag=140&local=true"
        return {
            "schema_version": 1,
            "video_id": video_id,
            "generation": 3,
            "fence_token": "catalog-fence",
            "refreshed_at": now,
            "bitrate": 128000,
            "sources": [
                {
                    "mode": "direct", "provider": "invidious", "provider_origin": origin,
                    "url": f"https://cdn.googlevideo.com/audio?itag=140&expire={int(expires_at)}",
                    "itag": 140, "mime_type": 'audio/mp4; codecs="mp4a.40.2"',
                    "codec": "mp4a.40.2", "resolved_at": now, "expires_at": expires_at,
                    "refresh_at": expires_at - 600, "validation_state": "validated",
                },
                {
                    "mode": "proxy", "provider": "invidious", "provider_origin": origin,
                    "url": proxy_url, "itag": 140, "mime_type": 'audio/mp4; codecs="mp4a.40.2"',
                    "codec": "mp4a.40.2", "resolved_at": now, "expires_at": None,
                    "refresh_at": now + 1800, "validation_state": "validated",
                },
            ],
            "duration": 300,
            "title": "Catalog test song",
        }

    @patch("app.services.stream_cache_service._get_redis")
    def test_get_stream_fast_redis_hit_populates_l1(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        cached_payload = self._record("redis_fast", time.time())
        mock_redis.eval.side_effect = lambda script, *_args: (
            json.dumps(cached_payload) if script == cache_module.READ_FENCED_CACHE_LUA
            else 1 if script == cache_module.MATCH_FENCE_LUA else 0
        )

        result = StreamCacheService.get_stream_fast("redis_fast")
        assert result is not None
        assert result["cached"] is True
        assert result["cache_tier"] == "L2_REDIS"
        assert "redis_fast" in _l1_cache  # L1 populated

    @patch("app.services.stream_cache_service._get_redis")
    def test_get_stream_fast_miss_returns_none(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.eval.return_value = None

        result = StreamCacheService.get_stream_fast("unknown_vid")
        assert result is None

    @patch("app.services.stream_cache_service._get_redis")
    def test_invalidate_stream_clears_l1_and_redis(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.eval.side_effect = lambda script, *_args: (
            None if script == cache_module.READ_FENCED_CACHE_LUA
            else [1, 0] if script == cache_module.EVICT_FENCED_CACHE_LUA else 0
        )

        _l1_cache["to_clear"] = {"url": "http://example.com"}
        _l1_cache_ts["to_clear"] = time.time()

        StreamCacheService.invalidate_stream("to_clear")
        assert "to_clear" not in _l1_cache
        assert any(
            call.args[0] == cache_module.EVICT_FENCED_CACHE_LUA
            and call.args[2] == f"{STREAM_FENCE_PREFIX}to_clear"
            for call in mock_redis.eval.call_args_list
        )


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

    def test_get_catalog_readiness_status_reports_mode_health_and_overdue_age(self, monkeypatch):
        song1 = Song(title="S1", artist="A1", youtube_video_id="v1", enabled=True, metadata_status="complete", duration_seconds=120)
        song2 = Song(title="S2", artist="A2", youtube_video_id="v2", enabled=True, metadata_status="pending", duration_seconds=None)
        mock_db = MagicMock()
        mock_redis = MagicMock()
        now = time.time()
        mock_redis.get.return_value = None
        mock_redis.zrangebyscore.return_value = [(b"retry_vid", now - 12)]
        cache_summary = {
            "cache_available": True,
            "lookup_errors": 0,
            "songs_ready": 1,
            "songs_missing": 1,
            "songs_expiring": 1,
            "modes": {
                "direct": {
                    "ready": 1, "expiring": 0, "overdue": 1, "missing": 0,
                    "oldest_overdue_age_seconds": 37,
                },
                "proxy": {
                    "ready": 1, "expiring": 1, "overdue": 0, "missing": 1,
                    "oldest_overdue_age_seconds": 0,
                },
            },
        }
        telemetry = {
            "generation_mismatches": 2,
            "stale_write_rejections": 3,
            "expired_candidates_rejected": 4,
            "stale_expired_serves": 0,
        }
        monkeypatch.setattr(prewarmer_module, "SessionLocal", lambda: mock_db)
        monkeypatch.setattr(prewarmer_module.SongService, "get_all", lambda _db: [song1, song2])
        monkeypatch.setattr(prewarmer_module, "_get_redis", lambda: mock_redis)
        monkeypatch.setattr(StreamCacheService, "get_catalog_cache_summary", lambda ids: cache_summary)
        monkeypatch.setattr(StreamCacheService, "get_metrics", lambda: telemetry)

        status = CatalogReconciliationService.get_catalog_readiness_status(force=True)

        assert status["catalog"]["total_songs"] == 2
        assert status["catalog"]["eligible_songs"] == 2
        assert status["catalog"]["metadata_ready"] == 1
        assert status["catalog"]["stream_ready"] == 1
        assert status["catalog"]["stream_proxy_ready"] == 1
        assert status["catalog"]["stream_direct_ready"] == 1
        assert status["catalog"]["stream_missing"] == 1
        assert status["catalog"]["stream_modes"] == cache_summary["modes"]
        assert status["catalog"]["oldest_overdue_age_seconds"] == 37
        assert status["warmer"]["retry_overdue_count"] == 1
        assert status["warmer"]["oldest_retry_overdue_age_seconds"] == pytest.approx(12, abs=0.1)
        assert status["telemetry"]["stale_expired_serves"] == 0
        assert status["telemetry"]["generation_mismatches"] == 2
        assert status["telemetry"]["stale_write_rejections"] == 3

    def test_admin_catalog_status_disables_http_caching(self):
        response = Response()
        result = {"catalog": {"stream_ready": 1}}
        with patch.object(CatalogReconciliationService, "get_catalog_readiness_status", return_value=result):
            assert get_admin_catalog_status(response=response, _admin=MagicMock()) == result
        assert response.headers["cache-control"] == "no-store, max-age=0"

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
