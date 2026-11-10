"""Validate and PING the configured Layerbase Redis endpoint without printing its URL."""

import os
from urllib.parse import urlsplit

import redis


def main() -> None:
    url = os.environ.get("REDIS_URL", "").strip()
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        port = parsed.port if parsed.port is not None else 6379
    except ValueError:
        raise SystemExit("REDIS_URL is malformed; check the Layerbase connection string.")

    if (
        parsed.scheme != "rediss"
        or not host.endswith(".cloud.layerbase.dev")
        or port != 6379
        or not parsed.username
        or not parsed.password
    ):
        raise SystemExit(
            "REDIS_URL must be a credentialed rediss:// Layerbase host using port 6379."
        )

    client = None
    try:
        client = redis.Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            ssl_cert_reqs="required",
            ssl_check_hostname=True,
        )
        client.ping()
    except Exception as exc:
        raise SystemExit(
            f"Layerbase Redis PING failed for {host} ({type(exc).__name__})."
        ) from None
    finally:
        if client is not None:
            client.close()

    print(f"Layerbase Redis PING succeeded for {host}.")


if __name__ == "__main__":
    main()
