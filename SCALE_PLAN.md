# Scale-to-Millions Plan — Chhath Radio

> Goal: Support 1 M+ concurrent listeners with < 200 ms API latency, 99.9 % uptime, and zero-downtime deploys.

---

## 1. Current Bottlenecks (Baseline Audit)

| Layer | Current State | Problem at Scale |
|---|---|---|
| Presence tracking | In-memory dict in FastAPI process | Lost on restart; single-process only |
| Queue / Now-Playing | DB query on every poll | N × poll_interval DB hits |
| Listener count poll | Client polls `/api/presence` every 30 s | 1 M users = 33 k req/s |
| DB connections | SQLAlchemy default pool (5) | Pool exhaustion under load |
| Static assets | Served by Next.js dev server | No CDN, no edge caching |
| Deployment | Single Docker Compose on one host | No horizontal scaling |
| Logging / metrics | None | Blind in production |

---

## 2. Target Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Cloudflare / CDN Edge          │
                    │  (static assets, OG images, /share SSR)  │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │         Load Balancer (L7)               │
                    │   (AWS ALB / Nginx / Caddy cluster)      │
                    └──┬──────────────────────────────────┬───┘
                       │                                  │
          ┌────────────▼──────────┐        ┌─────────────▼──────────┐
          │  Next.js Edge / SSR   │        │  FastAPI Workers (N)    │
          │  (Vercel / Fly.io)    │        │  (Gunicorn + Uvicorn)   │
          └───────────────────────┘        └──────┬──────────────────┘
                                                  │
          ┌───────────────────────────────────────▼──────────────────┐
          │                    Redis Cluster                          │
          │  • Presence counters (INCR/DECR + TTL)                   │
          │  • Now-playing cache (5 s TTL)                            │
          │  • Queue cache (30 s TTL)                                 │
          │  • Rate-limit counters                                    │
          │  • Pub/Sub for SSE fan-out                               │
          └───────────────────────────────────────┬──────────────────┘
                                                  │
          ┌───────────────────────────────────────▼──────────────────┐
          │              PostgreSQL (Primary + Read Replicas)         │
          │  • PgBouncer connection pooler in front                   │
          │  • Read replicas for song catalog queries                 │
          └──────────────────────────────────────────────────────────┘
```

---

## 3. Phased Rollout

### Phase 1 — Quick Wins (0 → 10 k users, 1–2 days) ✅ DONE

- [x] **Replace presence polling with SSE** (`/api/events` stream)
  - Server-Sent Events push listener count + now-playing updates
  - Eliminates 33 k req/s polling at 1 M users
  - Single persistent connection per client
  - Implemented: `backend/app/api/events.py`
- [x] **Redis presence counters**
  - `INCR chhath:listeners` on connect, `DECR` on disconnect (with TTL heartbeat)
  - Survives worker restarts; shared across all workers
  - Implemented: `backend/app/services/presence_service.py`
- [x] **Redis now-playing + queue cache** (5 s / 30 s TTL)
  - Collapse N DB reads into 1 cache read per TTL window
  - Implemented: `backend/app/services/song_service.py`
- [x] **Gunicorn multi-worker** (`WEB_CONCURRENCY = 2 × CPU + 1`)
  - Uvicorn workers behind Gunicorn for true multi-process
  - Config: `backend/gunicorn.conf.py`
- [ ] **PgBouncer** connection pooler in Docker Compose
  - Pool size 20, transaction-mode pooling
- [ ] **Structured JSON logging** (structlog / python-json-logger)
  - Ship to Loki / CloudWatch for observability

### Phase 2 — Horizontal Scale (10 k → 100 k users, 1 week)

- [ ] **Kubernetes / ECS deployment**
  - HPA on CPU + custom metric (active SSE connections)
  - Separate Deployment for API workers and background scheduler
- [ ] **CDN for static assets**
  - Next.js output → Vercel or S3 + CloudFront
  - Cache-Control headers on `/share` OG images (1 h)
- [ ] **Read replicas for PostgreSQL**
  - Route `SELECT` queries to replica via SQLAlchemy `execution_options`
- [ ] **Rate limiting** (Redis sliding window)
  - `/api/request` (WhatsApp log): 5 req / min / IP
  - `/api/events`: 1 connection / IP (reconnect allowed)
- [ ] **Health checks + circuit breakers**
  - `/healthz` (liveness) and `/readyz` (readiness) endpoints
  - Tenacity retry + circuit breaker on DB/Redis calls

### Phase 3 — Global Scale (100 k → 1 M+ users, 2–4 weeks)

- [ ] **Redis Cluster** (3 primary + 3 replica shards)
  - Shard by key prefix (`chhath:*`)
- [ ] **SSE fan-out via Redis Pub/Sub**
  - Publisher: scheduler publishes `now_playing` events to Redis channel
  - Subscriber: each API worker subscribes and fans out to its SSE clients
  - Decouples event source from connection holders
- [ ] **Edge SSR / ISR for `/share` page**
  - Incremental Static Regeneration (60 s) for OG card pages
  - Serve from CDN edge, not origin
- [ ] **Observability stack**
  - Prometheus metrics (active connections, cache hit rate, DB latency)
  - Grafana dashboards
  - Sentry for error tracking
  - Uptime monitoring (Better Uptime / Checkly)
- [ ] **Chaos engineering**
  - Simulate Redis failure → graceful degradation (serve stale cache)
  - Simulate DB failure → serve cached queue, no crash

---

## 4. Critical Path Changes (Implemented)

### 4.1 SSE Endpoint — `GET /api/events`

File: [`backend/app/api/events.py`](backend/app/api/events.py)

```python
@router.get("/events")
async def sse_events(request: Request) -> StreamingResponse:
    """SSE endpoint — one persistent connection per client."""
    return StreamingResponse(
        _sse_stream(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

Event types emitted:
- `{"type": "listeners", "count": N}`
- `{"type": "now_playing", "song": {...}}`
- `{"type": "heartbeat", "ts": unix_timestamp}`

### 4.2 Redis Presence Service

File: [`backend/app/services/presence_service.py`](backend/app/services/presence_service.py)

Uses a Redis Set of session IDs with TTL-based expiry. Each session heartbeats every 30 s; sessions that miss two heartbeats are automatically evicted by Redis TTL.

Falls back to in-memory dict if Redis is unavailable (local dev without Redis).

### 4.3 Redis Queue Cache

File: [`backend/app/services/song_service.py`](backend/app/services/song_service.py)

```python
QUEUE_CACHE_KEY = "chhath:queue"
QUEUE_TTL = 30  # seconds

async def get_queue_cached(redis, db) -> list:
    cached = await redis.get(QUEUE_CACHE_KEY)
    if cached:
        return json.loads(cached)
    queue = await get_queue_from_db(db)
    await redis.setex(QUEUE_CACHE_KEY, QUEUE_TTL, json.dumps(queue))
    return queue
```

### 4.4 Gunicorn Config

File: [`backend/gunicorn.conf.py`](backend/gunicorn.conf.py)

```python
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "uvicorn.workers.UvicornWorker"
bind = "0.0.0.0:8000"
timeout = 120
keepalive = 5
max_requests = 1000
max_requests_jitter = 100
preload_app = True
```

---

## 5. Frontend Changes for Scale

### 5.1 Replace Polling with SSE Hook

The `ListenerCount` component currently polls every 30 s. At scale, replace with:

```typescript
// frontend/hooks/useRadioEvents.ts (future)
const es = new EventSource('/api/events');
es.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'listeners') setListenerCount(data.count);
  if (data.type === 'now_playing') setNowPlaying(data.song);
};
```

### 5.2 Next.js Performance

- Enable `output: 'standalone'` for minimal Docker image
- Use `next/image` with CDN domain for all artwork
- ISR (`revalidate: 60`) on `/share/[id]` pages
- Bundle analyzer to keep JS < 200 kB initial load

---

## 6. Infrastructure as Code (Future)

```
infra/
  terraform/
    main.tf          # AWS provider, VPC, subnets
    ecs.tf           # ECS cluster, task definitions, services
    rds.tf           # PostgreSQL RDS + read replica
    elasticache.tf   # Redis cluster
    alb.tf           # Application Load Balancer
    cloudfront.tf    # CDN distribution
    variables.tf
    outputs.tf
```

---

## 7. Load Testing Plan

```bash
# k6 load test — ramp to 10 k virtual users
k6 run --vus 100 --duration 30s \
       --stage 0:0,30s:1000,1m:10000,2m:10000,30s:0 \
       scripts/load_test.js
```

Target SLOs:
- P50 API latency < 50 ms
- P99 API latency < 200 ms
- SSE connection establishment < 500 ms
- Error rate < 0.1 %
- Throughput: 50 k req/s sustained

---

## 8. Cost Estimate (AWS, 1 M MAU)

| Service | Spec | Est. Monthly |
|---|---|---|
| ECS Fargate (API) | 4 tasks × 1 vCPU / 2 GB | $120 |
| RDS PostgreSQL | db.t4g.medium + 1 replica | $140 |
| ElastiCache Redis | cache.t4g.medium cluster | $80 |
| ALB | 1 LB + data processed | $30 |
| CloudFront | 10 TB transfer | $85 |
| Vercel (Next.js) | Pro plan | $20 |
| **Total** | | **~$475/mo** |

---

## 9. Immediate Action Items (This Sprint)

Priority order for implementation:

1. `backend/app/api/events.py` — SSE endpoint with Redis Pub/Sub ✅
2. `backend/app/services/presence_service.py` — Redis-backed presence ✅
3. `backend/app/services/song_service.py` — Redis queue cache layer ✅
4. `backend/gunicorn.conf.py` — Multi-worker config ✅
5. `docker-compose.yml` — Add Redis + PgBouncer services
6. `frontend/hooks/useRadioEvents.ts` — SSE hook replacing polling
7. `frontend/components/radio/ListenerCount.tsx` — Use SSE hook
8. `infra/terraform/` — IaC skeleton
9. `scripts/load_test.js` — k6 load test script
10. `backend/app/api/health.py` — `/healthz` + `/readyz` endpoints