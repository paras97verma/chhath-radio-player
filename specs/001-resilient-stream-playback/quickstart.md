# Playback Implementation Validation

Use deterministic fixtures before public-instance smoke tests. Report upstream measurements separately from app targets.

## Pre-change baseline (user-reported, 2026-11-04)

No resolver-start, media-source-assignment, or first-advancing-media-time trace was found in the current app. The timings below are user-reported click-to-play observations, not controlled resolver-to-first-progress measurements. OS/browser builds, engines, network profile, and repeated samples were not supplied; do not calculate or claim baseline p50/p95 from these reports.

This is a current problem-observation matrix, not a verified browser support/pass matrix.

| Platform and browser | Reported behavior | Evidence |
|---|---|---|
| macOS Chrome, Firefox, Zen, Dia | Usually 2–5s after selection; occasional skipped songs | User report; versions and engine/build details unavailable |
| macOS Safari | Often more than 30s; playback sometimes fails | User report; versions and engine/build details unavailable |
| iOS Safari, Chrome, Firefox | Often more than 30s; playback sometimes fails during simultaneous and sequential attempts | User report; versions and engine/build details unavailable |

For a comparable baseline, instrument selection, resolver start/end, source assignment, `canplay`, and first advancing `currentTime` separately. Record browser/OS build, engine, network profile, candidate mode, and sample count. Keep controlled-fixture measurements separate from live Invidious results.

## Prerequisites

Backend dependencies, test DB, Redis; frontend dependencies and Node.js >=20; Playwright Chromium/Firefox/WebKit; macOS and iOS devices with every named browser installed; controlled direct and local-proxy fixtures with range, MIME, latency, expiry, and failure variants.

## Automated checks

Backend: pytest tests/unit/test_stream_cache_service.py tests/unit/test_queue_prewarmer.py  
Frontend: npm run test:unit -- __tests__/unit/html5-audio-adapter.test.ts __tests__/unit/radio-store.test.ts __tests__/unit/stream-selector.test.ts __tests__/unit/piped-client.test.ts  
E2E: Playwright radio scenarios in Chromium, Firefox, WebKit. On latest stable macOS/iOS, smoke-run macOS Chrome/Firefox/Safari/Zen/Dia and iOS Safari/Chrome/Firefox; record OS, browser build, and actual engine for each.

## Resolver and expiry

1. Known, near, past, malformed, and absent signed expiry; verify 600s margin and 1800s unknown-expiry max.
2. Raw local=true proxy uses the selected audio itag, redirects; stored URL stays raw; validate MIME/range behavior.
3. Expire direct while proxy remains valid, then reverse; refresh independently and preserve valid alternate.
4. Unsupported MIME/codec and non-audio response produce no playable candidate.
5. Provider outage/rate limit produces explicit failure, retry schedule, and no stale-if-error.

## Cache and warming

1. Delay resolver A, force refresh on worker B, then release A; A commit rejected and no old generation returned.
2. Populate L1 on workers A/B, invalidate via A; B checks generation/fence before serving.
3. Delete cache/fence keys or restart Redis while L1 is populated; request misses/refreshes, old L1 never serves.
4. Redis unavailable bypasses L1 and marks warming degraded.
5. Fill L1 past capacity; verify bounded LRU/TTL.
6. Run catalog scan with additions and failures; every enabled item accounted, failures retained, heartbeat/lease stays alive.
7. Candidate deadlines control validity; Redis TTL only retention. Observe eviction, mismatch, stale-write rejection, and recache metrics; stale serve remains zero.
8. Set candidate refresh deadlines later than short test intervals; Redis record survives through each deadline plus grace, while reads reject the candidate at/after refresh_at.
9. Browser and Next responses are no-store; completed requests re-read authority; simultaneous requests may coalesce in-flight only.
10. Stale client failure report cannot demote shared candidate.
11. Mock Piped candidate; all layers reject it.
12. Delay or fail both configured Invidious origins; resolver returns HTTP 503 `stream_unavailable` within 5s without media preflight or hidden provider fallback.
13. Saturate catalog warming; per-origin request rate and concurrency remain within each enabled instance's configured limits.

## Playback

1. play/canplay/loadeddata without advancing currentTime never produce PLAYING or clear no-progress deadline.
2. Direct success reports PLAYING only after advancing media time.
3. Direct error or 5s without progress tries proxy immediately. Each candidate gets at most 5s for first progress; retries use bounded 1/2/4 schedule, and no recovery episode exceeds 20s from play/retry/stall detection.
4. waiting/stalled with no media-time advance for 5s recovers, preserves position if range seek works, then tries alternate; shorter waits do not trigger recovery.
5. Old event/report from request N cannot affect N+1.
6. Both candidates fail: queue index unchanged; Retry and Skip differ.
7. NotAllowedError stays on selected song and can be retried by user gesture.
8. Ignored preload does not set ready or claim seamless handoff.
9. Repeated load/swap/destroy leaves no listeners, timers, controllers.
10. Fake-clock scenarios reach first progress or terminal recovery within 20s; after the deadline no old source, listener, or timer can act.

## UI and browser matrix

1. Inspect resolving, playing, buffering/retrying, paused, unavailable, and empty states.
2. At 320px, 375px, tablet, desktop: no overflow; Retry/Skip and state remain visible.
3. Keyboard focus, accessible names, pressed/disabled states, reduced motion.
4. Select, play, pause, next, previous, seek, volume, MediaSession, background/foreground, end in all named macOS and iOS browsers; record each browser shell even where engines match.
5. Record selection-to-first-progress, resolution time, first byte if observable, canplay, candidate/provider, retries, terminal reason, queue index. Measure p50/p95 on fixtures; live upstream separately.

