"""
Unit + integration tests for app.api.chat.

Tests cover:
  - _store_message: Redis sorted set storage, MAX_MESSAGES cap, drops when Redis unavailable
  - _load_messages: Redis zrange, limit, returns [] when Redis unavailable
  - Rate limiting: per-IP 3-second window
  - POST /api/chat/messages endpoint: validation, random name, 201 response
  - GET  /api/chat/messages endpoint: returns list, respects limit
"""
import json
import time
import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.chat import (
    CHAT_KEY,
    MAX_MESSAGES,
    RATE_LIMIT_SECONDS,
    _store_message,
    _load_messages,
    _rate_limit,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def make_msg(text: str = "Jai Chhathi Maiya!", name: str = "Bhakt") -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "text": text,
        "ts": int(time.time()),
    }


def make_mock_redis() -> MagicMock:
    mock = MagicMock()
    mock.pipeline.return_value.__enter__ = MagicMock(return_value=mock.pipeline.return_value)
    mock.pipeline.return_value.__exit__ = MagicMock(return_value=False)
    mock.pipeline.return_value.execute.return_value = [1, 0]
    mock.zrange.return_value = []
    return mock


# ─── TestStoreMessage ─────────────────────────────────────────────────────────

class TestStoreMessage:
    def test_stores_to_redis_sorted_set_with_timestamp_score(self):
        """Message is added to Redis sorted set with score = unix timestamp."""
        mock_redis = make_mock_redis()
        pipe = mock_redis.pipeline.return_value

        with patch("app.api.chat.get_redis_client", return_value=mock_redis):
            msg = make_msg()
            _store_message(msg)

        pipe.zadd.assert_called_once_with(CHAT_KEY, {json.dumps(msg): float(msg["ts"])})

    def test_enforces_max_messages_cap(self):
        """zremrangebyrank is called to enforce MAX_MESSAGES cap."""
        mock_redis = make_mock_redis()
        pipe = mock_redis.pipeline.return_value

        with patch("app.api.chat.get_redis_client", return_value=mock_redis):
            _store_message(make_msg())

        pipe.zremrangebyrank.assert_called_once_with(CHAT_KEY, 0, -(MAX_MESSAGES + 1))

    def test_drops_message_when_redis_unavailable(self):
        """When get_redis_client returns None, message is dropped without error."""
        with patch("app.api.chat.get_redis_client", return_value=None):
            msg = make_msg()
            _store_message(msg)  # Should not raise

    def test_handles_redis_exception_gracefully(self):
        """On Redis exception, message is dropped and error logged without raising."""
        mock_redis = make_mock_redis()
        mock_redis.pipeline.side_effect = Exception("Redis error")

        with patch("app.api.chat.get_redis_client", return_value=mock_redis):
            msg = make_msg()
            _store_message(msg)  # Should not raise


# ─── TestLoadMessages ─────────────────────────────────────────────────────────

class TestLoadMessages:
    def test_loads_from_redis_zrange(self):
        """Calls zrange to fetch latest limit entries."""
        mock_redis = make_mock_redis()
        msg = make_msg()
        mock_redis.zrange.return_value = [json.dumps(msg)]

        with patch("app.api.chat.get_redis_client", return_value=mock_redis):
            result = _load_messages(limit=50)

        assert result == [msg]
        mock_redis.zrange.assert_called_once_with(CHAT_KEY, -50, -1)

    def test_returns_oldest_first_from_redis(self):
        """Returns messages as deserialized dict list from Redis."""
        mock_redis = make_mock_redis()
        msgs = [make_msg(text=f"msg {i}") for i in range(10)]
        mock_redis.zrange.return_value = [json.dumps(m) for m in msgs]

        with patch("app.api.chat.get_redis_client", return_value=mock_redis):
            result = _load_messages(limit=10)

        assert result == msgs

    def test_returns_empty_list_when_redis_unavailable(self):
        """When get_redis_client returns None, returns []."""
        with patch("app.api.chat.get_redis_client", return_value=None):
            result = _load_messages(limit=50)

        assert result == []

    def test_returns_empty_list_on_redis_exception(self):
        """On Redis exception, returns []."""
        mock_redis = make_mock_redis()
        mock_redis.zrange.side_effect = Exception("Redis error")

        with patch("app.api.chat.get_redis_client", return_value=mock_redis):
            result = _load_messages(limit=50)

        assert result == []


# ─── TestRateLimit ────────────────────────────────────────────────────────────

class TestRateLimit:
    def setup_method(self):
        _rate_limit.clear()

    def test_first_message_from_ip_is_allowed(self, client):
        """First message from an IP is accepted (201)."""
        with patch("app.api.chat.get_redis_client", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": "Hello!"})
        assert resp.status_code == 201

    def test_second_message_within_3s_is_rate_limited(self, client):
        """Second message within 3 seconds returns 429."""
        _rate_limit["testclient"] = time.time()

        with patch("app.api.chat.get_redis_client", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": "Too fast!"})
        assert resp.status_code == 429

    def test_message_after_cooldown_is_allowed(self, client):
        """Message after 3+ seconds is allowed."""
        _rate_limit["testclient"] = time.time() - RATE_LIMIT_SECONDS - 1

        with patch("app.api.chat.get_redis_client", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": "After cooldown"})
        assert resp.status_code == 201

    def teardown_method(self):
        _rate_limit.clear()


# ─── TestSendMessageEndpoint ──────────────────────────────────────────────────

class TestSendMessageEndpoint:
    def setup_method(self):
        _rate_limit.clear()

    def test_valid_body_returns_201_with_chat_message_out(self, client):
        """POST with valid body returns 201 and ChatMessageOut schema."""
        with patch("app.api.chat.get_redis_client", return_value=None):
            resp = client.post("/api/chat/messages", json={"name": "Bhakt", "text": "Jai Chhathi!"})

        assert resp.status_code == 201
        data = resp.json()
        assert "id" in data
        assert data["name"] == "Bhakt"
        assert data["text"] == "Jai Chhathi!"
        assert "ts" in data

    def test_empty_name_gets_random_bhakti_name(self, client):
        """When name is empty, a random bhakti-style name is assigned."""
        with patch("app.api.chat.get_redis_client", return_value=None):
            resp = client.post("/api/chat/messages", json={"name": "", "text": "Hello!"})

        assert resp.status_code == 201
        data = resp.json()
        assert data["name"]
        assert data["name"] != ""

    def test_provided_name_is_used_as_is(self, client):
        """When name is provided, it is used without modification."""
        with patch("app.api.chat.get_redis_client", return_value=None):
            resp = client.post("/api/chat/messages", json={"name": "Sharda Sinha Fan", "text": "Kelwa!"})

        assert resp.status_code == 201
        assert resp.json()["name"] == "Sharda Sinha Fan"

    def test_text_too_long_returns_422(self, client):
        """Text longer than 200 chars returns 422 Unprocessable Entity."""
        long_text = "x" * 201
        with patch("app.api.chat.get_redis_client", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": long_text})

        assert resp.status_code == 422

    def test_empty_text_returns_422(self, client):
        """Empty text returns 422."""
        with patch("app.api.chat.get_redis_client", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": ""})

        assert resp.status_code == 422

    def test_rate_limited_returns_429(self, client):
        """Second message within 3 seconds returns 429."""
        _rate_limit["testclient"] = time.time()

        with patch("app.api.chat.get_redis_client", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": "Too fast!"})

        assert resp.status_code == 429

    def teardown_method(self):
        _rate_limit.clear()


# ─── TestGetMessagesEndpoint ──────────────────────────────────────────────────

class TestGetMessagesEndpoint:
    def test_returns_200_with_list(self, client):
        """GET /api/chat/messages returns 200 with a list."""
        with patch("app.api.chat.get_redis_client", return_value=None):
            resp = client.get("/api/chat/messages")

        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_limit_param_is_respected(self, client):
        """limit query param passes to _load_messages."""
        mock_redis = make_mock_redis()
        msgs = [make_msg(text=f"msg {i}") for i in range(5)]
        mock_redis.zrange.return_value = [json.dumps(m) for m in msgs]

        with patch("app.api.chat.get_redis_client", return_value=mock_redis):
            resp = client.get("/api/chat/messages?limit=3")

        assert resp.status_code == 200
        mock_redis.zrange.assert_called_once_with(CHAT_KEY, -3, -1)

    def test_limit_capped_at_max_messages(self, client):
        """limit is capped at MAX_MESSAGES even if a larger value is requested."""
        mock_redis = make_mock_redis()

        with patch("app.api.chat.get_redis_client", return_value=mock_redis):
            resp = client.get(f"/api/chat/messages?limit={MAX_MESSAGES + 100}")

        assert resp.status_code == 200
        mock_redis.zrange.assert_called_once_with(CHAT_KEY, -MAX_MESSAGES, -1)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
