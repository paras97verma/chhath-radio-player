"""Tests for safe, per-variable Render environment updates."""

import importlib.util
import json
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "update-render-env.py"
SPEC = importlib.util.spec_from_file_location("render_env_updater", SCRIPT_PATH)
render_env_updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(render_env_updater)


def test_build_updates_applies_nonempty_optional_overrides_only():
    env = {
        "DATABASE_URL": "postgresql://db.example/radio",
        "REDIS_URL": "rediss://redis.example:6379/0",
        "SECRET_KEY": "test-secret-key",
        "ADMIN_EMAIL": "admin@example.com",
        "ADMIN_PASSWORD": "test-password",
        "INVIDIOUS_INSTANCES": "https://invidious.example",
        "INVIDIOUS_REQUESTS_PER_SECOND": "1.5",
        "CORS_ORIGINS": "",
    }

    updates = render_env_updater.build_updates(env)

    assert updates["INVIDIOUS_INSTANCES"] == "https://invidious.example"
    assert updates["INVIDIOUS_REQUESTS_PER_SECOND"] == "1.5"
    assert "CORS_ORIGINS" not in updates
    assert updates["WEB_CONCURRENCY"] == "1"


def test_update_one_targets_only_the_selected_render_key():
    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    with patch.object(render_env_updater.urllib.request, "urlopen", return_value=Response()) as urlopen:
        assert render_env_updater.update_one(
            "render-test-token", "srv-test", "INVIDIOUS_INSTANCES", "https://invidious.example"
        )

    request = urlopen.call_args.args[0]
    assert request.full_url.endswith("/services/srv-test/env-vars/INVIDIOUS_INSTANCES")
    assert request.get_method() == "PUT"
    assert json.loads(request.data) == {"value": "https://invidious.example"}
    assert request.get_header("Authorization") == "Bearer render-test-token"
