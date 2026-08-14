"""
Unit tests for app.services.song_service.SongService.
Uses unittest.mock to isolate the service from the database.
"""
import uuid
from unittest.mock import MagicMock, patch, call
import pytest

from app.models.song import Song
from app.schemas.song import SongCreate, SongUpdate
from app.services.song_service import SongService


# ─── Helpers ──────────────────────────────────────────────────────────────────

def make_song_model(
    title: str = "Test Song",
    artist: str = "Test Artist",
    youtube_video_id: str = "dQw4w9WgXcQ",
    youtube_url: str = "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    enabled: bool = True,
    sort_order: int = 0,
    category: str | None = None,
) -> Song:
    """Create an in-memory Song ORM object (not persisted)."""
    song = Song(
        title=title,
        artist=artist,
        youtube_video_id=youtube_video_id,
        youtube_url=youtube_url,
        enabled=enabled,
        sort_order=sort_order,
        category=category,
    )
    song.id = uuid.uuid4()
    return song


def make_mock_db() -> MagicMock:
    """Return a MagicMock that mimics a SQLAlchemy Session."""
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    return db


# ─── get_all_enabled ──────────────────────────────────────────────────────────

class TestGetAllEnabled:
    def test_returns_list_from_db(self):
        db = make_mock_db()
        songs = [make_song_model("Song A"), make_song_model("Song B")]
        db.scalars.return_value.all.return_value = songs

        result = SongService.get_all_enabled(db)

        assert result == songs
        db.scalars.assert_called_once()

    def test_returns_empty_list_when_no_songs(self):
        db = make_mock_db()
        db.scalars.return_value.all.return_value = []

        result = SongService.get_all_enabled(db)

        assert result == []


# ─── get_all ──────────────────────────────────────────────────────────────────

class TestGetAll:
    def test_returns_all_songs_including_disabled(self):
        db = make_mock_db()
        songs = [
            make_song_model("Enabled", enabled=True),
            make_song_model("Disabled", enabled=False),
        ]
        db.scalars.return_value.all.return_value = songs

        result = SongService.get_all(db)

        assert len(result) == 2
        db.scalars.assert_called_once()


# ─── get_by_id ────────────────────────────────────────────────────────────────

class TestGetById:
    def test_returns_song_when_found(self):
        db = make_mock_db()
        song = make_song_model()
        db.get.return_value = song

        result = SongService.get_by_id(db, song.id)

        assert result is song
        db.get.assert_called_once_with(Song, song.id)

    def test_returns_none_when_not_found(self):
        db = make_mock_db()
        db.get.return_value = None

        result = SongService.get_by_id(db, uuid.uuid4())

        assert result is None


# ─── create ───────────────────────────────────────────────────────────────────

class TestCreate:
    def _make_create_data(self, url: str = "https://www.youtube.com/watch?v=dQw4w9WgXcQ") -> SongCreate:
        return SongCreate(
            title="Kaanch Hi Baans",
            artist="Sharda Sinha",
            youtube_url=url,
            sort_order=1,
        )

    def test_create_adds_song_to_db(self):
        db = make_mock_db()
        data = self._make_create_data()

        # db.refresh should populate the song (simulate ORM refresh)
        def fake_refresh(song):
            song.id = uuid.uuid4()

        db.refresh.side_effect = fake_refresh

        result = SongService.create(db, data)

        db.add.assert_called_once()
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_create_extracts_video_id_from_url(self):
        db = make_mock_db()
        data = self._make_create_data("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

        added_song = None

        def capture_add(song):
            nonlocal added_song
            added_song = song

        db.add.side_effect = capture_add

        SongService.create(db, data)

        assert added_song is not None
        assert added_song.youtube_video_id == "dQw4w9WgXcQ"

    def test_create_sets_enabled_true_by_default(self):
        db = make_mock_db()
        data = self._make_create_data()

        added_song = None

        def capture_add(song):
            nonlocal added_song
            added_song = song

        db.add.side_effect = capture_add

        SongService.create(db, data)

        assert added_song.enabled is True

    def test_create_stores_original_url(self):
        db = make_mock_db()
        url = "https://youtu.be/dQw4w9WgXcQ"
        data = self._make_create_data(url)

        added_song = None

        def capture_add(song):
            nonlocal added_song
            added_song = song

        db.add.side_effect = capture_add

        SongService.create(db, data)

        assert added_song.youtube_url == url

    def test_create_raises_value_error_for_invalid_url(self):
        """SongService.create should raise ValueError if video ID cannot be extracted.

        Note: SongCreate's validator normally catches this first, but we test
        the service-layer guard by patching extract_youtube_video_id.
        """
        db = make_mock_db()
        data = self._make_create_data()

        with patch("app.services.song_service.extract_youtube_video_id", return_value=None):
            with pytest.raises(ValueError, match="Could not extract YouTube video ID"):
                SongService.create(db, data)

        db.add.assert_not_called()
        db.commit.assert_not_called()


# ─── update ───────────────────────────────────────────────────────────────────

class TestUpdate:
    def test_update_title_only(self):
        db = make_mock_db()
        song = make_song_model(title="Old Title")
        update_data = SongUpdate(title="New Title")

        SongService.update(db, song, update_data)

        assert song.title == "New Title"
        db.commit.assert_called_once()
        db.refresh.assert_called_once_with(song)

    def test_update_enabled_to_false(self):
        db = make_mock_db()
        song = make_song_model(enabled=True)
        update_data = SongUpdate(enabled=False)

        SongService.update(db, song, update_data)

        assert song.enabled is False

    def test_update_youtube_url_re_extracts_video_id(self):
        db = make_mock_db()
        song = make_song_model(youtube_video_id="oldvideoid11")
        new_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        update_data = SongUpdate(youtube_url=new_url)

        SongService.update(db, song, update_data)

        assert song.youtube_video_id == "dQw4w9WgXcQ"
        assert song.youtube_url == new_url

    def test_update_raises_value_error_for_invalid_url(self):
        db = make_mock_db()
        song = make_song_model()
        update_data = SongUpdate(youtube_url="https://youtu.be/dQw4w9WgXcQ")

        with patch("app.services.song_service.extract_youtube_video_id", return_value=None):
            with pytest.raises(ValueError, match="Could not extract YouTube video ID"):
                SongService.update(db, song, update_data)

        db.commit.assert_not_called()

    def test_update_does_not_touch_unset_fields(self):
        db = make_mock_db()
        song = make_song_model(title="Keep Me", artist="Keep Artist")
        update_data = SongUpdate(sort_order=5)

        SongService.update(db, song, update_data)

        # Unset fields should remain unchanged
        assert song.title == "Keep Me"
        assert song.artist == "Keep Artist"
        assert song.sort_order == 5

    def test_update_youtube_url_none_does_not_re_extract(self):
        """If youtube_url is not in the update payload, video_id should not change."""
        db = make_mock_db()
        song = make_song_model(youtube_video_id="dQw4w9WgXcQ")
        update_data = SongUpdate(title="New Title")  # no youtube_url

        SongService.update(db, song, update_data)

        assert song.youtube_video_id == "dQw4w9WgXcQ"


# ─── delete ───────────────────────────────────────────────────────────────────

class TestDelete:
    def test_delete_calls_db_delete_and_commit(self):
        db = make_mock_db()
        song = make_song_model()

        SongService.delete(db, song)

        db.delete.assert_called_once_with(song)
        db.commit.assert_called_once()


# ─── get_radio_queue ──────────────────────────────────────────────────────────

class TestGetRadioQueue:
    def test_radio_queue_delegates_to_get_all_enabled(self):
        db = make_mock_db()
        songs = [make_song_model("Song A"), make_song_model("Song B")]
        db.scalars.return_value.all.return_value = songs

        result = SongService.get_radio_queue(db)

        assert result == songs

    def test_cache_hit_returns_cached_data_without_db_query(self):
        """When _cache_get returns data, DB is not queried."""
        db = make_mock_db()
        cached_data = [
            {"id": str(uuid.uuid4()), "title": "Cached Song", "artist": "Artist",
             "youtube_video_id": "abc123", "youtube_url": None, "category": None,
             "sort_order": 0, "enabled": True},
        ]

        with patch("app.services.song_service._cache_get", return_value=cached_data):
            result = SongService.get_radio_queue(db)

        assert result == cached_data
        db.scalars.assert_not_called()

    def test_cache_miss_queries_db_and_populates_cache(self):
        """When _cache_get returns None, DB is queried and _cache_set is called."""
        db = make_mock_db()
        songs = [make_song_model("Song A"), make_song_model("Song B")]
        db.scalars.return_value.all.return_value = songs

        with patch("app.services.song_service._cache_get", return_value=None), \
             patch("app.services.song_service._cache_set") as mock_cache_set:
            result = SongService.get_radio_queue(db)

        assert result == songs
        mock_cache_set.assert_called_once()
        # Verify the cache key and TTL
        from app.services.song_service import QUEUE_CACHE_KEY, QUEUE_CACHE_TTL
        call_args = mock_cache_set.call_args[0]
        assert call_args[0] == QUEUE_CACHE_KEY
        assert call_args[2] == QUEUE_CACHE_TTL

    def test_cache_unavailable_falls_through_to_db(self):
        """When Redis is None, _cache_get returns None and DB is used transparently."""
        db = make_mock_db()
        songs = [make_song_model("Song A")]
        db.scalars.return_value.all.return_value = songs

        # _cache_get returns None when Redis is unavailable
        with patch("app.services.song_service._cache_get", return_value=None), \
             patch("app.services.song_service._cache_set"):
            result = SongService.get_radio_queue(db)

        assert result == songs
        db.scalars.assert_called_once()


# ─── Cache invalidation ───────────────────────────────────────────────────────

class TestCacheInvalidation:
    def test_create_invalidates_cache(self):
        """Cache is invalidated after song creation."""
        db = make_mock_db()
        data = SongCreate(
            title="New Song",
            artist="Artist",
            youtube_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            sort_order=1,
        )

        with patch("app.services.song_service._cache_delete") as mock_delete:
            SongService.create(db, data)

        from app.services.song_service import QUEUE_CACHE_KEY
        mock_delete.assert_called_once_with(QUEUE_CACHE_KEY)

    def test_update_invalidates_cache(self):
        """Cache is invalidated after song update."""
        db = make_mock_db()
        song = make_song_model()
        update_data = SongUpdate(title="Updated Title")

        with patch("app.services.song_service._cache_delete") as mock_delete:
            SongService.update(db, song, update_data)

        from app.services.song_service import QUEUE_CACHE_KEY
        mock_delete.assert_called_once_with(QUEUE_CACHE_KEY)

    def test_delete_invalidates_cache(self):
        """Cache is invalidated after song deletion."""
        db = make_mock_db()
        song = make_song_model()

        with patch("app.services.song_service._cache_delete") as mock_delete:
            SongService.delete(db, song)

        from app.services.song_service import QUEUE_CACHE_KEY
        mock_delete.assert_called_once_with(QUEUE_CACHE_KEY)
