"""
Integration tests for the Admin authentication API.
Verifies that protected endpoints reject unauthenticated requests (401)
and that valid credentials return a JWT token.
"""
import pytest
from fastapi.testclient import TestClient


class TestAdminLogin:
    def test_login_with_valid_credentials_returns_token(self, client: TestClient, admin_user):
        """POST /api/admin/login with correct credentials returns a JWT."""
        response = client.post(
            "/api/admin/login",
            json={"email": "admin@test.com", "password": "testpassword123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert len(data["access_token"]) > 10

    def test_login_with_wrong_password_returns_401(self, client: TestClient, admin_user):
        """POST /api/admin/login with wrong password returns 401."""
        response = client.post(
            "/api/admin/login",
            json={"email": "admin@test.com", "password": "wrongpassword"},
        )
        assert response.status_code == 401

    def test_login_with_unknown_email_returns_401(self, client: TestClient):
        """POST /api/admin/login with unknown email returns 401."""
        response = client.post(
            "/api/admin/login",
            json={"email": "nobody@test.com", "password": "anything"},
        )
        assert response.status_code == 401


class TestAdminSongsProtection:
    def test_list_songs_without_token_returns_401(self, client: TestClient):
        """GET /api/admin/songs without a token returns 401."""
        response = client.get("/api/admin/songs")
        assert response.status_code == 401

    def test_create_song_without_token_returns_401(self, client: TestClient):
        """POST /api/admin/songs without a token returns 401."""
        response = client.post(
            "/api/admin/songs",
            json={
                "title": "Test Song",
                "artist": "Test Artist",
                "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            },
        )
        assert response.status_code == 401

    def test_delete_song_without_token_returns_401(self, client: TestClient):
        """DELETE /api/admin/songs/{id} without a token returns 401."""
        response = client.delete("/api/admin/songs/00000000-0000-0000-0000-000000000000")
        assert response.status_code == 401

    def test_list_songs_with_valid_token_returns_200(self, client: TestClient, auth_headers):
        """GET /api/admin/songs with a valid token returns 200."""
        response = client.get("/api/admin/songs", headers=auth_headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)