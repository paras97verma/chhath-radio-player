"""
Pydantic schemas for Song validation and serialization.
"""
import re
import uuid
from pydantic import BaseModel, Field, field_validator, model_validator


YOUTUBE_VIDEO_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def extract_youtube_video_id(url: str) -> str | None:
    """Extract the 11-character video ID from any YouTube URL format."""
    match = YOUTUBE_VIDEO_ID_RE.search(url)
    if match:
        return match.group(1)
    # If the input is already an 11-char ID, return it directly
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url):
        return url
    return None


class SongBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    artist: str = Field(..., min_length=1, max_length=255)
    category: str | None = Field(default=None, max_length=100)
    sort_order: int = Field(default=0, ge=0)


class SongCreate(BaseModel):
    """Schema for creating a new song. Accepts a full YouTube URL."""
    youtube_url: str = Field(..., description="Full YouTube URL or 11-char video ID")
    title: str | None = Field(default=None, max_length=255)
    artist: str | None = Field(default=None, max_length=255)
    category: str | None = Field(default=None, max_length=100)
    sort_order: int = Field(default=0, ge=0)

    @field_validator("youtube_url")
    @classmethod
    def validate_and_extract_video_id(cls, v: str) -> str:
        video_id = extract_youtube_video_id(v)
        if not video_id:
            raise ValueError(
                "Invalid YouTube URL. Must be a valid youtube.com or youtu.be URL."
            )
        return v  # Store the original URL; video_id is derived in the service layer

    @property
    def youtube_video_id(self) -> str:
        return extract_youtube_video_id(self.youtube_url) or ""


class SongUpdate(BaseModel):
    """Schema for partial updates to a song."""
    title: str | None = Field(default=None, min_length=1, max_length=255)
    artist: str | None = Field(default=None, min_length=1, max_length=255)
    category: str | None = Field(default=None, max_length=100)
    enabled: bool | None = None
    sort_order: int | None = Field(default=None, ge=0)
    youtube_url: str | None = None

    @field_validator("youtube_url")
    @classmethod
    def validate_youtube_url(cls, v: str | None) -> str | None:
        if v is None:
            return v
        video_id = extract_youtube_video_id(v)
        if not video_id:
            raise ValueError("Invalid YouTube URL.")
        return v


class SongPublic(SongBase):
    """Schema returned to public API consumers."""
    id: uuid.UUID
    youtube_video_id: str
    youtube_url: str | None
    enabled: bool

    model_config = {"from_attributes": True}