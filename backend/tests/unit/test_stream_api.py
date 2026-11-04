from unittest.mock import Mock


def test_stream_response_has_contract_metadata_and_no_store(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.stream.StreamCacheService.get_stream",
        lambda *args, **kwargs: {"url": "https://example.test/audio", "timestamp": 1_700_000_000_000},
    )

    response = client.get("/api/stream?v=abcdefghijk")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.json()["schema_version"] == 1
    assert response.json()["video_id"] == "abcdefghijk"
    assert response.json()["generation"] == 0
    assert response.json()["refreshed_at"] == 1_700_000_000


def test_unavailable_stream_is_retryable_and_not_cached(client, monkeypatch):
    monkeypatch.setattr("app.api.stream.StreamCacheService.get_stream", lambda *args, **kwargs: None)

    response = client.get("/api/stream?v=abcdefghijk")

    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.json() == {"error": "stream_unavailable", "retryable": True}


def test_source_failure_records_only_current_generation_by_mode(client, monkeypatch):
    redis = Mock()
    monkeypatch.setattr(
        "app.api.stream.StreamCacheService.get_stream_fast",
        lambda _video_id: {
            "generation": 9,
            "sources": [
                {
                    "mode": "proxy",
                    "provider": "invidious",
                    "provider_origin": "https://inv.example.test",
                }
            ],
        },
    )
    monkeypatch.setattr("app.api.stream.get_redis_client", lambda: redis)

    response = client.post(
        "/api/stream/source-failure",
        json={
            "video_id": "abcdefghijk",
            "mode": "proxy",
            "provider": "https://inv.example.test",
            "generation": 9,
            "reason": "stalled",
        },
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.json() == {"recorded": True, "stale": False}
    redis.hincrby.assert_called_once_with("chhath:metrics:stream", "source_failure_proxy", 1)


def test_source_failure_ignores_stale_generation(client, monkeypatch):
    redis = Mock()
    monkeypatch.setattr("app.api.stream.StreamCacheService.get_stream_fast", lambda _video_id: {"generation": 10})
    monkeypatch.setattr("app.api.stream.get_redis_client", lambda: redis)

    response = client.post(
        "/api/stream/source-failure",
        json={
            "video_id": "abcdefghijk",
            "mode": "direct",
            "provider": "https://inv.example.test",
            "generation": 9,
            "reason": "network error",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"recorded": False, "stale": True}
    redis.hincrby.assert_not_called()


def test_source_failure_ignores_candidate_not_in_current_generation(client, monkeypatch):
    redis = Mock()
    monkeypatch.setattr(
        "app.api.stream.StreamCacheService.get_stream_fast",
        lambda _video_id: {
            "generation": 9,
            "sources": [
                {
                    "mode": "direct",
                    "provider": "invidious",
                    "provider_origin": "https://inv.example.test",
                }
            ],
        },
    )
    monkeypatch.setattr("app.api.stream.get_redis_client", lambda: redis)

    response = client.post(
        "/api/stream/source-failure",
        json={
            "video_id": "abcdefghijk",
            "mode": "proxy",
            "provider": "https://inv.example.test",
            "generation": 9,
            "reason": "stalled",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"recorded": False, "stale": True}
    redis.hincrby.assert_not_called()
