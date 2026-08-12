"""
Unit tests for app.schemas.song — YouTube URL extraction and Pydantic validators.
These tests are pure-Python and require no database or network access.
"""
import pytest
from pydantic import ValidationError

from app.schemas.song import (
    extract_youtube_video_id,
    SongCreate,
    SongUpdate,
    SongPublic,
)


# ─── extract_youtube_video_id ─────────────────────────────────────────────────

class TestExtractYouTubeVideoId:
    """Tests for the extract_youtube_video_id() helper function."""

    # --- Valid URL formats ---

    def test_standard_watch_url(self):
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        assert extract_youtube_video_id(url) == "dQw4w9WgXcQ"

    def test_watch_url_with_extra_params(self):
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLxxx"
        assert extract_youtube_video_id(url) == "dQw4w9WgXcQ"

    def test_short_youtu_be_url(self):
        url = "https://youtu.be/dQw4w9WgXcQ"
        assert extract_youtube_video_id(url) == "dQw4w9WgXcQ"

    def test_embed_url(self):
        url = "https://www.youtube.com/embed/dQw4w9WgXcQ"
        assert extract_youtube_video_id(url) == "dQw4w9WgXcQ"

    def test_shorts_url(self):
        url = "https://www.youtube.com/shorts/dQw4w9WgXcQ"
        assert extract_youtube_video_id(url) == "dQw4w9WgXcQ"

    def test_bare_11_char_video_id(self):
        """A raw 11-character video ID should be returned as-is."""
        assert extract_youtube_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_video_id_with_underscores_and_hyphens(self):
        """Video IDs can contain underscores and hyphens."""
        vid = "abc-DEF_1234"  # 12 chars — should NOT match bare-ID path
        url = f"https://youtu.be/{vid}"
        # The regex captures 11 chars; this 12-char ID won't match bare path
        # but the URL regex will capture the first 11 chars
        result = extract_youtube_video_id(url)
        assert result == "abc-DEF_123"

    def test_exactly_11_char_id_with_hyphens(self):
        vid = "abc-DEF_123"  # exactly 11 chars
        assert extract_youtube_video_id(vid) == "abc-DEF_123"

    # --- Invalid inputs ---

    def test_returns_none_for_empty_string(self):
        assert extract_youtube_video_id("") is None

    def test_returns_none_for_non_youtube_url(self):
        assert extract_youtube_video_id("https://vimeo.com/123456789") is None

    def test_returns_none_for_plain_text(self):
        assert extract_youtube_video_id("not a url at all") is None

    def test_returns_none_for_short_id(self):
        """A 10-character string is not a valid bare video ID."""
        assert extract_youtube_video_id("dQw4w9WgXc") is None

    def test_returns_none_for_long_id(self):
        """A 12-character string is not a valid bare video ID."""
        assert extract_youtube_video_id("dQw4w9WgXcQQ") is None

    def test_returns_none_for_youtube_channel_url(self):
        assert extract_youtube_video_id("https://www.youtube.com/@SomeChannel") is None

    def test_returns_none_for_youtube_playlist_url(self):
        url = "https://www.youtube.com/playlist?list=PLxxx"
        assert extract_youtube_video_id(url) is None


# ─── SongCreate schema ────────────────────────────────────────────────────────

class TestSongCreate:
    """Tests for the SongCreate Pydantic schema."""

    def _valid_payload(self, **overrides):
        base = {
            "title": "Kaanch Hi Baans",
            "artist": "Sharda Sinha",
            "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "sort_order": 1,
        }
        base.update(overrides)
        return base

    def test_valid_song_create(self):
        song = SongCreate(**self._valid_payload())
        assert song.title == "Kaanch Hi Baans"
        assert song.artist == "Sharda Sinha"
        assert song.youtube_url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        assert song.sort_order == 1

    def test_youtube_video_id_property(self):
        song = SongCreate(**self._valid_payload())
        assert song.youtube_video_id == "dQw4w9WgXcQ"

    def test_accepts_youtu_be_url(self):
        song = SongCreate(**self._valid_payload(youtube_url="https://youtu.be/dQw4w9WgXcQ"))
        assert song.youtube_video_id == "dQw4w9WgXcQ"

    def test_accepts_shorts_url(self):
        song = SongCreate(**self._valid_payload(youtube_url="https://www.youtube.com/shorts/dQw4w9WgXcQ"))
        assert song.youtube_video_id == "dQw4w9WgXcQ"

    def test_accepts_bare_video_id(self):
        song = SongCreate(**self._valid_payload(youtube_url="dQw4w9WgXcQ"))
        assert song.youtube_video_id == "dQw4w9WgXcQ"

    def test_rejects_invalid_youtube_url(self):
        with pytest.raises(ValidationError) as exc_info:
            SongCreate(**self._valid_payload(youtube_url="https://vimeo.com/123"))
        assert "Invalid YouTube URL" in str(exc_info.value)

    def test_rejects_empty_title(self):
        with pytest.raises(ValidationError):
            SongCreate(**self._valid_payload(title=""))

    def test_rejects_title_too_long(self):
        with pytest.raises(ValidationError):
            SongCreate(**self._valid_payload(title="x" * 256))

    def test_rejects_empty_artist(self):
        with pytest.raises(ValidationError):
            SongCreate(**self._valid_payload(artist=""))

    def test_rejects_negative_sort_order(self):
        with pytest.raises(ValidationError):
            SongCreate(**self._valid_payload(sort_order=-1))

    def test_category_is_optional(self):
        song = SongCreate(**self._valid_payload())
        assert song.category is None

    def test_category_max_length(self):
        with pytest.raises(ValidationError):
            SongCreate(**self._valid_payload(category="x" * 101))

    def test_sort_order_defaults_to_zero(self):
        payload = self._valid_payload()
        del payload["sort_order"]
        song = SongCreate(**payload)
        assert song.sort_order == 0


# ─── SongUpdate schema ────────────────────────────────────────────────────────

class TestSongUpdate:
    """Tests for the SongUpdate Pydantic schema (all fields optional)."""

    def test_empty_update_is_valid(self):
        """SongUpdate with no fields set is valid (partial update)."""
        update = SongUpdate()
        assert update.model_dump(exclude_unset=True) == {}

    def test_update_title_only(self):
        update = SongUpdate(title="New Title")
        assert update.title == "New Title"
        assert update.artist is None

    def test_update_enabled_false(self):
        update = SongUpdate(enabled=False)
        assert update.enabled is False

    def test_update_valid_youtube_url(self):
        update = SongUpdate(youtube_url="https://youtu.be/dQw4w9WgXcQ")
        assert update.youtube_url == "https://youtu.be/dQw4w9WgXcQ"

    def test_update_rejects_invalid_youtube_url(self):
        with pytest.raises(ValidationError) as exc_info:
            SongUpdate(youtube_url="https://vimeo.com/123")
        assert "Invalid YouTube URL" in str(exc_info.value)

    def test_update_youtube_url_none_is_valid(self):
        """Explicitly passing None for youtube_url should be accepted."""
        update = SongUpdate(youtube_url=None)
        assert update.youtube_url is None

    def test_update_rejects_empty_title(self):
        with pytest.raises(ValidationError):
            SongUpdate(title="")

    def test_update_rejects_negative_sort_order(self):
        with pytest.raises(ValidationError):
            SongUpdate(sort_order=-5)