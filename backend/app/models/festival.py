"""
FestivalDay SQLAlchemy model.
Tracks specific festival dates and their ritual states (e.g., SANDHYA_ARGHYA).
"""
import uuid
from datetime import date
from sqlalchemy import String, Date
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.db.database import Base


class FestivalDay(Base):
    __tablename__ = "festival_days"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    state: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g. 'SANDHYA_ARGHYA'
    title: Mapped[str] = mapped_column(String(255), nullable=False)

    def __repr__(self) -> str:
        return f"<FestivalDay date={self.date} state={self.state!r}>"