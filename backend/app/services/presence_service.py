"""
Presence service — manages real-time listener count.

Design (single-worker, Render free tier):
  - Live session tracking uses an in-memory dict (session_id → expiry timestamp).
    This is O(1) per heartbeat with zero network I/O — no Redis round-trip per second.
  - A "last known count" is periodically written to Redis so that after a server
    restart/deploy, the SSE endpoint can show the pre-restart count as a display
    fallback for the ~5–10 seconds it takes clients to reconnect.
  - Falls back gracefully if Redis is unavailable (last_known just returns 0).

Why not Redis for live sessions?
  - On Render free tier there is 1 Gunicorn worker. All SSE connections share the
    same process, so in-memory is sufficient and avoids a Redis round-trip on every
    heartbeat (every 1s × N listeners).
  - Listener count resets on every deploy regardless of storage because all
    connections are dropped when the process restarts. Redis cannot preserve live
    connections — only the last-known count for display purposes.

Redis key layout:
  chhath:listeners:last_known  — integer, last known listener count (TTL 1 hour)
"""

import time
import logging

from app.core.redis import get_redis_client

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

# Session TTL: how long after the last heartbeat before a session is considered gone.
# The SSE loop refreshes every PUSH_INTERVAL (1s), so 6s gives 3 missed heartbeats
# before expiry.
SESSION_TTL_SECONDS = 6

# Redis key for the last-known listener count (display fallback after restart)
LAST_KNOWN_KEY = "chhath:listeners:last_known"

# How often to write the current count to Redis (seconds).
# Writing every 30s is sufficient — the value is only used for ~5–10s after restart.
LAST_KNOWN_WRITE_INTERVAL = 30

# ─── In-memory session store ──────────────────────────────────────────────────

_mem_sessions: dict[str, float] = {}  # session_id → expiry timestamp
_last_known_write: float = 0.0        # unix timestamp of last Redis write

# ─── Public API ───────────────────────────────────────────────────────────────

def record_heartbeat(session_id: str) -> None:
    """
    Record or refresh a listener's heartbeat.
    Updates the in-memory expiry timestamp for the session. O(1), no network I/O.
    """
    _mem_sessions[session_id] = time.time() + SESSION_TTL_SECONDS


def get_listener_count() -> int:
    """
    Return the current live listener count.

    Prunes expired sessions from the in-memory dict, then returns the count.
    Periodically writes the count to Redis as a display fallback for after restarts.
    """
    global _last_known_write

    now = time.time()

    # Prune expired sessions
    expired = [sid for sid, exp in _mem_sessions.items() if exp < now]
    for sid in expired:
        del _mem_sessions[sid]

    count = len(_mem_sessions)

    # Periodically persist last-known count to Redis
    if count > 0 and (now - _last_known_write) >= LAST_KNOWN_WRITE_INTERVAL:
        try:
            r = get_redis_client()
            if r:
                r.set(LAST_KNOWN_KEY, count, ex=3600)  # expire after 1 hour
                _last_known_write = now
                logger.debug("Wrote last_known listener count to Redis: %d", count)
        except Exception as exc:
            logger.warning("Redis last_known write failed: %s", exc)

    return count


def get_last_known_count() -> int:
    """
    Return the last known listener count from Redis.

    Used as a display fallback immediately after server restart, before real
    connections rebuild (typically within 5–10 seconds). Returns 0 if Redis
    is unavailable or the key has expired.
    """
    try:
        r = get_redis_client()
        if r:
            val = r.get(LAST_KNOWN_KEY)
            return int(val) if val else 0
    except Exception as exc:
        logger.warning("Redis last_known read failed: %s", exc)
    return 0


def remove_session(session_id: str) -> None:
    """
    Explicitly remove a session (e.g. on SSE disconnect).
    No-op if the session does not exist.
    """
    _mem_sessions.pop(session_id, None)