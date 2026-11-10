"""Read production cache readiness and recent Render logs without exposing secrets."""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any


def request_json(url: str, headers: dict[str, str]) -> tuple[int, Any]:
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except Exception as exc:
        return 0, type(exc).__name__


def numeric_summary(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: (item if isinstance(item, (int, float, bool)) or item is None else numeric_summary(item))
            for key, item in value.items()
            if isinstance(item, (int, float, bool)) or item is None or isinstance(item, dict)
        }
    return None


def safe_log_message(message: str) -> str:
    message = re.sub(r"rediss?://[^\s,;\]\)\}]+", "[redis-url]", message, flags=re.IGNORECASE)
    message = re.sub(r"https?://[^\s,;\]\)\}]+", "[url]", message, flags=re.IGNORECASE)
    message = re.sub(
        r"(?i)\b(password|secret|token|authorization)(?:[=:]\s*|\s+)[^\s,;]+",
        r"\1=[redacted]",
        message,
    )
    message = re.sub(r"\bsk_[A-Za-z0-9_-]{12,}\b", "[key-redacted]", message)
    return message[:400]


def inspect_catalog_status() -> None:
    api_base = os.environ.get("NEXT_PUBLIC_API_URL", "").strip().rstrip("/")
    secret = os.environ.get("SECRET_KEY", "")
    if not api_base or not secret:
        print("production_catalog_status=skipped (API URL or secret unavailable)")
        return

    code, data = request_json(
        f"{api_base}/api/stream/catalog/status",
        {
            "Accept": "application/json",
            "User-Agent": "chhath-radio-runtime-diagnostic",
            "X-Admin-Secret": secret,
        },
    )
    print(f"production_catalog_status_http={code}")
    if code == 200 and isinstance(data, dict):
        print("production_catalog_counters=" + json.dumps(numeric_summary(data), separators=(",", ":")))


def inspect_render_logs() -> None:
    api_key = os.environ.get("RENDER_API_KEY", "")
    service_id = os.environ.get("RENDER_SERVICE_ID", "")
    if not api_key or not service_id:
        print("render_logs=skipped (Render API credentials unavailable)")
        return

    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "chhath-radio-runtime-diagnostic",
    }
    service_code, service_data = request_json(
        f"https://api.render.com/v1/services/{urllib.parse.quote(service_id, safe='')}",
        headers,
    )
    service = service_data.get("service", service_data) if isinstance(service_data, dict) else {}
    owner_id = service.get("ownerId") or service.get("owner_id") if isinstance(service, dict) else None
    if service_code != 200 or not owner_id:
        print(f"render_service_lookup_http={service_code}")
        return

    env_code, env_data = request_json(
        f"https://api.render.com/v1/services/{urllib.parse.quote(service_id, safe='')}/env-vars?limit=100",
        headers,
    )
    if env_code == 200 and isinstance(env_data, list):
        env_keys = [
            item.get("envVar", item).get("key")
            for item in env_data
            if isinstance(item, dict) and isinstance(item.get("envVar", item), dict)
        ]
        related_keys = sorted(key for key in env_keys if isinstance(key, str) and key.startswith("INVIDIOUS_"))
        print("render_invidious_env_keys=" + json.dumps(related_keys, separators=(",", ":")))
        print("render_invidious_instances_override_present=" + str("INVIDIOUS_INSTANCES" in env_keys).lower())
    else:
        print(f"render_env_vars_http={env_code}")

    now = datetime.now(timezone.utc)
    params = urllib.parse.urlencode(
        [
            ("ownerId", owner_id),
            ("resource", service_id),
            ("startTime", (now - timedelta(hours=6)).isoformat(timespec="seconds").replace("+00:00", "Z")),
            ("endTime", now.isoformat(timespec="seconds").replace("+00:00", "Z")),
            ("direction", "backward"),
            ("limit", "100"),
            ("type", "app"),
        ]
    )
    logs_code, logs_data = request_json(f"https://api.render.com/v1/logs?{params}", headers)
    if logs_code != 200 or not isinstance(logs_data, dict):
        print(f"render_logs_http={logs_code}")
        return

    messages = []
    markers = ("redis", "streamcache", "catalogreconciler", "invidious")
    for entry in logs_data.get("logs", []):
        message = entry.get("message", "") if isinstance(entry, dict) else ""
        if isinstance(message, str) and any(marker in message.lower() for marker in markers):
            messages.append(
                {
                    "timestamp": entry.get("timestamp"),
                    "message": safe_log_message(message),
                }
            )
    print(f"render_relevant_log_count={len(messages)}")
    for entry in messages[-30:]:
        print("render_log=" + json.dumps(entry, separators=(",", ":")))


if __name__ == "__main__":
    inspect_catalog_status()
    inspect_render_logs()
