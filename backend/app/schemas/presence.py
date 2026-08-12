"""
Pydantic schemas for the real-time presence (listener count) feature.
"""
from pydantic import BaseModel, Field


class HeartbeatRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=64, description="Anonymous UUID from localStorage")


class ListenerCountResponse(BaseModel):
    count: int = Field(..., ge=0, description="Number of active listeners right now")