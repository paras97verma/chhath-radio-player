"""
Song SQLAlchemy model.
Represents a single Chhath song with its YouTube video reference.
"""
import uuid
from sqlalchemy import String, Boolean, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.db.database import Base


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    artist: Mapped[str] = mapped_column(String(255), nullable=False)
    youtube_video_id: Mapped[str] = mapped_column(String(11), nullable=False)
    youtube_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    def __repr__(self) -> str:
        return f"<Song id={self.id} title={self.title!r} yt={self.youtube_video_id!r}>"