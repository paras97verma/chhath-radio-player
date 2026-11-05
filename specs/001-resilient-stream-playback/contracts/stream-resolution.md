# Contract: Stream Resolution

## Resolve metadata

GET /api/stream?v={videoId}&priority={high|normal}&force_fresh={true|false}

Next.js route forwards to FastAPI only. It never resolves providers or caches resolved URLs. Both layers set Cache-Control: no-store, max-age=0.

Response contains schema_version `1`, video_id, positive generation, refreshed_at, sources, and temporary compatibility fields derived from validated sources. The API returns unavailable when a current fenced response cannot be produced; it never manufactures a generation `0` legacy response. Each canonical source includes mode (direct|proxy), provider/provider origin, url, itag, MIME/codec, resolved_at, expires_at, refresh_at, and validation_state. No candidate except configured Invidious.

Legacy cache records are migrated only after every retained candidate passes the current source validator. Migration writes schema version `1` under the same live generation/fence and persists only canonical candidates plus non-URL descriptive metadata; aggregate URL compatibility fields are generated for the response and are not stored. Records with no valid candidate or an unsupported schema are deleted with a compare-and-delete against the exact observed Redis value, then treated as a cache miss.

Direct url is the signed audio URL returned by Invidious and may be Google-hosted. Proxy url remains raw Invidious latest-version local endpoint and uses the same selected compatible audio itag. Redirect target is transient and never persisted.

On cache miss, resolve from at most two configured Invidious origins under a 5s total resolver deadline. Do not preflight signed media URLs or follow proxy redirects before returning metadata. A deadline exhaustion returns HTTP 503 with `{"error":"stream_unavailable","retryable":true}`; no hidden Next.js/browser provider fallback continues afterward.

Client accepts only current candidates within own expiry/refresh deadline and with a MIME type supported by the current audio element. Unsupported source is excluded, never selected as last resort.

Every cache hit validates generation/fence and each candidate. Redis miss/eviction/restart/unavailability cannot use unverified L1. If no current source resolves, return explicit unavailable; no stale-if-error.

## Client failure

POST /api/stream/source-failure

Payload: video_id, mode (direct|proxy), provider, positive generation, reason (1–120 characters). Validate fields. Record aggregate telemetry by mode only when the report generation matches the current nonzero cached generation; ignore stale or legacy generation reports. This endpoint never flushes cache, promotes proxy, or mutates source readiness. Return `Cache-Control: no-store, max-age=0` for stream resolution responses, including unavailable responses.

## Invalidation

Candidate refresh validates/carries forward a still-valid alternate into the new generation. Explicit flush/eviction increments generation, rotates fence, and deletes the record. Resolver commit compares captured fence. Worker L1 records carry generation/fence and are rejected on mismatch. Browser/Next keep in-flight coalescing only; responses use no-store.

## Catalog readiness

Report enabled/examined/fresh counts, both/direct-only/proxy-only/unavailable, overdue/oldest age, last complete cycle, priority retries, generation mismatch, stale-write rejection, eviction/miss, and stale/expired serve counts. Stale/expired serve must stay zero.

