"""Validate Layerbase Redis connectivity and the commands required by the app."""

import os
import uuid
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
        or parsed.path not in ("", "/", "/0")
        or not parsed.username
        or not parsed.password
    ):
        raise SystemExit(
            "REDIS_URL must be a credentialed rediss:// Layerbase host on database 0 and port 6379."
        )

    client = redis.Redis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=15,
        socket_timeout=15,
        health_check_interval=30,
        ssl_cert_reqs="required",
        ssl_check_hostname=True,
    )
    prefix = f"chhath:preflight:{uuid.uuid4().hex}"
    string_key = f"{prefix}:string"
    hash_key = f"{prefix}:hash"
    sorted_set_key = f"{prefix}:zset"
    list_key = f"{prefix}:list"
    script_key = f"{prefix}:script"
    keys = [string_key, hash_key, sorted_set_key, list_key, script_key]
    stage = "TLS connection and PING"

    try:
        if not client.ping():
            raise RuntimeError("PING returned false")

        stage = "SET/GET/SETEX"
        client.set(string_key, "value", ex=60)
        if client.get(string_key) != "value":
            raise RuntimeError("string round trip mismatch")
        client.setex(f"{prefix}:setex", 60, "value")
        keys.append(f"{prefix}:setex")

        stage = "hash operations"
        client.hset(hash_key, mapping={"count": "1", "label": "probe"})
        if client.hincrby(hash_key, "count", 1) != 2:
            raise RuntimeError("hash increment mismatch")
        if client.hget(hash_key, "count") != "2" or client.hgetall(hash_key).get("label") != "probe":
            raise RuntimeError("hash read mismatch")
        client.expire(hash_key, 60)

        stage = "sorted-set operations"
        client.zadd(sorted_set_key, {"probe": 1})
        if client.zrangebyscore(sorted_set_key, 0, 2) != ["probe"]:
            raise RuntimeError("sorted-set range mismatch")
        if client.zscore(sorted_set_key, "probe") != 1:
            raise RuntimeError("sorted-set score mismatch")
        client.zrem(sorted_set_key, "probe")
        client.expire(sorted_set_key, 60)

        stage = "list operations"
        client.lpush(list_key, "probe")
        if client.rpop(list_key) != "probe":
            raise RuntimeError("list round trip mismatch")
        client.expire(list_key, 60)

        stage = "Lua fencing and lease operations"
        client.set(script_key, "owner", ex=60)
        script = """
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            redis.call('SET', KEYS[1], ARGV[2])
            return redis.call('PEXPIRE', KEYS[1], ARGV[3])
        end
        return 0
        """
        if client.eval(script, 1, script_key, "owner", "committed", 60000) != 1:
            raise RuntimeError("Lua compare-and-lease mismatch")
        if client.get(script_key) != "committed":
            raise RuntimeError("Lua write mismatch")

        stage = "transactional pipeline"
        with client.pipeline(transaction=True) as pipe:
            pipe.hincrby(hash_key, "count", 1)
            pipe.hset(hash_key, "pipeline", "ok")
            pipe.execute()
        if client.hget(hash_key, "count") != "3" or client.hget(hash_key, "pipeline") != "ok":
            raise RuntimeError("pipeline round trip mismatch")

        stage = "SCAN"
        if string_key not in set(client.scan_iter(match=f"{prefix}:*", count=20)):
            raise RuntimeError("scan did not return the temporary key")

    except Exception as exc:
        raise SystemExit(
            f"Layerbase Redis cache smoke failed during {stage} for {host} ({type(exc).__name__})."
        ) from None
    finally:
        try:
            client.delete(*keys)
        except Exception:
            # All temporary keys have 60-second TTLs; cleanup is best-effort.
            pass
        client.close()

    print(f"Layerbase Redis cache smoke passed for {host}: PING, strings, hashes, sorted sets, lists, Lua, pipeline, and SCAN.")


if __name__ == "__main__":
    main()
