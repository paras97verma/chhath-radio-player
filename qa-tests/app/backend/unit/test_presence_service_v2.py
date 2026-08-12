"""
Unit tests for the refactored presence_service (O(1) Redis counter).

Tests the in-memory fallback path (no Redis required) and the
public API contract: record_heartbeat, get_listener_count, remove_session.
"""

import time
import uuid
from unittest.mock import MagicMock, patch

import pytest

# ─── Test in-memory fallback (no Redis) ──────────────────────────────────────

class TestInMemoryFallback:
    """Tests that run without Redis — use the in-memory fallback."""

    def setup_method(self):
        # Force the in-memory path by patching _get_client to return None
        self._patcher = patch(
            "app.services.presence_service._get_client", return_value=None
        )
        self._patcher.start()
        # Clear in-memory sessions
        import app.services.presence_service as ps
        ps._mem_sessions.clear()

    def teardown_method(self):
        self._patcher.stop()
        import app.services.presence_service as ps
        ps._mem_sessions.clear()

    def test_initial_count_is_zero(self):
        from app.services.presence_service import get_listener_count
        assert get_listener_count() == 0

    def test_heartbeat_increments_count(self):
        from app.services.presence_service import record_heartbeat, get_listener_count
        sid = uuid.uuid4().hex
        record_heartbeat(sid)
        assert get_listener_count() == 1

    def test_multiple_sessions_counted(self):
        from app.services.presence_service import record_heartbeat, get_listener_count
        for _ in range(5):
            record_heartbeat(uuid.uuid4().hex)
        assert get_listener_count() == 5

    def test_same_session_not_double_counted(self):
        from app.services.presence_service import record_heartbeat, get_listener_count
        sid = uuid.uuid4().hex
        record_heartbeat(sid)
        record_heartbeat(sid)
        record_heartbeat(sid)
        assert get_listener_count() == 1

    def test_remove_session_decrements_count(self):
        from app.services.presence_service import (
            record_heartbeat, get_listener_count, remove_session
        )
        sid = uuid.uuid4().hex
        record_heartbeat(sid)
        assert get_listener_count() == 1
        remove_session(sid)
        assert get_listener_count() == 0

    def test_expired_sessions_not_counted(self):
        from app.services.presence_service import record_heartbeat, get_listener_count
        import app.services.presence_service as ps

        sid = uuid.uuid4().hex
        record_heartbeat(sid)
        # Manually expire the session
        ps._mem_sessions[sid] = time.time() - 1
        assert get_listener_count() == 0

    def test_remove_nonexistent_session_is_safe(self):
        from app.services.presence_service import remove_session
        # Should not raise
        remove_session("nonexistent-session-id")


# ─── Test Redis path (mocked) ─────────────────────────────────────────────────

class TestRedisPath:
    """Tests the Redis code path with a mocked Redis client."""

    def setup_method(self):
        self.mock_redis = MagicMock()
        self._patcher = patch(
            "app.services.presence_service._get_client",
            return_value=self.mock_redis,
        )
        self._patcher.start()

    def teardown_method(self):
        self._patcher.stop()

    def test_new_session_increments_counter(self):
        from app.services.presence_service import record_heartbeat
        self.mock_redis.zadd.return_value = 1  # new session
        record_heartbeat("test-session-1")
        self.mock_redis.incr.assert_called_once_with("chhath:listeners:count")

    def test_existing_session_does_not_increment(self):
        from app.services.presence_service import record_heartbeat
        self.mock_redis.zadd.return_value = 0  # existing session
        record_heartbeat("test-session-1")
        self.mock_redis.incr.assert_not_called()

    def test_get_count_reads_counter_key(self):
        from app.services.presence_service import get_listener_count
        self.mock_redis.get.return_value = "42"
        count = get_listener_count()
        assert count == 42
        self.mock_redis.get.assert_called_once_with("chhath:listeners:count")

    def test_get_count_never_negative(self):
        from app.services.presence_service import get_listener_count
        self.mock_redis.get.return_value = "-5"
        count = get_listener_count()
        assert count == 0

    def test_remove_session_decrements_counter(self):
        from app.services.presence_service import remove_session
        self.mock_redis.zrem.return_value = 1  # session existed
        remove_session("test-session-1")
        self.mock_redis.decr.assert_called_once_with("chhath:listeners:count")

    def test_remove_nonexistent_session_no_decrement(self):
        from app.services.presence_service import remove_session
        self.mock_redis.zrem.return_value = 0  # session didn't exist
        remove_session("nonexistent")
        self.mock_redis.decr.assert_not_called()

    def test_redis_error_falls_back_gracefully(self):
        from redis.exceptions import RedisError
        from app.services.presence_service import get_listener_count
        self.mock_redis.get.side_effect = RedisError("connection refused")
        # Should not raise — falls back to in-memory
        count = get_listener_count()
        assert isinstance(count, int)