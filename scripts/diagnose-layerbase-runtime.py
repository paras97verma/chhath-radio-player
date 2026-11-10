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


def inspect_layerbase_cache() -> None:
    api_base = os.environ.get("NEXT_PUBLIC_API_URL", "").strip().rstrip("/")
    redis_url = os.environ.get("REDIS_URL", "").strip()
    if not api_base or not redis_url:
        print("layerbase_stream_cache_probe=skipped (API URL or Redis URL unavailable)")
        return

    headers = {"Accept": "application/json", "User-Agent": "chhath-radio-runtime-diagnostic"}
    songs_code, songs_data = request_json(f"{api_base}/api/songs", headers)
    songs = songs_data if isinstance(songs_data, list) else songs_data.get("songs", []) if isinstance(songs_data, dict) else []
    song = next(
        (
            item for item in songs
            if isinstance(item, dict) and item.get("enabled") and item.get("youtube_video_id")
        ),
        None,
    )
    if songs_code != 200 or song is None:
        print(f"layerbase_stream_cache_probe=skipped (songs HTTP {songs_code} or no enabled video)")
        return

    import redis

    video_id = str(song["youtube_video_id"])
    key = f"chhath:stream:{video_id}"
    client = redis.Redis.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=15,
        socket_timeout=15,
        ssl_cert_reqs="required",
        ssl_check_hostname=True,
    )
    try:
        raw_record = client.get(key)
        stream_status = None
        if raw_record is None:
            stream_url = f"{api_base}/api/stream?v={urllib.parse.quote(video_id, safe='')}"
            stream_status, _stream_data = request_json(stream_url, headers)
            print(f"production_sample_stream_http={stream_status}")
            raw_record = client.get(key)

        if raw_record is None:
            print("layerbase_stream_cache_record_present=false")
            return

        try:
            record = json.loads(raw_record)
        except (TypeError, ValueError):
            print("layerbase_stream_cache_record_present=true valid_record=false")
            return

        if not isinstance(record, dict):
            print("layerbase_stream_cache_record_present=true valid_record=false")
            return

        sources = record.get("sources")
        sources = sources if isinstance(sources, list) else []
        source_modes = sorted({
            source.get("mode")
            for source in sources
            if isinstance(source, dict) and source.get("mode") in {"direct", "proxy"}
        })
        try:
            generation = int(record.get("generation", 0))
        except (TypeError, ValueError):
            generation = 0
        ttl = client.ttl(key)
        valid_record = (
            record.get("schema_version") == 1
            and generation > 0
            and ttl > 0
            and len(source_modes) > 0
            and all(
                isinstance(source, dict)
                and source.get("provider") == "invidious"
                and source.get("mode") in {"direct", "proxy"}
                and isinstance(source.get("url"), str)
                for source in sources
            )
        )
        print(
            "layerbase_stream_cache_record="
            + json.dumps(
                {
                    "present": True,
                    "valid": valid_record,
                    "schema_version": record.get("schema_version"),
                    "generation": generation,
                    "source_modes": source_modes,
                    "ttl_seconds": ttl,
                },
                separators=(",", ":"),
            )
        )
    except Exception as exc:
        print(f"layerbase_stream_cache_probe_error={type(exc).__name__}")
    finally:
        client.close()


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
    inspect_layerbase_cache()
    inspect_render_logs()
