"""
Presence service — manages real-time listener count using Redis.

Scale design:
  - Uses a single Redis counter key (INCR/DECR) instead of per-session keys.
    This is O(1) regardless of listener count — no SCAN over 1M keys.
  - Session TTL is enforced via a separate sorted set (session_id → expiry score).
    A background cleanup task removes expired sessions and decrements the counter.
  - Falls back to an in-memory counter if Redis is unavailable (local dev without Redis).
  - Connection is created once per process via a module-level pool (not per-request).

Redis key layout:
  chhath:listeners:count   — integer counter of active sessions
  chhath:listeners:sessions — sorted set: session_id → expiry_unix_timestamp
"""

import time
import logging
from functools import lru_cache
from typing import Optional

import redis as redis_lib
from redis.exceptions import RedisError

from app.core.config import settings

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

COUNTER_KEY = "chhath:listeners:count"
SESSIONS_KEY = "chhath:listeners:sessions"
SESSION_TTL_SECONDS = 20  # session expires if no heartbeat for 20 s

# ─── Connection pool (one per process, shared across requests) ────────────────

@lru_cache(maxsize=1)
def _get_pool() -> Optional[redis_lib.ConnectionPool]:
    """
    Create a single connection pool for the process.
    Returns None if Redis is not configured or unreachable.
    """
    try:
        pool = redis_lib.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=50,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        # Verify connectivity
        client = redis_lib.Redis(connection_pool=pool)
        client.ping()
        return pool
    except Exception as exc:
        logger.warning("Redis unavailable — falling back to in-memory presence: %s", exc)
        return None


def _get_client() -> Optional[redis_lib.Redis]:
    pool = _get_pool()
    if pool is None:
        return None
    return redis_lib.Redis(connection_pool=pool)


# ─── In-memory fallback (single-process dev only) ────────────────────────────

_mem_sessions: dict[str, float] = {}  # session_id → expiry timestamp


def _mem_heartbeat(session_id: str) -> None:
    _mem_sessions[session_id] = time.time() + SESSION_TTL_SECONDS


def _mem_count() -> int:
    now = time.time()
    expired = [sid for sid, exp in _mem_sessions.items() if exp < now]
    for sid in expired:
        del _mem_sessions[sid]
    return len(_mem_sessions)


# ─── Public API ───────────────────────────────────────────────────────────────

def record_heartbeat(session_id: str) -> None:
    """
    Record or refresh a listener's heartbeat.

    Redis implementation (O(log N)):
      - ZADD the session with score = current_unix_time + TTL
      - If this is a new session (ZADD returned 1), INCR the counter
      - Periodically prune expired sessions from the sorted set

    Falls back to in-memory dict if Redis is unavailable.
    """
    client = _get_client()
    if client is None:
        _mem_heartbeat(session_id)
        return

    try:
        expiry = time.time() + SESSION_TTL_SECONDS
        # ZADD NX: only add if not already present (returns 1 for new, 0 for update)
        added = client.zadd(SESSIONS_KEY, {session_id: expiry}, nx=True)
        if added:
            # New session — increment counter
            client.incr(COUNTER_KEY)
        else:
            # Existing session — just refresh the score
            client.zadd(SESSIONS_KEY, {session_id: expiry})

        # Prune expired sessions (those with score < now) — O(log N + M)
        # Run probabilistically to avoid doing it on every heartbeat
        import random
        if random.random() < 0.05:  # ~5% of heartbeats trigger cleanup
            _prune_expired(client)

    except RedisError as exc:
        logger.error("Redis heartbeat error: %s", exc)
        _mem_heartbeat(session_id)


def get_listener_count() -> int:
    """
    Return the current listener count.

    Always derived from the live sorted set (sessions with expiry > now).
    This is accurate regardless of counter drift from restarts or crashes.
    O(log N) — fast enough for this scale.

    Falls back to in-memory count if Redis is unavailable.
    """
    client = _get_client()
    if client is None:
        return _mem_count()

    try:
        now = time.time()
        return int(client.zcount(SESSIONS_KEY, now, "+inf"))
    except RedisError as exc:
        logger.error("Redis count error: %s", exc)
        return _mem_count()


def remove_session(session_id: str) -> None:
    """
    Explicitly remove a session (e.g. on SSE disconnect).
    Decrements the counter and removes from the sorted set.
    """
    client = _get_client()
    if client is None:
        _mem_sessions.pop(session_id, None)
        return

    try:
        removed = client.zrem(SESSIONS_KEY, session_id)
        if removed:
            # Decrement but never go below 0
            new_val = client.decr(COUNTER_KEY)
            if new_val < 0:
                client.set(COUNTER_KEY, 0)
    except RedisError as exc:
        logger.error("Redis remove_session error: %s", exc)


def _prune_expired(client: redis_lib.Redis) -> None:
    """
    Remove sessions whose TTL has elapsed from the sorted set and
    correct the counter accordingly.
    """
    try:
        now = time.time()
        # ZREMRANGEBYSCORE removes all members with score < now
        removed = client.zremrangebyscore(SESSIONS_KEY, "-inf", now)
        if removed:
            new_val = client.decrby(COUNTER_KEY, removed)
            if new_val < 0:
                client.set(COUNTER_KEY, 0)
    except RedisError as exc:
        logger.error("Redis prune error: %s", exc)