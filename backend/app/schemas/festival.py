"""
Pydantic schemas for FestivalDay.
"""
import uuid
from datetime import date
from pydantic import BaseModel


class FestivalDayPublic(BaseModel):
    id: uuid.UUID
    date: date
    state: str
    title: str

    model_config = {"from_attributes": True}