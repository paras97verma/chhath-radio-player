"""
Public API routes for real-time listener presence.
No authentication required.
"""
from fastapi import APIRouter

from app.schemas.presence import HeartbeatRequest, ListenerCountResponse
from app.services.presence_service import record_heartbeat, get_listener_count

router = APIRouter(prefix="/api/presence", tags=["presence"])


@router.post("/heartbeat", status_code=204)
def heartbeat(body: HeartbeatRequest) -> None:
    """
    POST /api/presence/heartbeat
    Called every 15 seconds by the frontend to signal the user is still listening.
    Stores the session_id in Redis with a 45-second TTL.
    Returns 204 No Content on success.
    """
    record_heartbeat(body.session_id)


@router.get("/listeners", response_model=ListenerCountResponse)
def get_listeners() -> ListenerCountResponse:
    """
    GET /api/presence/listeners
    Returns the current count of active listeners (Redis keys with presence prefix).
    """
    count = get_listener_count()
    return ListenerCountResponse(count=count)