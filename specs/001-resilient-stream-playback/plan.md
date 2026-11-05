# Implementation Plan: Resilient Stream Playback, Cache Warming, and Player UX

**Branch**: 001-resilient-stream-playback | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

## Summary

Use one configured Invidious resolution path and two explicit candidate modes. Remove Piped/provider fallbacks from browser and Next.js. Store expiry per candidate. Fence cache refresh/invalidation across Redis and worker L1; remove long-lived URL caches. Make media progress the only playback success signal; stop source failure auto-skip. Keep catalog warming independent with durable retries and renewed leases. Add accessible, responsive recovery UI without coupling visual rerenders to audio lifecycle.

Direct mode is an Invidious-returned signed URL and may use Google delivery. Proxy mode uses Invidious local playback. No app-owned CDN, media relay, or audio-byte storage.

## Technical Context

**Language/Version**: Python 3.x; TypeScript, Node.js >=20.

**Primary Dependencies**: FastAPI, SQLAlchemy, Redis; Next.js 16, React 19, Zustand, HTMLAudioElement; pytest, Vitest, Playwright.

**Storage**: PostgreSQL catalog; Redis stream metadata and warmer queues; worker-local bounded L1 metadata only.

**Testing**: pytest, Vitest, Playwright Chromium/WebKit, and release smoke runs in every named macOS and iOS browser.

**Target Platform**: Latest stable macOS/iOS at release time: Chrome/Safari/Zen/Dia on macOS and Safari/Chrome on iOS. Record OS, browser build, and actual engine for every release smoke run; shared engine does not replace checking the named browser shell.

**Performance Goals**: Controlled fixtures: warm selection-to-first-progress p95 <2s; cold resolver p95 <5s when resolver ≤500ms and source first byte ≤100ms. Live Invidious measured separately; no public-upstream SLA.

## Release evidence — 2026-11-05

**Release readiness: NOT READY.** The available fixture and cache tests do not cover the required manual macOS/iOS browser evidence or a live Redis deployment. No live Invidious latency or release-level performance claim is made.

The opt-in Playwright measurement (`PLAYBACK_PERF=1`, `radio.spec.ts`, 20 samples per engine) ran against the local Next.js dev server. The selected song title was visible before the Start gesture; the audio mock advanced `currentTime` synthetically. The `/api/stream` request was intercepted in the browser and returned fixture metadata. Resolver duration is fetch start to response headers. These values describe the deterministic browser fixture only; they exclude real media bytes and upstream extraction.

| Engine | Samples | Selected-title-visible → synthetic first progress p50 / p95 | Mocked resolver HTTP p50 / p95 |
|---|---:|---:|---:|
| Chromium | 20 | 46.5 ms / 54.6 ms | 3.6 ms / 7.4 ms |
| WebKit | 20 | 53.0 ms / 70.0 ms | 11.0 ms / 23.0 ms |

Browser evidence: the full Playwright suite passed in Chromium and WebKit (`38 passed, 4 skipped`, 1.1m). The radio recovery, responsive-state, and facts ticker scenarios passed in both engines. The separate opt-in timing run passed (`2 passed`, 50.6s; 20 samples per engine). The two authenticated admin-toggle cases skipped because no test admin account was provisioned. All six named macOS/iOS smoke rows in `quickstart.md` remain `Not run`.

Cache and worker evidence: the focused stream-cache and queue-prewarmer suites passed (`57 passed`, 1.32s), including in-memory `FakeCacheRedis` fence/invalidation cases and catalog lease renewal; stream API tests passed (`7 passed`). No `redis-server` or `redis-cli` is installed, so no live Redis cache latency, restart, eviction, or multi-worker run was measured. These tests establish code-level behavior under the fakes, not production Redis performance.

Do not treat the fixture p50/p95 as satisfying SC-001/SC-002: the first-progress event and resolver response are synthetic, with no controlled media-byte source. Revisit readiness after all manual browser rows are recorded and cache behavior is exercised against the release Redis configuration.

**Constraints**: Configured Invidious resolution only; no Piped or unrelated providers. Direct Invidious result may be Google-hosted. No owned CDN/audio relay/media bytes, no stale-if-error, no unverified local cache, no rights claim. Bound public-instance request rates.

**Scale/Scope**: All enabled catalog songs; write-time additions/changes; refresh only missing/due candidates. UI changes limited to radio player.

## Constitution Check

The checked-in constitution contains template placeholders only and no enforceable principles. No normative conflict identified. No new media service or audio storage.

## Repository Findings

Playback chain: RadioPlayer → radio-store → Html5AudioAdapter → fetchPipedStream → Next.js route → FastAPI → StreamCacheService/Redis → Invidious. Media bytes then come from signed Google URL (direct) or Invidious local proxy.

- Browser client has a 15-minute URL map. Next.js route has another 15-minute map and resolves providers itself on backend failure. Browser directly resolves providers if same-origin fails. These bypass shared generation/expiry policy.
- Backend and fallback lists include Piped and do not agree. Extractor’s DEGRADED/server probe can choose proxy globally even though listener network may reach direct URL.
- Generic server probe exception returns true. One listener’s source report may globally flush/demote candidate.
- Proxy redirect is followed and the final short-lived delivery URL is persisted as proxy, bypassing the raw latest-version refresh endpoint.
- Cache stores aggregate url/status and expires_at. Redis TTL is fixed at 4h, L1 TTL is 5m without a capacity bound; reads validate only aggregate url. Unknown-expiry candidates inherit the 4h record TTL because the intended 30m conservative max age is unused.
- Force refresh/flush has no generation fence; it deletes the active lock. A late resolver can repopulate a superseded entry. Lock TTL is 8s, shorter than bounded extractor retries/probes.
- Warmer force does not reach resolver; readiness trusts TTL/aggregate url. Queue pops before warm and drops failures. Sync priority work runs on event loop; 30s leader lease is not renewed during long cycle.
- Adapter emits PLAYING on play/canplay/loadeddata and play() resolution. canplay clears watchdog and watchdog accepts currentState PLAYING. waiting has no bounded recovery; no stalled listener. These paths let native Safari retries run for tens of seconds.
- Store advances queue after first terminal ERROR on multi-song queue. This explains silently skipped tracks.
- Preload marks ready after src assignment, then swaps and emits PLAYING before playback progress. Safari may ignore preload.
- Codec selector falls back to formats even if canPlayType rejects them. Candidate ordering also uses aggregate status. Playwright config only has Chromium.
- Player has dark glass styling and controls but no selected-song Retry/Skip. Error is a narrow top strip; resolving/buffering/retrying/failure states and narrow-screen controls need explicit UX.
- Keep existing MediaSession, AbortControllers, request IDs, listener cleanup, startup reconciler, write-time enqueue.

## Architecture

### Provider and media boundary

1. One backend-configured Invidious registry owns origins, health/cooldown, and per-origin rate/concurrency budgets. Every enabled origin must define requests-per-second and maximum concurrency; missing limits disable it. Cache-miss resolution tries at most two origins under a 5s total deadline. Next route only forwards metadata; browser never calls provider APIs.
2. Backend returns only direct and proxy candidates. Direct is current Invidious adaptive audio URL (often Google-hosted); proxy is raw Invidious latest-version local endpoint for the selected compatible audio itag. Never persist proxy redirect target.
3. Candidate provider and MIME/codec are explicit. Remove media redirect pre-resolution and direct URL reachability probes: neither proves listener reachability and both delay the response. Browser outcome controls session ordering. No global mode inferred from DEGRADED or URL substring.
4. Reject Piped/unknown provider response at backend, Next route, and browser selection. Compatibility fields are derived from validated sources only during migration.

### Cache freshness and production coherence

1. Candidate record and per-song fence are separate Redis keys. Fence key stores generation and unique token; it does not expire. Cache reads require a present fence and matching record generation/token. Missing fence/cache is a miss. Token is authoritative after Redis restart/key loss.
2. Candidate refresh increments generation and rotates token, then commits the refreshed candidate plus any still-valid alternate under compare-and-set. Explicit eviction/flush increments generation, rotates token, and removes the candidate record. Resolver captures generation/token before upstream work. The renewable single-flight lease outlives the bounded resolver deadline; release only owned locks and never delete a live lock to force work.
3. Redis is authoritative. Worker L1 is bounded TTL/LRU. Every hit requires Redis availability, a present fence matching generation/token, and candidate freshness. Redis unavailable means bypass L1; eviction/restart is a miss. A resolver commit requires its expected token to exist and match, so a pre-restart writer cannot recreate lost authority.
4. Known direct expiry uses 600s margin. Unknown-expiry candidate expires at 1800s metadata age. Proxy raw endpoint refresh deadline is ≤1800s or stricter provider deadline. Candidate deadlines are authoritative; Redis TTL cannot override validity and is sized to extend beyond the latest candidate refresh deadline by bounded grace (1h; 24h cap). If a supported candidate deadline would exceed the cap, clamp its refresh deadline so retention cannot truncate its declared warm window.
5. On candidate refresh, revalidate and copy any valid alternate into the new generation; drop expired candidates. Explicit eviction removes both modes. Never use stale-if-error or prior-generation fallback.
6. Remove browser/Next completed-response URL caches. Coalesce simultaneous in-flight requests only. FastAPI and Next set Cache-Control: no-store.
7. Expose generation mismatch, stale-write rejection, eviction/miss, expiry, refresh result, per-mode readiness, overdue age, stale/expired serve counters. Stale/expired serves must remain zero.

### Independent warmer

1. Startup scan covers all enabled catalog songs. Each recurring pass accounts for every song, but resolves only missing/due candidates.
2. New/changed song enqueue is idempotent. Acknowledge priority work only after success. Failures enter due-time retry queue with 1m/5m/15m/60m capped backoff and jitter.
3. force=True reaches actual resolver. Success requires current generation and a valid candidate.
4. Use renewable catalog and per-song leases. Renew catalog lease in independent heartbeat during full scan. Run synchronous resolution in worker threads with bounded concurrency and pacing.
5. Redis loss marks warmer degraded; never claim catalog warm from L1 or TTL alone.

### Playback state machine

1. Request generation owns selected song, active audio element, candidate ID, AbortController, listeners, timers, and retry budget. All callbacks validate identity; cleanup on replace/swap/destroy.
2. Explicit candidate ordering direct then proxy, filtered by actual canPlayType. Unsupported candidates are excluded, never last-resort selected.
3. Separate resolving, ready, buffering, playing, waiting, retrying, failed. PLAYING requires unpaused currentTime advancement. canplay means readiness only.
4. Instrument resolver start, media source assignment, canplay, first progress, waiting/stalled, retries. Each candidate gets at most 5s to first progress; direct error/no-progress moves immediately to proxy. After playback starts, waiting/stalled triggers recovery only if media time has not advanced for 5s. Automatic retries use 1/2/4s backoff, max three per recovery episode, all inside a 20s deadline from play/retry/stall detection. Prevent native browser retry from hanging indefinitely.
5. waiting/stalled recovery clears only after time advances. Preserve seek position if range behavior permits.
6. Start, manual next/previous, retry, and resume originate in user gesture. Autoplay rejection retains selection and exposes gesture retry. End-of-track continuation is separate from error path.
7. Preload is a hint. Secondary source is ready only after readiness and actual progress; otherwise use regular load path. No seamless claim based on src alone.

### Player UI

1. Isolate status and transport presentation components; keep audio adapter and media element lifecycle outside presentation-only rerenders.
2. Show title/artist/art, progress, explicit state, play/pause, next/previous, volume, playlist. On terminal failure, expose Retry same song and explicit Skip.
3. Preserve dark saffron/glass direction with stronger hierarchy, spacing, contrast, focus-visible and pressed states, constrained playing equalizer, and reduced-motion alternative.
4. Fit 320px mobile through desktop without overflow. Preserve keyboard controls, screen-reader names, and MediaSession metadata/actions. Do not redesign unrelated screens.

## Design Documents

See [data-model.md](data-model.md), [contracts/stream-resolution.md](contracts/stream-resolution.md), and [quickstart.md](quickstart.md).

## Implementation Phases

### Phase 0 — Baseline and deterministic fixtures

Capture state timings and failing behavior. Fixtures cover expiry, direct/proxy, raw local endpoint redirect/range/MIME, cache races, Redis loss, provider rejection, media events, and queue index.

### Phase 1 — Source contract and one resolver

Add versioned candidates and canonical Invidious registry. Remove Piped and provider API fallback from Next/browser while retaining direct as a valid playback mode. Next route is no-store metadata pass-through. Keep legacy response fields only during migration.

### Phase 2 — Cache coherence and warming

Implement independent expiry, Redis generation/fence, conditional writes, bounded L1, no-store, safe eviction/recache. Fix force warming, retry queue, pacing, leases, event-loop blocking, and readiness metrics.

### Phase 3 — Playback correctness

Progress-only PLAYING, bounded startup/stall recovery, request-generation cleanup, codec filtering, direct-to-proxy failover, no auto-skip, visible selected-song failure. Verify gesture and MediaSession paths.

### Phase 4 — Player UX

Responsive accessible state/recovery UI, Retry/Skip, state-selector isolation, reduced motion, visual/browser scenarios. Keep unrelated UI untouched.

### Phase 5 — Release validation

Unit/contract tests; two-worker Redis races; warmer cycles; Playwright Chromium/WebKit; smoke runs in macOS Chrome/Safari/Zen/Dia and iOS Safari/Chrome. Record OS/browser build/engine and first-progress metrics by browser/mode. Release gates: zero stale serves, zero error auto-skips, 320px no overflow, fixture targets met.

## Project Structure

Backend: backend/app/services/stream_cache_service.py, queue_prewarmer.py, song_service.py, backend/app/api/stream.py; tests in backend/tests/unit/.

Frontend: frontend/app/api/stream/route.ts, frontend/lib/piped/piped-client.ts, frontend/lib/audio/types.ts, frontend/lib/piped/stream-selector.ts, frontend/lib/audio/html5-audio-adapter.ts, frontend/lib/radio-store.ts, frontend/components/radio/RadioPlayer.tsx, frontend/playwright.config.ts; tests in frontend/__tests__/.

Feature docs: specs/001-resilient-stream-playback/{spec.md,plan.md,research.md,data-model.md,quickstart.md,contracts/stream-resolution.md,tasks.md}.

**Structure Decision**: Keep existing app boundary. Add no audio-serving service, media store, or owned CDN.

## Constitution Re-check

No normative constitution content. Scope adds no audio persistence or owned delivery infrastructure.

## Complexity Tracking

No constitution violation or new runtime service; extend current cache and reconciler.

## Cross-Session Task Execution and Recovery

This policy governs implementation handoff; it does not add runtime product behavior.

- `tasks.md` is the single source of completed-task status. `RESUME.md` records the in-progress task and recovery point.
- Use one writing session per checkout. Stop the previous writer before another session edits the same working tree.
- Before editing a task, checkpoint its ID, last completed step, and exact next action. After each coherent file group and before and after long test/build commands, record changed files, completed work, actual commands/results, and the next action.
- After interruption, inspect `git status --short`, staged and unstaged diffs, and the task's relevant files, including untracked files. Reconcile the checkpoint with `tasks.md`; preserve valid partial work and continue at the first unmet criterion. Do not repeat the broad repository audit.
- Mark a task complete only after its criteria and required validation pass. Leave interrupted or externally blocked tasks open, record the blocker, and continue independent tasks only when dependencies allow.
- When no tasks remain, verify the release evidence in T037 and mark the checkpoint complete. If the checkout changes between accounts or machines, sync the repository state before resuming.

## Follow-up plan: startup latency and WebKit recovery

The current source audit identifies three app-controlled fixes. First, remove the unused queue fetch awaited by the server page and make adapter metadata warming non-blocking, so route rendering and player readiness do not wait on a source lookup. Second, retain a single adapter-owned prepared candidate set for the initial/up-next song; revalidate its source deadlines and consume it once so a ready source can be assigned and played directly from the user's gesture. This is bounded playback preparation, not a persistent URL cache. Third, scope media events to the active request/source, and defer buffering/recovery transitions until media time has stopped advancing for five seconds.

The Safari gesture path is a code-level hypothesis supported by the current async call sequence and Apple's documented iOS policy. Actual direct/proxy range responses and the user's affected browser builds are unavailable in this checkout, so device confirmation remains under T036. Keep resolver time, source response/redirect/range/MIME, `play()` rejection, and first media-time advance separate in the smoke record. Do not change provider order or add a media relay based on the current evidence.

Implementation order: T038 startup request removal and non-blocking warm; T039 event scoping and progress-based buffering; T040 one-shot prepared-source use from the gesture. These touch the shared adapter and therefore run serially. MVP: all three US1/US3 follow-up tasks; T036's six named shell runs remain a release gate.

## Follow-up plan: durable catalog freshness and system controls

The latest requirement audit found that current warm semantics and schedule do not meet all-track freshness: a proxy-only record is considered warm, the 30-minute proxy deadline can pass between hourly scans, and the browser's one-time catalog sweep neither tracks candidate deadlines nor retries. Repair in this order:

1. Define complete warmth as both direct and proxy candidates current and more than 900 seconds from `refresh_at`. Report partial/degraded coverage distinctly while preserving valid alternate playback.
2. Add a Redis sorted set keyed by video ID, scored at the earliest candidate `refresh_at - 900s`. Cache writes and warm catalog reads seed/update the score; cache payload, generation fence, and due score commit atomically. A due worker processes it every loop with fenced single-flight resolution and bounded retry while the prior still-valid generation remains readable. Failed refreshes leave that generation intact and move the next attempt to a backoff deadline; invalidation wins against an in-flight writer. Keep full reconciliation as recovery for lost due-index entries; actual upstream traffic remains governed by configured per-origin rate and concurrency limits.
3. Remove the browser's one-shot all-queue sweep; backend cache remains shared owner. Keep one selected/up-next candidate slot for immediate playback.
4. Make Media Session Play idempotent during PLAYING/BUFFERING and keep controls/state consistent with the active song. Device/OS support remains feature-detected and must be recorded per shell.

Do not claim literal Spotify parity or always-warm behavior during provider/cache outage. The release target is full pair coverage when configured upstream capacity is sufficient, zero expired-candidate serves, bounded retries when it is not, and no app-generated reload on duplicate system Play. **T041–T045** are the follow-up tasks; T036 remains the device evidence gate.

