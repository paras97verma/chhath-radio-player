#!/usr/bin/env python3
"""Update only managed Render environment variables without deleting others."""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


REQUIRED_KEYS = (
    "DATABASE_URL",
    "REDIS_URL",
    "SECRET_KEY",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
)
OPTIONAL_KEYS = (
    "CALENDARIFIC_API_KEY",
    "CORS_ORIGINS",
    "INVIDIOUS_INSTANCES",
    "INVIDIOUS_REQUESTS_PER_SECOND",
    "INVIDIOUS_MAX_CONCURRENCY",
)
DEFAULT_VALUES = {
    "ALGORITHM": "HS256",
    "ACCESS_TOKEN_EXPIRE_MINUTES": "1440",
    "WEB_CONCURRENCY": "1",
    "LOG_LEVEL": "info",
}
MAX_ATTEMPTS = 3


def build_updates(environ: dict[str, str]) -> dict[str, str]:
    missing = [key for key in REQUIRED_KEYS if not environ.get(key, "").strip()]
    if missing:
        raise ValueError("Missing required Render values: " + ", ".join(missing))

    updates = {key: environ[key] for key in REQUIRED_KEYS}
    updates.update(DEFAULT_VALUES)
    updates.update({
        key: environ[key]
        for key in OPTIONAL_KEYS
        if environ.get(key, "").strip()
    })
    return updates


def update_one(api_key: str, service_id: str, key: str, value: str) -> bool:
    encoded_service = urllib.parse.quote(service_id, safe="")
    encoded_key = urllib.parse.quote(key, safe="")
    url = f"https://api.render.com/v1/services/{encoded_service}/env-vars/{encoded_key}"
    body = json.dumps({"value": value}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="PUT",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "chhath-radio-render-env-updater",
        },
    )

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status in (200, 201):
                    return True
                status = response.status
        except urllib.error.HTTPError as exc:
            status = exc.code
            exc.close()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            if attempt < MAX_ATTEMPTS:
                time.sleep(0.5 * (2 ** (attempt - 1)))
                continue
            print(f"Render env update failed for {key} ({type(exc).__name__}).", file=sys.stderr)
            return False

        if (status == 429 or status >= 500) and attempt < MAX_ATTEMPTS:
            time.sleep(0.5 * (2 ** (attempt - 1)))
            continue
        print(f"Render env update failed for {key} (HTTP {status}).", file=sys.stderr)
        return False

    return False


def main() -> int:
    api_key = os.environ.get("RENDER_API_KEY", "").strip()
    service_id = os.environ.get("RENDER_SERVICE_ID", "").strip()
    if not api_key or not service_id:
        print("RENDER_API_KEY and RENDER_SERVICE_ID are required.", file=sys.stderr)
        return 1

    try:
        updates = build_updates(os.environ)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    for key, value in updates.items():
        if not update_one(api_key, service_id, key, value):
            return 1
        print(f"Updated Render env var {key}.")

    print(
        f"Updated {len(updates)} Render env vars individually; "
        "unlisted service variables were preserved."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
