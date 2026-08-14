"""
Unit tests for app.services.presence_service.

The current service uses:
  - COUNTER_KEY  = "chhath:listeners:count"   (integer counter)
  - SESSIONS_KEY = "chhath:listeners:sessions" (sorted set: session_id → expiry timestamp)
  - zadd(SESSIONS_KEY, {session_id: expiry}, nx=True) → 1 for new, 0 for existing
  - zcount(SESSIONS_KEY, now, "+inf")          → get_listener_count()
  - zrem(SESSIONS_KEY, session_id)             → remove_session()
  - zremrangebyscore(SESSIONS_KEY, "-inf", now) → _prune_expired()

All Redis calls are mocked via unittest.mock.patch so no real Redis is needed.
"""
import time
from unittest.mock import MagicMock, patch, call

import pytest

import app.services.presence_service as ps
from app.services.presence_service import (
    COUNTER_KEY,
    SESSIONS_KEY,
    SESSION_TTL_SECONDS,
    record_heartbeat,
    get_listener_count,
    remove_session,
    _prune_expired,
    _mem_heartbeat,
    _mem_count,
    _mem_sessions,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def make_mock_redis() -> MagicMock:
    """Return a MagicMock that mimics a redis.Redis client."""
    mock = MagicMock()
    mock.zadd.return_value = 1   # default: new session
    mock.zcount.return_value = 0
    mock.zrem.return_value = 1
    mock.decr.return_value = 0
    mock.decrby.return_value = 0
    mock.zremrangebyscore.return_value = 0
    return mock


# ─── TestRecordHeartbeat ──────────────────────────────────────────────────────

class TestRecordHeartbeat:
    def test_new_session_calls_zadd_nx_and_incr(self):
        """New session: zadd(nx=True) returns 1 → incr is called."""
        mock_client = make_mock_redis()
        mock_client.zadd.return_value = 1  # new session

        with patch("app.services.presence_service._get_client", return_value=mock_client):
            record_heartbeat("session-new-123")

        mock_client.zadd.assert_called_once_with(
            SESSIONS_KEY, {"session-new-123": pytest.approx(time.time() + SESSION_TTL_SECONDS, abs=2)}, nx=True
        )
        mock_client.incr.assert_called_once_with(COUNTER_KEY)

    def test_existing_session_refreshes_score_without_incr(self):
        """Existing session: zadd(nx=True) returns 0 → incr NOT called, score refreshed."""
        mock_client = make_mock_redis()
        mock_client.zadd.side_effect = [0, None]  # first call (nx=True) → 0, second (refresh) → None

        with patch("app.services.presence_service._get_client", return_value=mock_client):
            record_heartbeat("session-existing")

        mock_client.incr.assert_not_called()
        # Second zadd call (without nx) refreshes the score
        assert mock_client.zadd.call_count == 2
        second_call_kwargs = mock_client.zadd.call_args_list[1]
        assert "nx" not in second_call_kwargs.kwargs

    def test_redis_error_falls_back_to_mem_heartbeat(self):
        """On RedisError, session is added to _mem_sessions."""
        from redis.exceptions import RedisError

        mock_client = make_mock_redis()
        mock_client.zadd.side_effect = RedisError("connection refused")

        _mem_sessions.clear()
        with patch("app.services.presence_service._get_client", return_value=mock_client):
            record_heartbeat("session-fallback")

        assert "session-fallback" in _mem_sessions
        assert _mem_sessions["session-fallback"] > time.time()
        _mem_sessions.clear()

    def test_redis_unavailable_uses_mem_heartbeat(self):
        """When _get_client returns None, falls back to _mem_heartbeat."""
        _mem_sessions.clear()
        with patch("app.services.presence_service._get_client", return_value=None):
            record_heartbeat("session-no-redis")

        assert "session-no-redis" in _mem_sessions
        _mem_sessions.clear()

    def test_zadd_score_is_future_expiry(self):
        """The score passed to zadd should be approximately now + SESSION_TTL_SECONDS."""
        mock_client = make_mock_redis()
        mock_client.zadd.return_value = 1

        before = time.time()
        with patch("app.services.presence_service._get_client", return_value=mock_client):
            record_heartbeat("session-score-check")
        after = time.time()

        call_args = mock_client.zadd.call_args
        score = call_args[0][1]["session-score-check"]
        assert before + SESSION_TTL_SECONDS <= score <= after + SESSION_TTL_SECONDS


# ─── TestGetListenerCount ─────────────────────────────────────────────────────

class TestGetListenerCount:
    def test_redis_available_calls_zcount(self):
        """When Redis is available, calls zcount(SESSIONS_KEY, now, '+inf')."""
        mock_client = make_mock_redis()
        mock_client.zcount.return_value = 7

        with patch("app.services.presence_service._get_client", return_value=mock_client):
            count = get_listener_count()

        assert count == 7
        mock_client.zcount.assert_called_once()
        call_args = mock_client.zcount.call_args[0]
        assert call_args[0] == SESSIONS_KEY
        assert call_args[2] == "+inf"
        # The min score should be approximately now
        assert call_args[1] == pytest.approx(time.time(), abs=2)

    def test_redis_unavailable_falls_back_to_mem_count(self):
        """When _get_client returns None, falls back to _mem_count."""
        _mem_sessions.clear()
        _mem_sessions["s1"] = time.time() + 100
        _mem_sessions["s2"] = time.time() + 100

        with patch("app.services.presence_service._get_client", return_value=None):
            count = get_listener_count()

        assert count == 2
        _mem_sessions.clear()

    def test_redis_error_falls_back_to_mem_count(self):
        """On RedisError, falls back to _mem_count."""
        from redis.exceptions import RedisError

        mock_client = make_mock_redis()
        mock_client.zcount.side_effect = RedisError("timeout")

        _mem_sessions.clear()
        _mem_sessions["s1"] = time.time() + 100

        with patch("app.services.presence_service._get_client", return_value=mock_client):
            count = get_listener_count()

        assert count == 1
        _mem_sessions.clear()

    def test_returns_int(self):
        """Return value is always an int."""
        mock_client = make_mock_redis()
        mock_client.zcount.return_value = 3

        with patch("app.services.presence_service._get_client", return_value=mock_client):
            count = get_listener_count()

        assert isinstance(count, int)


# ─── TestRemoveSession ────────────────────────────────────────────────────────

class TestRemoveSession:
    def test_session_exists_calls_zrem_and_decr(self):
        """zrem returns 1 → decr is called."""
        mock_client = make_mock_redis()
        mock_client.zrem.return_value = 1
        mock_client.decr.return_value = 2

        with patch("app.services.presence_service._get_client", return_value=mock_client):
            remove_session("session-to-remove")

        mock_client.zrem.assert_called_once_with(SESSIONS_KEY, "session-to-remove")
        mock_client.decr.assert_called_once_with(COUNTER_KEY)

    def test_counter_clamped_to_zero_when_negative(self):
        """If decr returns negative, set(COUNTER_KEY, 0) is called."""
        mock_client = make_mock_redis()
        mock_client.zrem.return_value = 1
        mock_client.decr.return_value = -1

        with patch("app.services.presence_service._get_client", return_value=mock_client):
            remove_session("session-negative")

        mock_client.set.assert_called_once_with(COUNTER_KEY, 0)

    def test_session_not_found_skips_decr(self):
        """zrem returns 0 → decr NOT called."""
        mock_client = make_mock_redis()
        mock_client.zrem.return_value = 0

        with patch("app.services.presence_service._get_client", return_value=mock_client):
            remove_session("session-missing")

        mock_client.decr.assert_not_called()

    def test_redis_unavailable_pops_from_mem_sessions(self):
        """When _get_client returns None, pops from _mem_sessions."""
        _mem_sessions.clear()
        _mem_sessions["session-mem"] = time.time() + 100

        with patch("app.services.presence_service._get_client", return_value=None):
            remove_session("session-mem")

        assert "session-mem" not in _mem_sessions
        _mem_sessions.clear()

    def test_redis_unavailable_missing_session_no_error(self):
        """Removing a non-existent session from memory doesn't raise."""
        _mem_sessions.clear()
        with patch("app.services.presence_service._get_client", return_value=None):
            remove_session("session-nonexistent")  # should not raise


# ─── TestPruneExpired ─────────────────────────────────────────────────────────

class TestPruneExpired:
    def test_removes_expired_sessions_and_decrements_counter(self):
        """zremrangebyscore returns N → decrby(COUNTER_KEY, N) called."""
        mock_client = make_mock_redis()
        mock_client.zremrangebyscore.return_value = 3
        mock_client.decrby.return_value = 5

        _prune_expired(mock_client)

        mock_client.zremrangebyscore.assert_called_once()
        call_args = mock_client.zremrangebyscore.call_args[0]
        assert call_args[0] == SESSIONS_KEY
        assert call_args[1] == "-inf"
        # cutoff should be approximately now
        assert call_args[2] == pytest.approx(time.time(), abs=2)
        mock_client.decrby.assert_called_once_with(COUNTER_KEY, 3)

    def test_counter_clamped_to_zero_when_negative_after_prune(self):
        """If decrby returns negative, set(COUNTER_KEY, 0) is called."""
        mock_client = make_mock_redis()
        mock_client.zremrangebyscore.return_value = 10
        mock_client.decrby.return_value = -2

        _prune_expired(mock_client)

        mock_client.set.assert_called_once_with(COUNTER_KEY, 0)

    def test_no_expired_sessions_skips_decrby(self):
        """If zremrangebyscore returns 0, decrby is not called."""
        mock_client = make_mock_redis()
        mock_client.zremrangebyscore.return_value = 0

        _prune_expired(mock_client)

        mock_client.decrby.assert_not_called()


# ─── TestMemoryFallback ───────────────────────────────────────────────────────

class TestMemoryFallback:
    def test_mem_heartbeat_sets_correct_expiry(self):
        """_mem_heartbeat sets expiry to approximately now + SESSION_TTL_SECONDS."""
        _mem_sessions.clear()
        before = time.time()
        _mem_heartbeat("session-mem-ttl")
        after = time.time()

        expiry = _mem_sessions.get("session-mem-ttl")
        assert expiry is not None
        assert before + SESSION_TTL_SECONDS <= expiry <= after + SESSION_TTL_SECONDS
        _mem_sessions.clear()

    def test_mem_count_prunes_expired_sessions(self):
        """_mem_count removes sessions whose expiry has passed."""
        _mem_sessions.clear()
        _mem_sessions["active"] = time.time() + 100
        _mem_sessions["expired"] = time.time() - 1  # already expired

        count = _mem_count()

        assert count == 1
        assert "active" in _mem_sessions
        assert "expired" not in _mem_sessions
        _mem_sessions.clear()

    def test_mem_count_returns_zero_when_all_expired(self):
        """_mem_count returns 0 when all sessions are expired."""
        _mem_sessions.clear()
        _mem_sessions["s1"] = time.time() - 10
        _mem_sessions["s2"] = time.time() - 5

        count = _mem_count()

        assert count == 0
        _mem_sessions.clear()

    def test_mem_count_returns_zero_when_empty(self):
        """_mem_count returns 0 when no sessions exist."""
        _mem_sessions.clear()
        assert _mem_count() == 0