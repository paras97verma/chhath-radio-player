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

## Follow-up audit: reported startup and WebKit failures

**Date**: 2026-11-05; audited clean `origin/main` at `aefc473`.

### Findings

1. `frontend/app/page.tsx` awaits a server queue fetch, passes `initialSongs` through `PageClient`, and `RadioPlayer` never reads that prop. `GlobalRadioProvider` separately fetches the queue, so the server-rendered route waits for unused data and startup repeats the queue request.
2. `GlobalRadioProvider` awaits `Html5AudioAdapter.initialize()`. `initialize()` then awaits a stream-metadata request for the first song before the provider installs the queue and marks the player ready. The stream route has a five-second backend timeout; the browser resolver itself has no timeout unless its caller supplies one. This serializes queue setup and metadata warmup before the player is usable.
3. `primeAudio()` marks interaction and calls `play()` on both elements with an empty WAV data URI. The real selected source is assigned only after `fetchInvidiousStream()` resolves, so the silent calls do not prove that Safari permits the later real `play()`.
4. `onWaiting()` immediately emits `BUFFERING`; `onPause()` and `onEnded()` are not scoped to the active request/source. A transient or late event can replace the active state. The five-second watchdog then swaps candidates if no media-time progress is observed.
5. The repository does not contain a captured direct/proxy response from the affected devices. iOS source range, MIME, redirect, and first-byte behavior remain unverified; do not attribute the whole Safari failure to the gesture path without device evidence.

### Decisions

- Remove the unused server queue fetch and its unused prop chain; keep the global provider as the single queue owner.
- Start first-song metadata warming without awaiting it. Keep at most one adapter-owned prepared candidate set for the initial/up-next song, validate candidate deadlines at selection, and consume it once. Use its source synchronously from the user's play gesture; do not persist it or store media bytes.
- Scope `pause`, `waiting`, `stalled`, `ended`, and progress events to the active request and source. A transient wait does not change UI state or switch candidates; recover only after five seconds without media-time progress.
- Preserve the selected song and the existing user-gesture Retry path on `NotAllowedError`. Record actual-device evidence separately before changing provider order or media transport.

### Primary documentation

- Apple documents that iOS disables preload/autoplay until user action and applies the rule to `<audio>` and `play()`/`load()`: [iOS-specific media considerations](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/Device-SpecificConsiderations/Device-SpecificConsiderations.html).
- Safari treats preload as a hint, and playback after a media source/track change still needs policy-aware handling: [Delivering video content for Safari](https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari).
- Apple's iOS media guidance requires byte-range support from media servers. Verify actual direct and proxy responses before assigning source-format/network causes: [Creating video for Safari on iPhone](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/CreatingVideoforSafarioniPhone/CreatingVideoforSafarioniPhone.html).

## Follow-up audit: all-track freshness and lock-screen retries

**Date**: 2026-11-05; rechecked clean `origin/main` at `aefc473` and playback branch through `c50968e`.

### Findings

1. `CatalogReconciliationService.is_song_warm()` currently returns true for any current candidate. `warm_song()` returns early on a current proxy, even if direct Google metadata is missing, expired, or due. The catalog status separately counts proxy readiness as `stream_ready`, so it can hide incomplete direct coverage.
2. Proxy metadata uses a conservative 1,800-second `refresh_at`, while the leader's full scan defaults to 3,600 seconds and runs only after the preceding whole-catalog pass. This permits proxy metadata to become unservable before the next scan. The full scan's fixed 0.5-second per-song delay also grows linearly over cache hits despite the shared origin limiter already pacing network misses.
3. `triggerCatalogPrewarm()` walks the browser's entire queue once per page and stores IDs in a page-lifetime `Set`. It has no expiry-aware refresh or retry and duplicates the backend's catalog-wide cache ownership.
4. `startPlayback()` calls `loadVideo()` when Media Session Play arrives during active playback or buffering; repeated OS/headset Play actions can restart or supersede the current track.
5. A browser cannot promise identical lock-screen controls on every OS. The W3C Media Session contract is capability-driven; Apple requires user initiated iOS audio playback and the user agent controls media policy. Keep action handlers feature-detected and distinguish app behavior from device evidence.
6. A forced refresh advances the generation fence before contacting upstream. That temporarily makes a still-valid cache record unreadable during the refresh and can add resolver latency to concurrent playback; failed refresh also needs an explicit path to preserve that valid generation.

### Decisions

- Treat a song as fully warm only when both source modes are current and outside a 900-second pre-refresh window. Keep a valid alternate playable but report the song degraded until the pair is repaired.
- Persist a per-video refresh deadline in a Redis sorted set. Schedule from `min(refresh_at) - 900s`; commit the cache payload, fence generation, and due score atomically, leaving the current valid generation readable while resolving. Process due records continuously, use bounded retries, and rebuild the index during catalog reconciliation. Let the shared origin limiter pace network misses; do not delay cache hits. No browser URL cache or media-byte cache.
- Remove the browser's one-shot all-queue sweep. Keep backend catalog warming as shared authority and the adapter's selected/next-song preparation for playback latency.
- Make lock-screen Play idempotent while the current song is playing or resolving. Keep Media Session state tied to actual adapter state and gracefully omit unsupported actions.
- Guarantee freshness only within configured upstream capacity and healthy providers. Report partial/missing/degraded coverage when upstreams or Redis fail; no cache can promise fresh metadata through an outage.

### Primary documentation

- The current W3C Media Session draft defines playback states and lets the user agent expose supported actions; `setActionHandler()` does not guarantee that every device presents every action: [Media Session](https://www.w3.org/TR/2026/WD-mediasession-20260605/).
- Apple documents that iOS disables preload/autoplay until user action, including `play()` and `load()` for audio: [iOS-specific media considerations](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/Device-SpecificConsiderations/Device-SpecificConsiderations.html).

