# Research: Resilient Stream Playback

**Date**: 2026-11-04

## Code path

RadioPlayer and queue selection → Zustand radio-store → Html5AudioAdapter → fetchPipedStream → Next.js /api/stream → FastAPI /api/stream → StreamCacheService/Redis → Invidious API. HTMLAudioElement fetches signed Google video URL in direct mode or Invidious local proxy in proxy mode. Next.js/browser also resolve providers directly, so backend is not the only authority.

## Failure causes observed

1. **False playback success hides stalls.** Adapter emits PLAYING on play/canplay/loadeddata and play() resolution; canplay clears watchdog. These precede media-time progress. waiting only updates UI; no bounded stalled recovery. Native retries can continue tens of seconds.
2. **Songs skip.** radio-store advances on first terminal ERROR for multi-song queues.
3. **Retry is inconsistent.** Candidate error advances immediately; one forced fresh resolution can occur afterward; no uniform 1/2/4 backoff or total deadline. Old callback checks are partial.
4. **Preload is falsely ready.** secondary src assignment sets preloadedSongId without canplay/progress; swap emits PLAYING before play/progress. Safari may ignore preload.
5. **Server probe controls all clients.** Probe uses backend network; generic exceptions return true. DEGRADED can put proxy first globally. One client's failure may flush/promote shared source.
6. **Mode changes on recache.** Resolver selects first currently healthy Invidious instance and builds a new candidate set. Probe changes aggregate url/status; cooldown/order changes provider. Aggregate status and sources[] compete for ordering; no per-mode merge identity.
7. **Expiry differs by layer.** One aggregate expires_at, fixed 4h Redis TTL, 10m margin, and 5m L1 TTL. Reads inspect aggregate URL only. Unknown-expiry candidates inherit the 4h record TTL because CONSERVATIVE_TTL is unused, instead of the intended 30m metadata age. Proxy may hide signed redirect expiry; direct expiry can also shorten proxy retention.
8. **Stale URL caches multiply.** Backend L1 unbounded; Next/browser each cache 15m. They inspect aggregate URL with 60s margin, not every candidate/generation. Flush/force refresh only clear process-local maps and Redis key.
9. **Cold resolution adds serial probe latency.** After Invidious metadata, proxy redirect pre-resolution can wait up to 4s, then direct accessibility probe can wait up to 2s. Both run synchronously in series before returning a candidate, even though neither proves listener reachability. Extractor retries can add more seconds. This matches 2–5s cold starts on desktop.
10. **Flush race.** Flush deletes record and lock without fencing active work. Delayed resolver can SETEX after invalidation. Lock TTL is 8s while extraction/retry/probe may take longer.
10. **Warmer false status and lost retry.** force=True does not reach resolver; warm check trusts TTL/aggregate URL. Priority queue pops before warming and drops failures. Sync priority work runs on async leader loop. 30s leader lease is not renewed during awaited scan.
12. **Provider policy bypass.** Piped appears in backend, Next, and browser lists; lists differ. Next/browser fallback bypasses shared cache and validation when API fails.
13. **Codec/platform gap.** Backend favors AAC but may choose first adaptive format. Client may fall back to unsupported stream; aggregate status can override mode. Playwright config covers Chromium only; no physical iOS gate.
14. **UI lacks recovery.** Current dark glass player has controls, but terminal error is a top strip without selected-song Retry/Skip. Loading/buffering/retrying are not distinct. Inline controls risk mobile crowding; focus/reduced-motion treatment is not centralized.
15. **Keep current strengths.** MediaSession, AbortControllers, request IDs, listener cleanup, startup reconciler, write-time enqueue. Refactor and test these.

## Decisions

### Provider boundary

One backend registry owns configured Invidious instances, health/cooldown, and limits. Remove Piped and provider API fallbacks from Next/browser. Direct mode is an Invidious-returned signed URL, often Google-hosted. Proxy is raw /latest_version endpoint with local=true and the selected compatible audio itag. App owns no media relay/CDN or audio bytes.

### Invidious semantics

Current Invidious source says /videoplayback links expire after six hours and /latest_version redirects to latest rendition. Current route handles local=true; docs describe adding it for proxy-video behavior. Preserve raw endpoint; test redirect, range, MIME per configured instance. Sources: [Invidious playback route](https://github.com/iv-org/invidious/blob/master/src/invidious/routes/video_playback.cr), [proxy-video docs](https://docs.invidious.io/proxy-videos/).

### Candidate/cache

Each candidate has mode, provider, MIME/codec, resolved_at, expires_at, refresh_at, validation. Signed expiry margin 600s; unknown-expiry max age 1800s. Redis TTL is retention only. Validate each mode independently. Retain valid alternate only in current generation.

### Fencing

Redis candidate record plus separate non-expiring per-song fence key (generation and unique token). Refresh/eviction advances generation, rotates token, and fences/removes the record atomically. Resolver captures both before upstream work; CAS commit only if the expected token still exists and matches. Redis restart/key eviction means miss; a new token invalidates L1 and old writers cannot recreate the fence. Every L1 hit needs Redis and generation/token match; else miss. Next/browser have no persistent URL cache; HTTP no-store. No stale-if-error.

### Warming

Keep startup full scan and write-time enqueue. Evaluate all enabled songs; resolve only missing/due. Ack priority item after success; failures use bounded 1m/5m/15m/60m backoff with jitter. Renew catalog/per-song leases independently; blocking work in threads; bounded concurrency/pacing. Redis failure means degraded readiness.

### Playback

Keep HTMLAudioElement and MediaSession. Separate ready/buffering/playing/waiting/retrying/failed. PLAYING requires unpaused media-time advancement. One request generation owns candidate, listeners, timers, controller. Each candidate gets at most 5s for first progress; direct error/no-progress moves immediately to proxy. After starting, waiting/stalled triggers recovery only after 5s without media-time advancement; bounded 1/2/4 retries, max three per episode, under a 20s deadline from play/retry/stall detection. Probe diagnostic only. Client failure telemetry cannot mutate shared health.

### UI

Keep dark saffron/glass language; improve hierarchy, spacing, focus-visible, tactile controls, responsive layout. Separate status/transport presentation from audio lifecycle. Show title/artist/progress/state, Retry/Skip on terminal failure, restrained equalizer during play, reduced-motion alternative. Fit 320px; presentation rerenders do not recreate audio.

## Limits

Public instance capacity, Google delivery, regional latency, browser restrictions remain external. Report live results separately from fixtures. No rights asserted.

