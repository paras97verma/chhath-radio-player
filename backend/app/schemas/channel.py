"""
Pydantic schemas for Channel validation and serialization.
"""
import uuid
from pydantic import BaseModel, Field
from app.schemas.song import SongPublic


class ChannelBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    enabled: bool = True


class ChannelCreate(ChannelBase):
    pass


class ChannelPublic(ChannelBase):
    id: uuid.UUID

    model_config = {"from_attributes": True}


class ChannelWithSongs(ChannelPublic):
    """Channel with its full list of enabled songs, ordered by sort_order."""
    songs: list[SongPublic] = []

    model_config = {"from_attributes": True}