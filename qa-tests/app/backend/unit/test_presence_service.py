"""
Unit tests for app.services.presence_service.
Uses unittest.mock to isolate the service from a real Redis connection.
"""
from unittest.mock import MagicMock, patch

import pytest

from app.services.presence_service import (
    PRESENCE_KEY_PREFIX,
    record_heartbeat,
    get_listener_count,
)


def make_mock_redis() -> MagicMock:
    """Return a MagicMock that mimics a redis.Redis client."""
    return MagicMock()


# ─── record_heartbeat ─────────────────────────────────────────────────────────

class TestRecordHeartbeat:
    def test_calls_setex_with_correct_key(self):
        mock_client = make_mock_redis()
        with patch("app.services.presence_service.get_redis_client", return_value=mock_client):
            record_heartbeat("session-abc-123")

        expected_key = f"{PRESENCE_KEY_PREFIX}session-abc-123"
        mock_client.setex.assert_called_once()
        args = mock_client.setex.call_args[0]
        assert args[0] == expected_key

    def test_calls_setex_with_value_1(self):
        mock_client = make_mock_redis()
        with patch("app.services.presence_service.get_redis_client", return_value=mock_client):
            record_heartbeat("session-xyz")

        args = mock_client.setex.call_args[0]
        assert args[2] == "1"

    def test_calls_setex_with_ttl_from_settings(self):
        from app.core.config import settings
        mock_client = make_mock_redis()
        with patch("app.services.presence_service.get_redis_client", return_value=mock_client):
            record_heartbeat("session-xyz")

        args = mock_client.setex.call_args[0]
        assert args[1] == settings.PRESENCE_TTL_SECONDS

    def test_different_session_ids_produce_different_keys(self):
        mock_client = make_mock_redis()
        with patch("app.services.presence_service.get_redis_client", return_value=mock_client):
            record_heartbeat("session-A")
            record_heartbeat("session-B")

        calls = mock_client.setex.call_args_list
        key_a = calls[0][0][0]
        key_b = calls[1][0][0]
        assert key_a != key_b
        assert "session-A" in key_a
        assert "session-B" in key_b


# ─── get_listener_count ───────────────────────────────────────────────────────

class TestGetListenerCount:
    def test_returns_zero_when_no_sessions(self):
        mock_client = make_mock_redis()
        mock_client.scan.return_value = (0, [])

        with patch("app.services.presence_service.get_redis_client", return_value=mock_client):
            count = get_listener_count()

        assert count == 0

    def test_counts_single_page_of_keys(self):
        mock_client = make_mock_redis()
        mock_client.scan.return_value = (0, [
            f"{PRESENCE_KEY_PREFIX}session-1",
            f"{PRESENCE_KEY_PREFIX}session-2",
            f"{PRESENCE_KEY_PREFIX}session-3",
        ])

        with patch("app.services.presence_service.get_redis_client", return_value=mock_client):
            count = get_listener_count()

        assert count == 3

    def test_counts_across_multiple_scan_pages(self):
        """Simulates Redis SCAN returning results across two pages (cursor != 0 first)."""
        mock_client = make_mock_redis()
        mock_client.scan.side_effect = [
            (42, [f"{PRESENCE_KEY_PREFIX}s1", f"{PRESENCE_KEY_PREFIX}s2"]),
            (0,  [f"{PRESENCE_KEY_PREFIX}s3", f"{PRESENCE_KEY_PREFIX}s4", f"{PRESENCE_KEY_PREFIX}s5"]),
        ]

        with patch("app.services.presence_service.get_redis_client", return_value=mock_client):
            count = get_listener_count()

        assert count == 5
        assert mock_client.scan.call_count == 2

    def test_scan_uses_correct_pattern(self):
        mock_client = make_mock_redis()
        mock_client.scan.return_value = (0, [])

        with patch("app.services.presence_service.get_redis_client", return_value=mock_client):
            get_listener_count()

        call_kwargs = mock_client.scan.call_args[1]
        assert call_kwargs["match"] == f"{PRESENCE_KEY_PREFIX}*"

    def test_scan_uses_count_100(self):
        mock_client = make_mock_redis()
        mock_client.scan.return_value = (0, [])

        with patch("app.services.presence_service.get_redis_client", return_value=mock_client):
            get_listener_count()

        call_kwargs = mock_client.scan.call_args[1]
        assert call_kwargs["count"] == 100

    def test_scan_starts_with_cursor_zero(self):
        mock_client = make_mock_redis()
        mock_client.scan.return_value = (0, [])

        with patch("app.services.presence_service.get_redis_client", return_value=mock_client):
            get_listener_count()

        call_kwargs = mock_client.scan.call_args[1]
        assert call_kwargs["cursor"] == 0