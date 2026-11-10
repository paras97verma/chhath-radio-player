"""Read production cache readiness and recent Render logs without exposing secrets."""

import json
import math
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


def _usable_source(source: Any, mode: str, now: float) -> tuple[bool, bool]:
    """Return (currently serveable, outside the proactive refresh window)."""
    if not isinstance(source, dict):
        return False, False
    if source.get("mode") != mode or source.get("provider") != "invidious":
        return False, False
    if source.get("validation_state") != "validated":
        return False, False

    url = source.get("url")
    mime_type = str(source.get("mime_type") or source.get("mimeType") or "")
    try:
        url_parts = urllib.parse.urlsplit(url if isinstance(url, str) else "")
        url_host = url_parts.hostname
        itag = int(source.get("itag"))
        refresh_at = float(source.get("refresh_at"))
        expires_at = source.get("expires_at")
        expires_at = None if expires_at is None else float(expires_at)
    except (TypeError, ValueError):
        return False, False

    valid = (
        url_parts.scheme == "https"
        and bool(url_host)
        and not url_parts.username
        and not url_parts.password
        and itag > 0
        and mime_type.split(";", 1)[0].strip().lower() in {"audio/mp4", "audio/webm"}
        and math.isfinite(refresh_at)
        and refresh_at > now
        and (expires_at is None or (math.isfinite(expires_at) and expires_at > now))
    )
    return valid, valid and refresh_at > now + 900


def inspect_layerbase_cache() -> None:
    api_base = os.environ.get("NEXT_PUBLIC_API_URL", "").strip().rstrip("/")
    redis_url = os.environ.get("REDIS_URL", "").strip()
    if not api_base or not redis_url:
        print("layerbase_stream_cache_probe=skipped (API URL or Redis URL unavailable)")
        return
    cache_label = "layerbase" if urllib.parse.urlsplit(redis_url).scheme == "rediss" else "redis"

    headers = {"Accept": "application/json", "User-Agent": "chhath-radio-runtime-diagnostic"}
    songs_code, songs_data = request_json(f"{api_base}/api/songs", headers)
    songs = songs_data if isinstance(songs_data, list) else songs_data.get("songs", []) if isinstance(songs_data, dict) else []
    if songs_code != 200 or not isinstance(songs, list):
        print(f"layerbase_catalog_cache_audit=skipped (songs HTTP {songs_code})")
        return

    enabled_songs = [
        item for item in songs
        if isinstance(item, dict) and item.get("enabled", True)
    ]
    enabled_ids = [str(item.get("youtube_video_id", "")).strip() for item in enabled_songs]
    valid_ids = [video_id for video_id in enabled_ids if re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id)]
    video_ids = list(dict.fromkeys(valid_ids))
    if not video_ids:
        print(f"{cache_label}_catalog_cache=" + json.dumps({
            "enabled_catalog_entries": len(enabled_songs),
            "catalog_entries_without_valid_video_id": len(enabled_songs),
            "unique_video_ids": 0,
            "missing_or_invalid": 0,
        }, separators=(",", ":")))
        return

    import redis

    redis_options = {
        "decode_responses": True,
        "socket_connect_timeout": 15,
        "socket_timeout": 15,
    }
    if urllib.parse.urlsplit(redis_url).scheme == "rediss":
        redis_options.update(ssl_cert_reqs="required", ssl_check_hostname=True)
    client = redis.Redis.from_url(redis_url, **redis_options)
    try:
        pipe = client.pipeline(transaction=False)
        for video_id in video_ids:
            pipe.get(f"chhath:stream:{video_id}")
            pipe.hgetall(f"chhath:stream:fence:{video_id}")
            pipe.ttl(f"chhath:stream:{video_id}")
        values = pipe.execute()

        now = datetime.now(timezone.utc).timestamp()
        summary = {
            "enabled_catalog_entries": len(enabled_songs),
            "catalog_entries_without_valid_video_id": len(enabled_songs) - len(valid_ids),
            "unique_video_ids": len(video_ids),
            "duplicate_video_ids": len(valid_ids) - len(video_ids),
            "cache_keys_present": 0,
            "fenced_current_records": 0,
            "direct_servable": 0,
            "proxy_servable": 0,
            "direct_fresh": 0,
            "proxy_fresh": 0,
            "fully_warm_direct_and_proxy": 0,
            "partial_or_due": 0,
            "missing_or_invalid": 0,
            "malformed_records": 0,
            "fence_mismatches": 0,
            "orphan_catalog_stream_keys": 0,
        }
        catalog_ids = set(video_ids)
        for index, video_id in enumerate(video_ids):
            raw_record, raw_fence, ttl = values[index * 3:index * 3 + 3]
            if raw_record is None:
                summary["missing_or_invalid"] += 1
                continue

            summary["cache_keys_present"] += 1
            try:
                record = json.loads(raw_record)
            except (TypeError, ValueError):
                summary["malformed_records"] += 1
                summary["missing_or_invalid"] += 1
                continue

            if not isinstance(record, dict):
                summary["malformed_records"] += 1
                summary["missing_or_invalid"] += 1
                continue

            try:
                generation = int(record.get("generation", 0))
                fence_generation = int(raw_fence.get("generation", 0))
            except (TypeError, ValueError, AttributeError):
                generation = fence_generation = 0
            fence_token = str(raw_fence.get("fence_token", "")) if isinstance(raw_fence, dict) else ""
            current_record = (
                record.get("schema_version") == 1
                and record.get("video_id") == video_id
                and generation > 0
                and generation == fence_generation
                and isinstance(record.get("fence_token"), str)
                and bool(fence_token)
                and record.get("fence_token") == fence_token
                and isinstance(ttl, int)
                and ttl > 0
            )
            if not current_record:
                summary["fence_mismatches"] += 1
                summary["missing_or_invalid"] += 1
                continue

            summary["fenced_current_records"] += 1
            sources = record.get("sources")
            sources = sources if isinstance(sources, list) else []
            by_mode = {}
            for mode in ("direct", "proxy"):
                for source in sources:
                    usable, fresh = _usable_source(source, mode, now)
                    if usable:
                        by_mode[mode] = fresh
                        summary[f"{mode}_servable"] += 1
                        if fresh:
                            summary[f"{mode}_fresh"] += 1
                        break

            if not by_mode:
                summary["missing_or_invalid"] += 1
            elif all(by_mode.get(mode) is True for mode in ("direct", "proxy")):
                summary["fully_warm_direct_and_proxy"] += 1
            else:
                summary["partial_or_due"] += 1

        cursor = 0
        while True:
            cursor, keys = client.scan(cursor=cursor, match="chhath:stream:*", count=200)
            for key in keys:
                suffix = key.removeprefix("chhath:stream:")
                if re.fullmatch(r"[A-Za-z0-9_-]{11}", suffix) and suffix not in catalog_ids:
                    summary["orphan_catalog_stream_keys"] += 1
            if cursor == 0:
                break

        print(f"{cache_label}_catalog_cache=" + json.dumps(summary, separators=(",", ":")))
    except Exception as exc:
        print(f"{cache_label}_catalog_cache_audit_error={type(exc).__name__}")
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
