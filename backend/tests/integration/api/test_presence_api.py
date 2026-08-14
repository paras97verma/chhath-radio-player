"""
Integration tests for the presence API endpoints.

  POST /api/presence/heartbeat  — record a listener heartbeat
  GET  /api/presence/listeners  — get current listener count
"""
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


# ─── TestHeartbeatEndpoint ────────────────────────────────────────────────────

class TestHeartbeatEndpoint:
    def test_valid_session_id_returns_204(self, client):
        """POST /api/presence/heartbeat with valid UUID session_id returns 204 No Content."""
        with patch("app.services.presence_service._get_client", return_value=None):
            resp = client.post(
                "/api/presence/heartbeat",
                json={"session_id": "550e8400-e29b-41d4-a716-446655440000"},
            )
        assert resp.status_code == 204

    def test_invalid_session_id_format_returns_422(self, client):
        """POST with non-UUID session_id returns 422 Unprocessable Entity."""
        resp = client.post(
            "/api/presence/heartbeat",
            json={"session_id": "not-a-valid-uuid"},
        )
        assert resp.status_code == 422

    def test_missing_session_id_returns_422(self, client):
        """POST without session_id returns 422 Unprocessable Entity."""
        resp = client.post("/api/presence/heartbeat", json={})
        assert resp.status_code == 422

    def test_empty_body_returns_422(self, client):
        """POST with empty body returns 422."""
        resp = client.post("/api/presence/heartbeat")
        assert resp.status_code == 422


# ─── TestListenersEndpoint ────────────────────────────────────────────────────

class TestListenersEndpoint:
    def test_returns_200_with_count(self, client):
        """GET /api/presence/listeners returns 200 with {"count": <int>}."""
        with patch("app.services.presence_service._get_client", return_value=None):
            resp = client.get("/api/presence/listeners")

        assert resp.status_code == 200
        data = resp.json()
        assert "count" in data
        assert isinstance(data["count"], int)

    def test_count_is_non_negative(self, client):
        """Listener count is always >= 0."""
        with patch("app.services.presence_service._get_client", return_value=None):
            resp = client.get("/api/presence/listeners")

        assert resp.json()["count"] >= 0