---
description: "Dependency-ordered implementation tasks for resilient playback, Invidious-only resolution, cache warming, and player UX"
---

# Tasks: Resilient Stream Playback

**Input**: Design docs in specs/001-resilient-stream-playback/  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/stream-resolution.md

Tasks grouped by independently testable user story. Tests included because the feature spec defines explicit acceptance scenarios.

## Phase 1: Setup

- [x] T001 [P] Add deterministic resolver fixtures for signed URL expiry, malformed/unknown expiry, Invidious proxy redirect, range/MIME, slow/outage origins, resolver deadline, and per-origin rate/concurrency limits in backend/tests/unit/test_stream_cache_service.py
- [x] T002 [P] Add fake media-event and clock helpers for delayed play, canplay without progress, waiting/stalled, stale callbacks in frontend/__tests__/unit/html5-audio-adapter.test.ts
- [x] T003 Record baseline resolver-to-first-progress and current browser support matrix in specs/001-resilient-stream-playback/quickstart.md

## Phase 2: Foundational contract

- [x] T004 Define typed source candidate, provider, MIME, candidate deadlines, cache generation/fence, legacy response mapping in frontend/lib/audio/types.ts and backend/app/services/stream_cache_service.py
- [x] T005 Align FastAPI stream response and source-failure contract with generation fields and Cache-Control: no-store in backend/app/api/stream.py and specs/001-resilient-stream-playback/contracts/stream-resolution.md
- [x] T006 Make Next.js route metadata-only pass-through with no-store headers, 5s upstream deadline, and no response/provider fallback cache in frontend/app/api/stream/route.ts

**Checkpoint**: One candidate contract exists before player and cache refactors.

## Phase 3: US1 — Start and continue selected song reliably (P1)

**Independent test**: Direct success, direct-to-proxy fallback, stale event, both modes fail, queue index remains selected, retry/skip explicit.

### Tests

- [x] T007 [P] [US1] Test progress-only PLAYING, 5s first-progress/stall thresholds, direct-to-proxy fallback, 20s episode deadline, and stale callbacks in frontend/__tests__/unit/html5-audio-adapter.test.ts
- [x] T008 [P] [US1] Test terminal ERROR preserves selected queue index and Retry/Skip have explicit outcomes in frontend/__tests__/unit/radio-store.test.ts

### Implementation

- [x] T009 [US1] Implement request-generation state machine with progress-only PLAYING, separate readiness, 5s first-progress/stall thresholds, stalled/waiting recovery, listener/timer cleanup in frontend/lib/audio/html5-audio-adapter.ts
- [x] T010 [US1] Implement direct-first recovery, 5s first-progress cap per candidate, immediate proxy fallback, up to three 1s/2s/4s automatic retries inside a 20s play/retry/stall episode deadline, seek preservation where supported in frontend/lib/audio/html5-audio-adapter.ts
- [x] T011 [US1] Remove queue auto-advance on terminal source failure; retain currentIndex and expose retry-current/explicit-skip actions in frontend/lib/radio-store.ts
- [x] T012 [US1] Make source-failure report include mode/provider/cache generation and remain telemetry-only in frontend/lib/piped/piped-client.ts and backend/app/api/stream.py
- [x] T013 [US1] Route user play/next/previous/retry/resume through gesture paths; keep MediaSession metadata and handlers coherent in frontend/lib/radio-store.ts and frontend/components/radio/RadioPlayer.tsx

**Checkpoint**: PLAYING means media progress; no error path silently changes song.

## Phase 4: US2 — Keep all enabled song metadata warm (P1)

**Independent test**: Expire direct/proxy separately; add song during scan; fail one provider attempt; observe retained retry and zero stale serves.

### Tests

- [x] T014 [P] [US2] Test per-candidate expiry, safety margin, 1800s unknown-expiry limit, record retention past refresh deadline, independent alternate, legacy rejection in backend/tests/unit/test_stream_cache_service.py
- [x] T015 [P] [US2] Test force reaches resolver, priority failure remains scheduled, leader lease survives long cycle, catalog counts every song in backend/tests/unit/test_queue_prewarmer.py
- [x] T016 [P] [US2] Test two-worker refresh/flush race, delayed writer rejection, L1 invalidation, Redis restart/eviction in backend/tests/unit/test_stream_cache_service.py

### Implementation

- [x] T017 [US2] Centralize configured Invidious registry with mandatory per-origin request-rate/concurrency limits; limit cache-miss resolution to two origins/5s total; remove media preflight, Piped extractors, and browser/Next provider fallbacks; match proxy itag to selected compatible format and preserve raw latest-version URL in backend/app/services/stream_cache_service.py, frontend/lib/piped/piped-client.ts, and frontend/app/api/stream/route.ts
- [x] T018 [US2] Store/validate direct and proxy expiry, refresh_at, MIME, provider, and mode independently; derive compatibility fields only from valid sources and size Redis retention beyond refresh deadlines in backend/app/services/stream_cache_service.py
- [x] T019 [US2] Add separate non-expiring Redis fence key, generation/token CAS, refresh merge of valid alternate, eviction fencing, renewable token-owned single-flight lease, stale-write rejection, bounded TTL/LRU L1, Redis-unavailable L1 bypass in backend/app/services/stream_cache_service.py
- [x] T020 [US2] Remove browser completed-URL cache; permit in-flight coalescing only; reject invalid/expired/unsupported candidates in frontend/lib/piped/piped-client.ts and frontend/lib/piped/stream-selector.ts
- [x] T021 [US2] Make warm_song(force=True) force resolver refresh and define warm by valid current-generation candidate, not TTL/aggregate URL in backend/app/services/queue_prewarmer.py
- [x] T022 [US2] Keep failed priority items with bounded backoff; renew catalog/per-song lease independently; thread offload sync work and bound pacing/concurrency in backend/app/services/queue_prewarmer.py and backend/app/services/song_service.py
- [x] T023 [US2] Reconcile every enabled song at startup and recurring due schedule; count fresh/refreshed/failed/overdue per mode in backend/app/services/queue_prewarmer.py
- [x] T024 [US2] Add cache coherence and warmer metrics, including stale/expired serve counter, generation mismatch, stale write rejection, overdue age in backend/app/api/admin/songs.py and backend/tests/unit/test_catalog_readiness.py

**Checkpoint**: Every enabled song accounted for; only validated Invidious candidates can be served.

## Phase 5: US3 — Consistent desktop/mobile behavior (P1)

**Independent test**: Same media scenarios across Chromium, Firefox, WebKit and smoke runs in macOS Chrome/Firefox/Safari/Zen/Dia and iOS Safari/Chrome/Firefox.

### Tests

- [x] T025 [P] [US3] Cover AAC/WebM capability, unsupported MIME rejection, and source-mode ordering in frontend/__tests__/unit/stream-selector.test.ts
- [ ] T026 [P] [US3] Add Chromium, Firefox, and WebKit Playwright projects and first-progress/fallback/no-skip scenarios in frontend/playwright.config.ts and frontend/__tests__/e2e/radio.spec.ts

### Implementation

- [ ] T027 [US3] Select only formats accepted by current audio element; remove unsupported last-resort fallback in frontend/lib/piped/stream-selector.ts and frontend/lib/audio/html5-audio-adapter.ts
- [ ] T028 [US3] Mark secondary source ready only after actual media readiness/progress; keep standard fallback if preload ignored in frontend/lib/audio/html5-audio-adapter.ts
- [ ] T029 [US3] Document smoke runs for macOS Chrome/Firefox/Safari/Zen/Dia and iOS Safari/Chrome/Firefox, including OS/build/engine, timing, network profile, and results in specs/001-resilient-stream-playback/quickstart.md

**Checkpoint**: Supported engines share behavior; platform-specific restrictions remain explicit.

## Phase 6: US4 — Clear and accessible player recovery UI (P2)

**Independent test**: Loading, playing, buffering/retry, paused, unavailable, and empty states at 320px, tablet, desktop; keyboard/screen-reader operation.

### Tests

- [ ] T030 [P] [US4] Add player state, accessible name, Retry/Skip, focus, and reduced-motion assertions in frontend/__tests__/unit/radio-player.test.tsx
- [ ] T031 [P] [US4] Add responsive visual checks at 320px and desktop for state/status/action collisions in frontend/__tests__/e2e/radio.spec.ts

### Implementation

- [ ] T032 [US4] Extract presentation-only status and transport controls with stable audio adapter ownership in frontend/components/radio/RadioPlayer.tsx and frontend/components/radio/PlayerControls.tsx
- [x] T033 [US4] Add distinct playback status and empty states plus same-song Retry / explicit Skip controls in frontend/components/radio/RadioPlayer.tsx and frontend/components/radio/PlayerRecoveryPanel.tsx
- [x] T034 [US4] Polish responsive dark saffron/glass player, contrast, focus/touch states, restrained playing equalizer, reduced-motion mode, and compact mobile controls in frontend/components/radio/RadioPlayer.tsx and frontend/app/globals.css

**Checkpoint**: User understands current state and can recover selected song without accessibility or layout regressions.

## Phase 7: Polish and release

- [ ] T035 Migrate legacy cache records only after candidate validation; invalidate records that cannot satisfy the new schema, and audit every path for Piped, old URL persistence, or media-byte storage in backend/app/api/stream.py, frontend/app/api/stream/route.ts, and frontend/lib/piped/piped-client.ts
- [ ] T036 Run focused backend/frontend tests, worker race checks, and browser scenarios in specs/001-resilient-stream-playback/quickstart.md
- [ ] T037 Update measured p50/p95 and mark release readiness only from browser and cache evidence in specs/001-resilient-stream-playback/plan.md

## Dependencies and parallelism

T001-T003 precede T004-T006. US1 and US2 share foundational contract. US3 depends on US1 source state machine. US4 depends on explicit store recovery states. Release follows all stories.

Parallel: T001/T002; T007/T008; T014/T015/T016; T025/T026 after contract; T030/T031; provider/cache implementation T017-T019 must serialize on the same service file; T032-T034 must serialize on shared UI components.

## MVP

Complete setup, contract, US1, and minimum US2 cache authority before rollout. No production reliability claim until US2 and US3 gates pass. US4 needed for the requested finished product experience.

