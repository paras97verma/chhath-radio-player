"""
Integration test for the health endpoint.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        """GET /api/health returns HTTP 200."""
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_health_returns_status_ok(self, client):
        """Response body contains {"status": "ok"}."""
        resp = client.get("/api/health")
        data = resp.json()
        assert data.get("status") == "ok"

    def test_health_returns_service_name(self, client):
        """Response body contains the service name."""
        resp = client.get("/api/health")
        data = resp.json()
        assert "service" in data
        assert data["service"] == "chhath-radio-api"