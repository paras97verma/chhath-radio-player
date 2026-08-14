"""
Unit tests for app.services.presence_service.

The current service uses a pure in-memory design:
  - _mem_sessions: dict[str, float]  — session_id → expiry timestamp
  - record_heartbeat(session_id)     — sets expiry = now + SESSION_TTL_SECONDS
  - get_listener_count()             — prunes expired sessions, returns len(_mem_sessions),
                                       and periodically writes last-known count to Redis
  - get_last_known_count()           — reads last-known count from Redis (display fallback)
  - remove_session(session_id)       — pops session from _mem_sessions

Redis is only used for the "last known count" persistence (LAST_KNOWN_KEY).
All Redis calls are mocked via unittest.mock.patch so no real Redis is needed.
"""
import time
from unittest.mock import MagicMock, patch

import pytest

import app.services.presence_service as ps
from app.services.presence_service import (
    SESSION_TTL_SECONDS,
    LAST_KNOWN_KEY,
    record_heartbeat,
    get_listener_count,
    get_last_known_count,
    remove_session,
    _mem_sessions,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def make_mock_redis() -> MagicMock:
    """Return a MagicMock that mimics a redis.Redis client."""
    mock = MagicMock()
    mock.get.return_value = None
    mock.set.return_value = True
    return mock


def clear_sessions():
    """Helper to reset shared in-memory state between tests."""
    _mem_sessions.clear()
    ps._last_known_write = 0.0


# ─── TestRecordHeartbeat ──────────────────────────────────────────────────────

class TestRecordHeartbeat:
    def setup_method(self):
        clear_sessions()

    def test_new_session_is_added_to_mem_sessions(self):
        """record_heartbeat adds a new session to _mem_sessions."""
        record_heartbeat("session-new-123")
        assert "session-new-123" in _mem_sessions

    def test_expiry_is_approximately_now_plus_ttl(self):
        """The expiry timestamp is approximately now + SESSION_TTL_SECONDS."""
        before = time.time()
        record_heartbeat("session-ttl-check")
        after = time.time()

        expiry = _mem_sessions["session-ttl-check"]
        assert before + SESSION_TTL_SECONDS <= expiry <= after + SESSION_TTL_SECONDS

    def test_existing_session_expiry_is_refreshed(self):
        """Calling record_heartbeat again refreshes the expiry timestamp."""
        _mem_sessions["session-refresh"] = time.time() + 1  # nearly expired

        time.sleep(0.01)  # tiny delay so the new expiry is measurably later
        record_heartbeat("session-refresh")

        new_expiry = _mem_sessions["session-refresh"]
        assert new_expiry > time.time() + SESSION_TTL_SECONDS - 1

    def test_multiple_sessions_are_tracked_independently(self):
        """Multiple sessions are stored independently."""
        record_heartbeat("s1")
        record_heartbeat("s2")
        record_heartbeat("s3")

        assert "s1" in _mem_sessions
        assert "s2" in _mem_sessions
        assert "s3" in _mem_sessions

    def teardown_method(self):
        clear_sessions()


# ─── TestGetListenerCount ─────────────────────────────────────────────────────

class TestGetListenerCount:
    def setup_method(self):
        clear_sessions()

    def test_returns_zero_when_no_sessions(self):
        """Returns 0 when _mem_sessions is empty."""
        count = get_listener_count()
        assert count == 0

    def test_returns_count_of_active_sessions(self):
        """Returns the number of non-expired sessions."""
        _mem_sessions["s1"] = time.time() + 100
        _mem_sessions["s2"] = time.time() + 100
        _mem_sessions["s3"] = time.time() + 100

        with patch("app.services.presence_service._get_client", return_value=None):
            count = get_listener_count()

        assert count == 3

    def test_prunes_expired_sessions(self):
        """Expired sessions are removed from _mem_sessions during get_listener_count."""
        _mem_sessions["active"] = time.time() + 100
        _mem_sessions["expired1"] = time.time() - 1
        _mem_sessions["expired2"] = time.time() - 5

        with patch("app.services.presence_service._get_client", return_value=None):
            count = get_listener_count()

        assert count == 1
        assert "active" in _mem_sessions
        assert "expired1" not in _mem_sessions
        assert "expired2" not in _mem_sessions

    def test_returns_int(self):
        """Return value is always an int."""
        with patch("app.services.presence_service._get_client", return_value=None):
            count = get_listener_count()
        assert isinstance(count, int)

    def test_writes_last_known_to_redis_when_count_positive(self):
        """When count > 0 and write interval has elapsed, writes to Redis."""
        _mem_sessions["s1"] = time.time() + 100
        ps._last_known_write = 0.0  # force write

        mock_redis = make_mock_redis()
        with patch("app.services.presence_service._get_client", return_value=mock_redis):
            count = get_listener_count()

        assert count == 1
        mock_redis.set.assert_called_once_with(LAST_KNOWN_KEY, 1, ex=3600)

    def test_does_not_write_to_redis_when_count_zero(self):
        """When count == 0, does not write to Redis."""
        ps._last_known_write = 0.0

        mock_redis = make_mock_redis()
        with patch("app.services.presence_service._get_client", return_value=mock_redis):
            get_listener_count()

        mock_redis.set.assert_not_called()

    def test_does_not_write_to_redis_before_interval_elapses(self):
        """Does not write to Redis if the write interval has not elapsed."""
        _mem_sessions["s1"] = time.time() + 100
        ps._last_known_write = time.time()  # just wrote

        mock_redis = make_mock_redis()
        with patch("app.services.presence_service._get_client", return_value=mock_redis):
            get_listener_count()

        mock_redis.set.assert_not_called()

    def teardown_method(self):
        clear_sessions()


# ─── TestRemoveSession ────────────────────────────────────────────────────────

class TestRemoveSession:
    def setup_method(self):
        clear_sessions()

    def test_removes_existing_session(self):
        """remove_session removes the session from _mem_sessions."""
        _mem_sessions["session-to-remove"] = time.time() + 100
        remove_session("session-to-remove")
        assert "session-to-remove" not in _mem_sessions

    def test_nonexistent_session_does_not_raise(self):
        """Removing a session that doesn't exist is a no-op (no exception)."""
        remove_session("session-nonexistent")  # should not raise

    def test_only_removes_target_session(self):
        """Only the specified session is removed; others remain."""
        _mem_sessions["keep"] = time.time() + 100
        _mem_sessions["remove"] = time.time() + 100

        remove_session("remove")

        assert "keep" in _mem_sessions
        assert "remove" not in _mem_sessions

    def teardown_method(self):
        clear_sessions()


# ─── TestGetLastKnownCount ────────────────────────────────────────────────────

class TestGetLastKnownCount:
    def test_returns_value_from_redis(self):
        """Returns the integer value stored in Redis under LAST_KNOWN_KEY."""
        mock_redis = make_mock_redis()
        mock_redis.get.return_value = "42"

        with patch("app.services.presence_service._get_client", return_value=mock_redis):
            count = get_last_known_count()

        assert count == 42
        mock_redis.get.assert_called_once_with(LAST_KNOWN_KEY)

    def test_returns_zero_when_key_missing(self):
        """Returns 0 when the Redis key does not exist."""
        mock_redis = make_mock_redis()
        mock_redis.get.return_value = None

        with patch("app.services.presence_service._get_client", return_value=mock_redis):
            count = get_last_known_count()

        assert count == 0

    def test_returns_zero_when_redis_unavailable(self):
        """Returns 0 when _get_client returns None (Redis unavailable)."""
        with patch("app.services.presence_service._get_client", return_value=None):
            count = get_last_known_count()

        assert count == 0

    def test_returns_zero_on_redis_exception(self):
        """Returns 0 when Redis raises an exception."""
        mock_redis = make_mock_redis()
        mock_redis.get.side_effect = Exception("Redis timeout")

        with patch("app.services.presence_service._get_client", return_value=mock_redis):
            count = get_last_known_count()

        assert count == 0

    def test_returns_int(self):
        """Return value is always an int."""
        mock_redis = make_mock_redis()
        mock_redis.get.return_value = "7"

        with patch("app.services.presence_service._get_client", return_value=mock_redis):
            count = get_last_known_count()

        assert isinstance(count, int)