"""
Integration tests for the public songs and radio queue API.
Verifies that the queue returns songs in the correct sort_order
and that disabled songs are excluded.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.song import Song


def make_song(db: Session, title: str, sort_order: int, enabled: bool = True) -> Song:
    """Helper to create a song directly in the test database."""
    song = Song(
        title=title,
        artist="Test Artist",
        youtube_video_id="dQw4w9WgXcQ",
        youtube_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        sort_order=sort_order,
        enabled=enabled,
    )
    db.add(song)
    db.commit()
    db.refresh(song)
    return song


class TestPublicSongsAPI:
    def test_get_songs_returns_only_enabled(self, client: TestClient, db: Session):
        """GET /api/songs returns only enabled songs."""
        make_song(db, "Enabled Song", sort_order=1, enabled=True)
        make_song(db, "Disabled Song", sort_order=2, enabled=False)

        response = client.get("/api/songs")
        assert response.status_code == 200
        songs = response.json()
        assert len(songs) == 1
        assert songs[0]["title"] == "Enabled Song"

    def test_get_songs_returns_correct_sort_order(self, client: TestClient, db: Session):
        """GET /api/songs returns songs ordered by sort_order ascending."""
        make_song(db, "Third Song", sort_order=3)
        make_song(db, "First Song", sort_order=1)
        make_song(db, "Second Song", sort_order=2)

        response = client.get("/api/songs")
        assert response.status_code == 200
        songs = response.json()
        assert len(songs) == 3
        assert songs[0]["title"] == "First Song"
        assert songs[1]["title"] == "Second Song"
        assert songs[2]["title"] == "Third Song"

    def test_get_songs_empty_when_no_songs(self, client: TestClient):
        """GET /api/songs returns empty list when no songs exist."""
        response = client.get("/api/songs")
        assert response.status_code == 200
        assert response.json() == []


class TestRadioQueueAPI:
    def test_radio_queue_returns_enabled_songs_in_order(self, client: TestClient, db: Session):
        """GET /api/radio/queue returns enabled songs in sort_order."""
        make_song(db, "Song B", sort_order=2)
        make_song(db, "Song A", sort_order=1)
        make_song(db, "Song C Disabled", sort_order=3, enabled=False)

        response = client.get("/api/radio/queue")
        assert response.status_code == 200
        queue = response.json()
        assert len(queue) == 2
        assert queue[0]["title"] == "Song A"
        assert queue[1]["title"] == "Song B"

    def test_radio_queue_song_has_youtube_video_id(self, client: TestClient, db: Session):
        """Each song in the queue must have a youtube_video_id field."""
        make_song(db, "Chhath Song", sort_order=1)
        response = client.get("/api/radio/queue")
        assert response.status_code == 200
        queue = response.json()
        assert len(queue) == 1
        assert "youtube_video_id" in queue[0]
        assert queue[0]["youtube_video_id"] == "dQw4w9WgXcQ"


class TestAdminSongCRUD:
    def test_create_song_extracts_video_id_from_url(
        self, client: TestClient, auth_headers: dict
    ):
        """POST /api/admin/songs parses the YouTube URL and stores the 11-char video ID."""
        response = client.post(
            "/api/admin/songs",
            json={
                "title": "Kaanch Hi Baans",
                "artist": "Sharda Sinha",
                "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "sort_order": 1,
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["youtube_video_id"] == "dQw4w9WgXcQ"
        assert data["title"] == "Kaanch Hi Baans"
        assert data["enabled"] is True

    def test_patch_song_can_disable_it(self, client: TestClient, auth_headers: dict, db: Session):
        """PATCH /api/admin/songs/{id} can set enabled=False."""
        song = make_song(db, "Active Song", sort_order=1, enabled=True)

        response = client.patch(
            f"/api/admin/songs/{song.id}",
            json={"enabled": False},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["enabled"] is False

        # Verify it no longer appears in the public queue
        queue_response = client.get("/api/radio/queue")
        assert queue_response.status_code == 200
        assert len(queue_response.json()) == 0

    def test_delete_song_removes_it(self, client: TestClient, auth_headers: dict, db: Session):
        """DELETE /api/admin/songs/{id} permanently removes the song."""
        song = make_song(db, "Song To Delete", sort_order=1)

        response = client.delete(f"/api/admin/songs/{song.id}", headers=auth_headers)
        assert response.status_code == 204

        # Verify it's gone from the public API
        songs_response = client.get("/api/songs")
        assert songs_response.json() == []