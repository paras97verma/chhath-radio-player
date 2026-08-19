"""
Chhath Radio — Shared Redis Client

Single connection pool for the entire process.
All modules (chat, presence, song_service) import from here.

Key design decisions:
  - No lru_cache: avoids the "poison on first failure" bug where a transient
    Redis unavailability at cold-start permanently caches None for the process
    lifetime.
  - init_redis() is called once from main.py lifespan with a retry loop so
    the pool is established before the first request arrives.
  - get_redis_client() is non-poisoning: if the pool is None it tries to
    (re)create it on every call, so recovery after a transient failure is
    automatic.
  - Falls back gracefully (returns None) when Redis is unavailable so callers
    can degrade gracefully rather than crash.
"""

import asyncio
import logging
from typing import Optional

import redis as redis_lib

logger = logging.getLogger(__name__)

# Module-level pool — None until init_redis() succeeds.
_pool: Optional[redis_lib.ConnectionPool] = None


def _create_pool(url: str) -> Optional[redis_lib.ConnectionPool]:
    """
    Attempt to create and verify a Redis connection pool.
    Returns the pool on success, None on failure.

    Upstash TLS handling:
      - Upstash requires TLS; plain redis:// URLs are rewritten to rediss://.
      - ssl_cert_reqs="none" (string) is required for redis-py v5 to disable
        cert verification against Upstash's self-signed cert chain.
        Passing Python None is silently ignored in v5, leaving verification on.
    """
    if not url:
        return None

    # Upstash requires TLS — rewrite redis:// → rediss:// for cloud endpoints
    if "upstash.io" in url and url.startswith("redis://"):
        url = url.replace("redis://", "rediss://", 1)
        logger.debug("Rewrote Redis URL to use TLS (rediss://) for Upstash endpoint")

    # For TLS connections pass ssl_cert_reqs as the string "none" (redis-py v5)
    extra_kwargs: dict = {}
    if url.startswith("rediss://"):
        extra_kwargs["ssl_cert_reqs"] = "none"

    try:
        pool = redis_lib.ConnectionPool.from_url(
            url,
            decode_responses=True,
            max_connections=20,
            socket_connect_timeout=5,
            socket_timeout=5,
            **extra_kwargs,
        )
        # Verify connectivity with a PING
        redis_lib.Redis(connection_pool=pool).ping()
        logger.info("Redis connection pool established: %s", url.split("@")[-1])
        return pool
    except Exception as exc:
        logger.warning("Redis pool creation failed: %s", exc)
        return None


async def init_redis(url: str, retries: int = 3, delay: float = 1.5) -> None:
    """
    Called once from main.py lifespan on startup.
    Tries up to `retries` times with `delay` seconds between attempts.
    This handles the Render cold-start window where Redis may not be
    immediately reachable.
    """
    global _pool
    for attempt in range(1, retries + 1):
        pool = _create_pool(url)
        if pool is not None:
            _pool = pool
            return
        if attempt < retries:
            logger.warning(
                "Redis init attempt %d/%d failed — retrying in %.1fs",
                attempt, retries, delay,
            )
            await asyncio.sleep(delay)
    logger.error(
        "Redis unavailable after %d attempts — chat history will not persist across deploys.",
        retries,
    )


def get_redis_client() -> Optional[redis_lib.Redis]:
    """
    Return a Redis client from the shared pool.

    Non-poisoning: if the pool was never initialised (e.g. Redis was down at
    startup) this tries to create it now using the URL from settings.
    Returns None if Redis is still unavailable so callers can degrade
    gracefully.
    """
    global _pool
    if _pool is None:
        # Lazy re-attempt — allows recovery after a transient startup failure
        from app.core.config import settings
        _pool = _create_pool(settings.REDIS_URL)

    if _pool is None:
        return None

    try:
        return redis_lib.Redis(connection_pool=_pool)
    except Exception as exc:
        logger.warning("Failed to get Redis client from pool: %s", exc)
        return None


def close_redis() -> None:
    """Disconnect the pool on shutdown (called from main.py lifespan)."""
    global _pool
    if _pool is not None:
        try:
            _pool.disconnect()
        except Exception:
            pass
        _pool = None
        logger.info("Redis connection pool closed.")