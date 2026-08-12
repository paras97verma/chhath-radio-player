"""
SiteSetting SQLAlchemy model.
Key-value store for global site configuration.
"""
import uuid
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.db.database import Base


class SiteSetting(Base):
    __tablename__ = "site_settings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<SiteSetting key={self.key!r} value={self.value!r}>"