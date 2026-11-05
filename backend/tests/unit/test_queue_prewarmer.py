"""
Unit tests for QueuePrewarmer service.
"""

import asyncio
import threading
import time
from unittest.mock import MagicMock, patch, AsyncMock
import pytest

import app.services.queue_prewarmer as prewarmer_module
from app.services.queue_prewarmer import (
    QueuePrewarmer,
    start_prewarmer,
    stop_prewarmer,
)


@pytest.fixture(autouse=True)
def cleanup():
    stop_prewarmer()
    yield
    stop_prewarmer()


def current_stream(video_id: str):
    now = time.time()
    url = "https://media.test/audio"
    return {
        "schema_version": 1,
        "video_id": video_id,
        "generation": 7,
        "refreshed_at": now,
        "url": url,
        "direct_url": url,
        "status": "READY",
        "sources": [
            {
                "mode": "direct",
                "provider": "invidious",
                "provider_origin": "https://inv.nadeko.net",
                "url": url,
                "itag": 140,
                "mime_type": 'audio/mp4; codecs="mp4a.40.2"',
                "codec": "mp4a.40.2",
                "resolved_at": now,
                "expires_at": None,
                "refresh_at": now + 1200,
                "validation_state": "validated",
            },
            {
                "mode": "proxy",
                "provider": "invidious",
                "provider_origin": "https://inv.nadeko.net",
                "url": f"https://inv.nadeko.net/latest_version?id={video_id}&itag=140&local=true",
                "itag": 140,
                "mime_type": 'audio/mp4; codecs="mp4a.40.2"',
                "codec": "mp4a.40.2",
                "resolved_at": now,
                "expires_at": None,
                "refresh_at": now + 1200,
                "validation_state": "validated",
            },
        ],
    }
class TestQueuePrewarmer:
    def test_mode_summary_counts_fresh_refreshed_failed_and_overdue_sources(self):
        before = {
            "stable": {"direct": 1, "proxy": 1},
            "updated": {"direct": 1},
            "direct_only": {"direct": 2},
            "failed": {"direct": 1, "proxy": 1},
        }
        after = {
            "stable": {"direct": 1, "proxy": 1},
            "updated": {"direct": 3, "proxy": 4},
            "direct_only": {"direct": 2},
            "failed": {},
        }

        summary = prewarmer_module._summarize_candidate_modes(
            ["stable", "updated", "direct_only", "failed"],
            before,
            after,
            failed_ids={"failed"},
        )

        assert summary["warmed"] == 2
        assert summary["failed"] == ["direct_only", "failed"]
        assert summary["modes"]["direct"] == {
            "fresh": 2, "refreshed": 1, "failed": 1, "overdue": 1,
        }
        assert summary["modes"]["proxy"] == {
            "fresh": 1, "refreshed": 1, "failed": 1, "overdue": 2,
        }

    @patch("app.services.queue_prewarmer._get_redis")
    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream_fast")
    def test_is_song_warm_requires_a_current_pair_outside_refresh_window(
        self, mock_get_fast, mock_get_redis
    ):
        mock_get_fast.return_value = current_stream("vid123")

        assert QueuePrewarmer.is_song_warm("vid123") is True

        mock_get_fast.assert_called_once_with("vid123", record_metrics=False)
        mock_get_redis.assert_not_called()

    @pytest.mark.parametrize("invalid_record", [
        {"url": "https://media.test/legacy-only"},
        {**current_stream("vid123"), "generation": 0},
        {
            **current_stream("vid123"),
            "sources": [{
                **current_stream("vid123")["sources"][0],
                "refresh_at": time.time() - 1,
            }],
        },
        {
            **current_stream("vid123"),
            "sources": [{
                **current_stream("vid123")["sources"][0],
                "validation_state": "expired",
            }],
        },
    ])
    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream_fast")
    def test_is_song_warm_rejects_aggregate_or_stale_candidates(
        self, mock_get_fast, invalid_record
    ):
        mock_get_fast.return_value = invalid_record

        assert QueuePrewarmer.is_song_warm("vid123") is False

    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream_fast")
    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream")
    @patch("app.services.queue_prewarmer.StreamCacheService.schedule_stream_refresh")
    def test_warm_song_skips_when_both_current_candidates_are_warm(
        self, mock_schedule, mock_get_stream, mock_get_fast
    ):
        mock_get_fast.return_value = current_stream("vid123")

        result = QueuePrewarmer.warm_song("vid123", force=False)
        assert result is True
        mock_get_fast.assert_called_once_with("vid123", record_metrics=False)
        mock_get_stream.assert_not_called()
        mock_schedule.assert_called_once()

    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream_fast", return_value=None)
    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream")
    def test_warm_song_resolves_when_cold(self, mock_get_stream, _mock_get_fast):
        mock_get_stream.return_value = current_stream("vid123")

        result = QueuePrewarmer.warm_song("vid123", force=False)
        assert result is True
        mock_get_stream.assert_called_once_with("vid123", priority="normal", force_fresh=False)

    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream_fast", return_value=None)
    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream", return_value=None)
    def test_warm_song_returns_false_on_extraction_failure(self, mock_get_stream, _mock_get_fast):
        result = QueuePrewarmer.warm_song("brokenVid", force=False)
        assert result is False

    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream_fast")
    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream")
    def test_warm_song_refreshes_direct_only_cache_to_restore_proxy(
        self, mock_get_stream, mock_get_fast
    ):
        direct_only = current_stream("vid123")
        direct_only["sources"] = direct_only["sources"][:1]
        mock_get_fast.return_value = direct_only
        mock_get_stream.return_value = current_stream("vid123")

        assert QueuePrewarmer.warm_song("vid123", force=False) is True

        mock_get_stream.assert_called_once_with("vid123", priority="normal", force_fresh=True)

    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream")
    def test_warm_song_does_not_report_success_without_proxy_candidate(self, mock_get_stream):
        direct_only = current_stream("vid123")
        direct_only["sources"] = direct_only["sources"][:1]
        mock_get_stream.return_value = direct_only

        assert QueuePrewarmer.warm_song("vid123", force=True) is False

    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream")
    def test_force_warm_reaches_resolver_as_a_forced_refresh(self, mock_get_stream):
        mock_get_stream.return_value = current_stream("vid123")

        assert QueuePrewarmer.warm_song("vid123", force=True) is True

        mock_get_stream.assert_called_once_with("vid123", priority="normal", force_fresh=True)

    @patch("app.services.queue_prewarmer.StreamCacheService.get_stream")
    def test_warm_song_rejects_aggregate_url_without_current_source(
        self, mock_get_stream
    ):
        mock_get_stream.return_value = {"url": "https://media.test/legacy-only"}

        assert QueuePrewarmer.warm_song("vid123", force=True) is False

    def test_priority_warm_failure_is_kept_in_due_retry_schedule(self, monkeypatch):
        now = 1_700_000_000.0
        redis = MagicMock()
        redis.rpop.side_effect = [b"vid_retry", None]
        db = MagicMock()
        song_service = MagicMock()
        song_service.get_by_video_id.return_value = MagicMock(enabled=True)
        monkeypatch.setattr(prewarmer_module, "_get_redis", lambda: redis)
        monkeypatch.setattr(prewarmer_module, "SessionLocal", lambda: db)
        monkeypatch.setattr(prewarmer_module, "SongService", song_service)
        monkeypatch.setattr(prewarmer_module.time, "time", lambda: now)
        monkeypatch.setattr(
            QueuePrewarmer,
            "warm_song",
            classmethod(lambda _cls, _video_id, force=False: False),
        )

        QueuePrewarmer.process_priority_queue(max_items=1)

        assert redis.zadd.called
        retry_key, due_items = redis.zadd.call_args.args
        assert retry_key == "chhath:queue:reconciler_retry"
        assert due_items["vid_retry"] >= now + 60

    def test_due_priority_retry_is_dispatched_and_cleared_after_success(self, monkeypatch):
        redis = MagicMock()
        redis.zrangebyscore.return_value = [b"vid_due"]
        redis.rpop.return_value = None
        db = MagicMock()
        song_service = MagicMock()
        song_service.get_by_video_id.return_value = MagicMock(enabled=True)
        monkeypatch.setattr(prewarmer_module, "_get_redis", lambda: redis)
        monkeypatch.setattr(prewarmer_module, "SessionLocal", lambda: db)
        monkeypatch.setattr(prewarmer_module, "SongService", song_service)
        monkeypatch.setattr(
            QueuePrewarmer,
            "warm_song",
            classmethod(lambda _cls, _video_id, force=False: True),
        )

        assert QueuePrewarmer.process_priority_queue(max_items=1) == 1

        redis.zrem.assert_called_once_with("chhath:queue:reconciler_retry", "vid_due")
        redis.hdel.assert_called_once_with("chhath:queue:reconciler_retry_attempts", "vid_due")

    @pytest.mark.asyncio
    async def test_warm_pass_offloads_serially_and_uses_origin_rate_limit(self, monkeypatch):
        main_thread = threading.current_thread()
        active = 0
        maximum_active = 0
        worker_threads = []
        delays = []
        guard = threading.Lock()

        def warm(_video_id, force=False):
            nonlocal active, maximum_active
            with guard:
                active += 1
                maximum_active = max(maximum_active, active)
                worker_threads.append(threading.current_thread())
            time.sleep(0.01)
            with guard:
                active -= 1
            return True

        async def no_wait(delay):
            delays.append(delay)

        monkeypatch.setattr(
            QueuePrewarmer,
            "warm_song",
            classmethod(lambda _cls, video_id, force=False: warm(video_id, force)),
        )
        monkeypatch.setattr(prewarmer_module.asyncio, "sleep", no_wait)

        failed = await QueuePrewarmer.warm_queue_pass(["vid_a", "vid_b"], pace_delay=1000)

        assert failed == []
        assert maximum_active == 1
        assert worker_threads and all(thread is not main_thread for thread in worker_threads)
        assert delays == [0, 0]

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
        self, mock_warm, mock_get_songs, mock_session_local, monkeypatch
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
        snapshots = [
            {"vid1": {"direct": 1, "proxy": 1}},
            {
                "vid1": {"direct": 1, "proxy": 1},
                "vid2": {"direct": 2, "proxy": 2},
            },
        ]
        monkeypatch.setattr(
            prewarmer_module,
            "_snapshot_candidate_modes",
            lambda _ids: snapshots.pop(0),
        )

        summary = await QueuePrewarmer.run_prewarmer_cycle()

        assert summary["total"] == 2
        assert summary["warmed"] == 2
        assert summary["failed"] == []
        assert summary["modes"]["direct"]["fresh"] == 1
        assert summary["modes"]["proxy"]["refreshed"] == 1
        assert call_counts["vid2"] == 2  # Retried in pass 2

    @pytest.mark.asyncio
    async def test_leader_lease_renews_while_full_cycle_is_still_running(self, monkeypatch):
        redis = MagicMock()
        redis.set.return_value = True
        renewal_seen = asyncio.Event()
        redis.eval.side_effect = lambda *_args: renewal_seen.set() or 1
        cycle_started = asyncio.Event()
        release_cycle = asyncio.Event()
        real_sleep = asyncio.sleep

        async def fast_sleep(_delay):
            await real_sleep(0.001)

        async def long_cycle(_cls, *, include_priority=True):
            cycle_started.set()
            await release_cycle.wait()
            return {"total": 1, "warmed": 1, "failed": []}

        monkeypatch.setattr(prewarmer_module, "_get_redis", lambda: redis)
        monkeypatch.setattr(prewarmer_module.asyncio, "sleep", fast_sleep)
        monkeypatch.setattr(prewarmer_module, "LEADER_LEASE_RENEW_INTERVAL_SECONDS", 0.002)
        monkeypatch.setattr(
            QueuePrewarmer,
            "process_priority_queue",
            classmethod(lambda _cls, max_items=10: 0),
        )
        monkeypatch.setattr(
            QueuePrewarmer,
            "run_prewarmer_cycle",
            classmethod(long_cycle),
        )
        prewarmer_module._is_running = True
        loop_task = asyncio.create_task(prewarmer_module._reconciler_loop())
        try:
            await asyncio.wait_for(cycle_started.wait(), timeout=1)
            renewal_seen.clear()
            await asyncio.wait_for(renewal_seen.wait(), timeout=0.1)
        finally:
            prewarmer_module._is_running = False
            release_cycle.set()
            loop_task.cancel()
            try:
                await loop_task
            except asyncio.CancelledError:
                pass

    @pytest.mark.asyncio
    async def test_catalog_cycle_starts_immediately_and_repeats_at_configured_interval(self, monkeypatch):
        redis = MagicMock()
        redis.set.return_value = True
        redis.eval.return_value = 1
        now = [1000.0]
        cycle_times = []
        main_sleeps = 0
        real_sleep = asyncio.sleep

        async def fake_sleep(delay):
            nonlocal main_sleeps
            await real_sleep(0.001)
            if delay == 15:
                main_sleeps += 1
                if main_sleeps == 1:
                    now[0] += 400
                elif main_sleeps == 2:
                    now[0] += 200

        async def cycle(_cls, *, include_priority=True):
            cycle_times.append(now[0])
            if len(cycle_times) == 2:
                prewarmer_module._is_running = False
            return {"total": 1, "warmed": 1, "failed": []}

        monkeypatch.setattr(prewarmer_module, "_get_redis", lambda: redis)
        monkeypatch.setattr(prewarmer_module.time, "time", lambda: now[0])
        monkeypatch.setattr(prewarmer_module.asyncio, "sleep", fake_sleep)
        monkeypatch.setattr(prewarmer_module, "RECONCILIATION_INTERVAL_SECONDS", 600)
        monkeypatch.setattr(prewarmer_module, "LEADER_LEASE_RENEW_INTERVAL_SECONDS", 1000)
        monkeypatch.setattr(
            QueuePrewarmer,
            "process_priority_queue",
            classmethod(lambda _cls, max_items=10: 0),
        )
        monkeypatch.setattr(QueuePrewarmer, "run_prewarmer_cycle", classmethod(cycle))
        prewarmer_module._is_running = True

        await asyncio.wait_for(prewarmer_module._reconciler_loop(), timeout=1)

        assert cycle_times == [1000.0, 1600.0]

    @pytest.mark.asyncio
    async def test_cycle_accounts_for_every_enabled_catalog_song(self, monkeypatch):
        video_ids = [f"video_{index:03d}" for index in range(53)]
        songs = [
            MagicMock(
                id=index,
                youtube_video_id=video_id,
                metadata_status="complete",
                duration_seconds=120,
                thumbnail_url="https://thumb.test/song.jpg",
            )
            for index, video_id in enumerate(video_ids)
        ]
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = []
        redis = MagicMock()
        warmed_ids = []

        async def collect_ids(_cls, ids, pace_delay=0):
            warmed_ids.extend(ids)
            return []

        song_service = MagicMock()
        song_service.get_all_enabled.return_value = songs
        monkeypatch.setattr(prewarmer_module, "_get_redis", lambda: redis)
        monkeypatch.setattr(prewarmer_module, "SessionLocal", lambda: db)
        monkeypatch.setattr(prewarmer_module, "SongService", song_service)
        snapshots = [
            {},
            {video_id: {"direct": 1, "proxy": 1} for video_id in video_ids},
        ]
        monkeypatch.setattr(
            prewarmer_module,
            "_snapshot_candidate_modes",
            lambda _ids: snapshots.pop(0),
        )
        monkeypatch.setattr(
            QueuePrewarmer,
            "process_priority_queue",
            classmethod(lambda _cls, max_items=20: 0),
        )
        monkeypatch.setattr(
            QueuePrewarmer,
            "warm_queue_pass",
            classmethod(collect_ids),
        )

        summary = await QueuePrewarmer.run_prewarmer_cycle()

        assert summary["total"] == len(video_ids)
        assert summary["warmed"] == len(video_ids)
        assert summary["modes"]["direct"]["refreshed"] == len(video_ids)
        assert warmed_ids == video_ids

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
