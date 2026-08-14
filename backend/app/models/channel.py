"""
Channel and ChannelSong SQLAlchemy models.
A Channel is a curated playlist. ChannelSong is the many-to-many join table.
"""
import uuid
from sqlalchemy import String, Boolean, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.db.database import Base


class ChannelSong(Base):
    """Many-to-many join table between channels and songs with sort_order."""
    __tablename__ = "channel_songs"
    __table_args__ = (
        UniqueConstraint("channel_id", "song_id", name="uq_channel_song"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), nullable=False
    )
    song_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("songs.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relationships
    channel: Mapped["Channel"] = relationship("Channel", back_populates="channel_songs")
    song: Mapped["Song"] = relationship("Song")  # type: ignore[name-defined]

    def __repr__(self) -> str:
        return f"<ChannelSong channel={self.channel_id} song={self.song_id} order={self.sort_order}>"


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    channel_songs: Mapped[list[ChannelSong]] = relationship(
        "ChannelSong",
        back_populates="channel",
        cascade="all, delete-orphan",
        order_by="ChannelSong.sort_order",
    )

    def __repr__(self) -> str:
        return f"<Channel id={self.id} slug={self.slug!r}>"