# Feature Specification: Resilient Stream Playback, Cache Warming, and Player UX

**Feature Branch**: 001-resilient-stream-playback  
**Created**: 2026-11-04  
**Status**: Draft

## Goal and boundaries

Fast, recoverable playback across macOS Chrome, Firefox, Safari, Zen, and Dia, and iOS Safari, Chrome, and Firefox. Resolve stream metadata through configured Invidious instances only. Support two modes: direct Invidious-provided audio URL and raw Invidious proxy endpoint. Keep metadata warm without storing audio bytes or adding an app-owned audio relay, CDN, or media server.

“Direct Invidious” means the URL comes from Invidious; its media bytes may come from Google video delivery. Proxy mode uses Invidious local playback. Public upstream availability and latency remain outside app control. This plan does not establish streaming rights.

## User stories

### US1 — Start and continue selected song reliably (P1)

Listener selects, plays, pauses, seeks, advances, or resumes. Selected song remains selected until both source candidates have been attempted under bounded recovery.

**Acceptance scenarios**

1. Try fresh direct first, without waiting for an unrelated backend probe.
2. Direct failure or no-progress timeout tries raw Invidious proxy.
3. PLAYING requires advancing media time; play(), play, canplay, loadeddata, and play() resolution alone do not count.
4. Terminal failure preserves queue index and exposes Retry and Skip.
5. Old events, timers, and resolver results cannot affect a newer selection.
6. Each first-progress candidate attempt is capped at 5s; recovery ends within 20s of play, retry, or detected stall. Retry is bounded with 1s/2s/4s backoff where same-candidate retry is appropriate.
7. User actions retain explicit gesture handling, including WebKit restrictions.
8. After playback starts, waiting/stalled with no media-time advancement for 5s triggers recovery; transient waiting that clears sooner does not.

### US2 — Keep catalog source metadata warm (P1)

Background service scans every enabled song at startup and recurring cycles. It refreshes missing/due candidates independently of playback. New or changed song IDs enter priority warming immediately.

**Acceptance scenarios**

1. Every enabled song is accounted for as fresh, refreshed, or failed/overdue at cycle completion.
2. Direct and proxy deadlines are independent; refresh does not discard valid alternate.
3. Failed work remains scheduled; new-song priority work is not lost.
4. Redis loss/eviction/restart is a miss; no stale browser, Next.js, L1, or Redis record serves without validation.
5. Admin status reports mode freshness, failures, overdue age, cycle, and cache-coherence counters.
6. Redis record retention extends beyond candidate refresh deadlines; expiry validation still prevents an overdue candidate from being served.

### US3 — Consistent platform behavior (P1)

Same playback states and recovery contract across the named macOS and iOS browser shells. Codec selection respects actual browser capability; each shell is smoke-run even when it shares an engine.

**Acceptance scenarios**

1. Run direct, proxy, no-progress, stall, pause/resume, end, and background scenarios across browser matrix.
2. Preload is a hint; secondary element is ready only after observed readiness and actual progress.
3. Autoplay rejection is visible and retryable from a user gesture.
4. Record resolver time, first response where observable, canplay, first media-time advance, fallback, and terminal result separately.

### US4 — Clear, responsive player experience (P2)

Listener can identify resolving, buffering, playing, paused, retrying, and unavailable states and recover without losing selected song.

**Acceptance scenarios**

1. Distinct loading, buffering/retrying, playing, paused, unavailable, and empty states.
2. Unavailable state exposes accessible Retry and Skip; Retry preserves queue position.
3. Controls have keyboard focus, screen-reader labels, tactile states, and reduced-motion alternatives.
4. Layout works from 320px through desktop without overflow or control collision.
5. Presentation rerenders do not recreate or reset audio elements.

## Functional requirements

- **FR-001**: Model direct and proxy as separate candidates with provider, format, resolved time, expiry, refresh deadline, and validation state.
- **FR-002**: Preserve valid alternate during one-mode refresh; never equate the modes.
- **FR-003**: Parse expiry per candidate; refresh 600s before known expiry. Unknown-expiry metadata max age 1800s.
- **FR-004**: Keep raw Invidious latest-version endpoint as proxy, using the selected compatible audio format’s itag; never persist redirect target as proxy.
- **FR-005**: Resolve playable candidates only through configured Invidious instances; reject Piped/unrelated providers at every layer.
- **FR-006**: Declare playback only after media-time progress, not promise/readiness events alone.
- **FR-007**: Scope loads, events, timers, reports, and queue effects to request generation and candidate.
- **FR-008**: Start direct immediately; try proxy immediately on direct error or after 5s without first progress. After playback starts, trigger recovery only after 5s without media-time advancement. Bound each candidate's first-progress wait to 5s and the full recovery episode to 20s from play/retry/stall detection; retries use 1s/2s/4s backoff only while budget remains.
- **FR-009**: Source failure never auto-advances; preserve queue index and expose Retry/Skip.
- **FR-010**: Run startup/recurring catalog reconciliation; prioritize additions/changes; account for every enabled song.
- **FR-011**: Requeue failures with bounded backoff; renew leases during long work; avoid blocking event loop.
- **FR-012**: Warm success requires valid candidates and generation, not Redis TTL or aggregate URL alone.
- **FR-013**: Validate every candidate deadline. Redis TTL is record retention only and must not evict a record before its latest valid candidate's refresh deadline.
- **FR-014**: Redis owns source-cache authority. Fence writes/invalidation with generation plus unique token; reject old writes.
- **FR-015**: Redis eviction/restart and refresh cause safe miss/recache. Never serve expired, superseded, stale-if-error, or unverified L1.
- **FR-016**: Remove long-lived URL maps from browser and Next.js. Permit in-flight coalescing only; responses use Cache-Control: no-store.
- **FR-017**: Client failure is generation-scoped telemetry; it cannot globally demote/invalidate shared candidates.
- **FR-018**: Never persist/relay audio bytes or add app-owned CDN/media delivery.
- **FR-019**: UI exposes playback states, selected-song Retry/Skip, accessible controls, reduced motion, responsive layout.
- **FR-020**: MediaSession metadata/actions track song, state, and position.
- **FR-021**: A cache miss resolves through at most two configured Invidious origins under a 5s total resolver deadline, respects each enabled origin's configured requests-per-second and concurrency limits, and performs no media URL preflight; origins without explicit budgets are disabled and timeout returns explicit unavailable.

## Success criteria

- **SC-001**: Controlled warm fixtures: p95 selection-to-first-advancing-media-time under 2s.
- **SC-002**: Controlled miss fixtures (resolver ≤500ms, source first byte ≤100ms): p95 under 5s. Report live Invidious separately.
- **SC-003**: Each completed catalog pass evaluates 100% enabled songs as fresh/refreshed/failed-overdue; failures never disappear from retry work.
- **SC-004**: Across 100 two-worker refresh/invalidation races, zero post-invalidation responses contain older fence.
- **SC-005**: Direct failure tries proxy; terminal source failure never changes queue index automatically.
- **SC-006**: Acceptance scenarios pass on the latest stable macOS and iOS releases at release time using macOS Chrome, Firefox, Safari, Zen, and Dia, plus iOS Safari, Chrome, and Firefox. Record each OS/browser build and engine; Playwright covers Chromium, Firefox, and WebKit, and each named shell gets a smoke run.
- **SC-007**: Redis loss/eviction/flush returns current Invidious source or explicit unavailable; stale/expired serve counter stays zero.
- **SC-008**: No app-stored/relayed audio bytes or owned media CDN/server.
- **SC-009**: No horizontal overflow at 320px; keyboard/screen-reader users can operate controls and identify recovery.
- **SC-010**: Controlled no-progress and stall scenarios either reach advancing media time or terminal recovery within 20s of play/retry/stall detection; no old source or timer remains active.
- **SC-011**: Cache records do not expire before a valid candidate's refresh deadline; no candidate is served at or after its refresh deadline.
- **SC-012**: A deterministic slow/outage resolver fixture returns explicit unavailable within 5s; no serial provider fallback continues after the deadline.
- **SC-013**: Under concurrent catalog warming, no configured Invidious origin exceeds its declared request-rate or concurrency budget.

## Edge cases

Near, past, malformed, and missing expiry; stale report; IP-bound direct URL; provider rotation; proxy redirect; unsupported codec; MIME/range mismatch; play() rejection; ignored preload; background suspension; concurrent refresh/flush; Redis outage/restart/eviction; duplicate queue event; expired lease; empty catalog; reduced motion.

## Assumptions and limits

“Warm” means fresh URL metadata, not audio bytes buffered/downloaded. Public Invidious and Google delivery are outside app control. Spotify-level latency/availability cannot be promised over public services; targets apply to controlled fixtures and healthy upstreams. No rights asserted.

