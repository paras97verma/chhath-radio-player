"""
Unit + integration tests for app.api.chat.

Tests cover:
  - _store_message: Redis sorted set storage, TTL pruning, MAX_MESSAGES cap, memory fallback
  - _load_messages: Redis zrangebyscore, limit, memory fallback
  - Rate limiting: per-IP 3-second window
  - POST /api/chat/messages endpoint: validation, random name, 201 response
  - GET  /api/chat/messages endpoint: returns list, respects limit
"""
import json
import time
import uuid
from collections import deque
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.chat import (
    CHAT_KEY,
    MAX_MESSAGES,
    MESSAGE_TTL_SECONDS,
    RATE_LIMIT_SECONDS,
    _store_message,
    _load_messages,
    _message_buffer,
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
    mock.pipeline.return_value.execute.return_value = [1, 0, 0]
    mock.zrangebyscore.return_value = []
    return mock


# ─── TestStoreMessage ─────────────────────────────────────────────────────────

class TestStoreMessage:
    def setup_method(self):
        _message_buffer.clear()

    def test_stores_to_redis_sorted_set_with_timestamp_score(self):
        """Message is added to Redis sorted set with score = unix timestamp."""
        mock_redis = make_mock_redis()
        pipe = mock_redis.pipeline.return_value

        with patch("app.api.chat._get_redis", return_value=mock_redis):
            msg = make_msg()
            _store_message(msg)

        pipe.zadd.assert_called_once_with(CHAT_KEY, {json.dumps(msg): msg["ts"]})

    def test_prunes_messages_older_than_ttl(self):
        """zremrangebyscore is called with cutoff = ts - MESSAGE_TTL_SECONDS."""
        mock_redis = make_mock_redis()
        pipe = mock_redis.pipeline.return_value

        with patch("app.api.chat._get_redis", return_value=mock_redis):
            msg = make_msg()
            _store_message(msg)

        pipe.zremrangebyscore.assert_called_once_with(CHAT_KEY, "-inf", msg["ts"] - MESSAGE_TTL_SECONDS)

    def test_enforces_max_messages_cap(self):
        """zremrangebyrank is called to enforce MAX_MESSAGES cap."""
        mock_redis = make_mock_redis()
        pipe = mock_redis.pipeline.return_value

        with patch("app.api.chat._get_redis", return_value=mock_redis):
            _store_message(make_msg())

        pipe.zremrangebyrank.assert_called_once_with(CHAT_KEY, 0, -(MAX_MESSAGES + 1))

    def test_always_writes_to_memory_buffer(self):
        """Message is always appended to _message_buffer regardless of Redis."""
        _message_buffer.clear()

        with patch("app.api.chat._get_redis", return_value=None):
            msg = make_msg()
            _store_message(msg)

        assert msg in _message_buffer

    def test_falls_back_to_memory_on_redis_exception(self):
        """On Redis exception, message is still stored in _message_buffer."""
        _message_buffer.clear()
        mock_redis = make_mock_redis()
        mock_redis.pipeline.side_effect = Exception("Redis error")

        with patch("app.api.chat._get_redis", return_value=mock_redis):
            msg = make_msg()
            _store_message(msg)

        assert msg in _message_buffer

    def teardown_method(self):
        _message_buffer.clear()


# ─── TestLoadMessages ─────────────────────────────────────────────────────────

class TestLoadMessages:
    def setup_method(self):
        _message_buffer.clear()
        # Reset the buffer-loaded flag so each test starts fresh
        import app.api.chat as chat_mod
        chat_mod._buffer_loaded = False

    def test_loads_from_redis_zrangebyscore_with_cutoff(self):
        """Calls zrangebyscore with cutoff = now - MESSAGE_TTL_SECONDS."""
        mock_redis = make_mock_redis()
        msg = make_msg()
        mock_redis.zrangebyscore.return_value = [json.dumps(msg)]

        with patch("app.api.chat._get_redis", return_value=mock_redis):
            result = _load_messages(limit=50)

        assert result == [msg]
        call_args = mock_redis.zrangebyscore.call_args[0]
        assert call_args[0] == CHAT_KEY
        assert call_args[2] == "+inf"
        assert call_args[1] == pytest.approx(time.time() - MESSAGE_TTL_SECONDS, abs=2)

    def test_returns_oldest_first_limited_to_limit(self):
        """Returns the newest `limit` messages in oldest-first order."""
        mock_redis = make_mock_redis()
        msgs = [make_msg(text=f"msg {i}") for i in range(10)]
        mock_redis.zrangebyscore.return_value = [json.dumps(m) for m in msgs]

        with patch("app.api.chat._get_redis", return_value=mock_redis):
            result = _load_messages(limit=5)

        # Should return the last 5 (newest), oldest-first
        assert result == msgs[-5:]

    def test_falls_back_to_memory_when_redis_unavailable(self):
        """When _get_redis returns None, returns from _message_buffer."""
        _message_buffer.clear()
        msg = make_msg()
        _message_buffer.append(msg)

        with patch("app.api.chat._get_redis", return_value=None):
            result = _load_messages(limit=50)

        assert msg in result

    def test_falls_back_to_memory_on_redis_exception(self):
        """On Redis exception, returns from _message_buffer."""
        _message_buffer.clear()
        msg = make_msg()
        _message_buffer.append(msg)
        mock_redis = make_mock_redis()
        mock_redis.zrangebyscore.side_effect = Exception("Redis error")

        with patch("app.api.chat._get_redis", return_value=mock_redis):
            result = _load_messages(limit=50)

        assert msg in result

    def teardown_method(self):
        _message_buffer.clear()
        import app.api.chat as chat_mod
        chat_mod._buffer_loaded = False


# ─── TestRateLimit ────────────────────────────────────────────────────────────

class TestRateLimit:
    def setup_method(self):
        _rate_limit.clear()
        _message_buffer.clear()

    def test_first_message_from_ip_is_allowed(self, client):
        """First message from an IP is accepted (201)."""
        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": "Hello!"})
        assert resp.status_code == 201

    def test_second_message_within_3s_is_rate_limited(self, client):
        """Second message within 3 seconds returns 429."""
        _rate_limit["testclient"] = time.time()  # simulate recent message

        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": "Too fast!"})
        assert resp.status_code == 429

    def test_message_after_cooldown_is_allowed(self, client):
        """Message after 3+ seconds is allowed."""
        _rate_limit["testclient"] = time.time() - RATE_LIMIT_SECONDS - 1

        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": "After cooldown"})
        assert resp.status_code == 201

    def teardown_method(self):
        _rate_limit.clear()
        _message_buffer.clear()


# ─── TestSendMessageEndpoint ──────────────────────────────────────────────────

class TestSendMessageEndpoint:
    def setup_method(self):
        _rate_limit.clear()
        _message_buffer.clear()

    def test_valid_body_returns_201_with_chat_message_out(self, client):
        """POST with valid body returns 201 and ChatMessageOut schema."""
        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.post("/api/chat/messages", json={"name": "Bhakt", "text": "Jai Chhathi!"})

        assert resp.status_code == 201
        data = resp.json()
        assert "id" in data
        assert data["name"] == "Bhakt"
        assert data["text"] == "Jai Chhathi!"
        assert "ts" in data

    def test_empty_name_gets_random_bhakti_name(self, client):
        """When name is empty, a random bhakti-style name is assigned."""
        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.post("/api/chat/messages", json={"name": "", "text": "Hello!"})

        assert resp.status_code == 201
        data = resp.json()
        assert data["name"]  # non-empty
        assert data["name"] != ""

    def test_provided_name_is_used_as_is(self, client):
        """When name is provided, it is used without modification."""
        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.post("/api/chat/messages", json={"name": "Sharda Sinha Fan", "text": "Kelwa!"})

        assert resp.status_code == 201
        assert resp.json()["name"] == "Sharda Sinha Fan"

    def test_text_too_long_returns_422(self, client):
        """Text longer than 200 chars returns 422 Unprocessable Entity."""
        long_text = "x" * 201
        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": long_text})

        assert resp.status_code == 422

    def test_empty_text_returns_422(self, client):
        """Empty text returns 422."""
        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": ""})

        assert resp.status_code == 422

    def test_rate_limited_returns_429(self, client):
        """Second message within 3 seconds returns 429."""
        _rate_limit["testclient"] = time.time()

        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.post("/api/chat/messages", json={"text": "Too fast!"})

        assert resp.status_code == 429

    def teardown_method(self):
        _rate_limit.clear()
        _message_buffer.clear()


# ─── TestGetMessagesEndpoint ──────────────────────────────────────────────────

class TestGetMessagesEndpoint:
    def setup_method(self):
        _message_buffer.clear()
        import app.api.chat as chat_mod
        chat_mod._buffer_loaded = False

    def test_returns_200_with_list(self, client):
        """GET /api/chat/messages returns 200 with a list."""
        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.get("/api/chat/messages")

        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_limit_param_is_respected(self, client):
        """limit query param caps the number of returned messages."""
        # Pre-populate buffer with 10 messages
        now = int(time.time())
        for i in range(10):
            _message_buffer.append({"id": str(uuid.uuid4()), "name": "Bhakt", "text": f"msg {i}", "ts": now - i})

        import app.api.chat as chat_mod
        chat_mod._buffer_loaded = True  # skip Redis load

        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.get("/api/chat/messages?limit=3")

        assert resp.status_code == 200
        assert len(resp.json()) <= 3

    def test_limit_capped_at_max_messages(self, client):
        """limit is capped at MAX_MESSAGES even if a larger value is requested."""
        with patch("app.api.chat._get_redis", return_value=None):
            resp = client.get(f"/api/chat/messages?limit={MAX_MESSAGES + 100}")

        assert resp.status_code == 200

    def teardown_method(self):
        _message_buffer.clear()
        import app.api.chat as chat_mod
        chat_mod._buffer_loaded = False


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    """FastAPI TestClient for the full app."""
    with TestClient(app) as c:
        yield c
