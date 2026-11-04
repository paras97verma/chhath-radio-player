# Playback Requirements Checklist: Resilient Stream Playback

**Purpose**: Review completeness, clarity, and testability of playback/cache/UI requirements.  
**Created**: 2026-11-04  
**Feature**: [spec.md](../spec.md)

**Note**: Requirements-quality checklist, not implementation verification.
**Review Ownership**: Reviewer owns all checkbox decisions. [x] means requirements-quality approval only.

## Completeness

- [ ] CHK001 Are direct and proxy candidate identity, provider, and mode defined separately? [Spec §FR-001]
- [ ] CHK002 Are startup scan, recurring due refresh, and write-time additions all covered? [Spec §FR-010]
- [ ] CHK003 Are terminal playback recovery actions and their selected-song behavior specified? [Spec §US1]
- [ ] CHK004 Are all visible player states and no-song state defined? [Spec §FR-019]

## Clarity and measurability

- [ ] CHK005 Are “warm,” “fresh,” and “overdue” defined by candidate timestamps rather than cache TTL? [Spec §FR-003, FR-012]
- [ ] CHK006 Are warm/miss p95 targets tied to a controlled fixture and separated from upstream performance? [Spec §SC-001, SC-002]
- [ ] CHK007 Is the total retry deadline measurable and bounded across both candidates? [Spec §FR-008]
- [ ] CHK008 Is “no stale serve” defined for Redis, L1, Next.js, and browser layers? [Spec §FR-015, SC-007]

## Consistency

- [ ] CHK009 Do direct-first ordering and client-specific failure rules agree across requirements and contracts? [Spec §FR-008, FR-017]
- [ ] CHK010 Are no-owned-CDN and direct Google-hosted URL constraints stated without contradiction? [Spec boundaries, FR-018]
- [ ] CHK011 Do Retry and Skip preserve the distinction between selected-song failure and explicit user navigation? [Spec §FR-009, US4]
- [ ] CHK012 Are platform support claims limited to engines/devices with release validation? [Spec §SC-006]

## Scenario and edge coverage

- [ ] CHK013 Are expiry, provider rotation, proxy redirect, MIME/range, Redis loss, and concurrency edge cases explicit? [Spec Edge cases]
- [ ] CHK014 Are user gesture, autoplay rejection, background return, and ignored preload covered? [Spec §US3]
- [ ] CHK015 Are 320px layout, keyboard, screen reader, focus, and reduced motion requirements objectively reviewable? [Spec §US4, SC-009]
- [ ] CHK016 Is Redis record retention defined to outlast candidate refresh deadlines while candidates are rejected at their own deadline? [Spec §FR-013, SC-011]
- [ ] CHK017 Are the named macOS and iOS browser shells listed for release smoke runs, with OS/build/engine recorded? [Spec §SC-006]
- [ ] CHK018 Is the post-start stall trigger distinguished from initial first-progress timeout and bounded with a measurable threshold? [Spec §FR-008, US1]
- [ ] CHK019 Is cache-miss resolution bounded across a defined number of Invidious origins, with explicit timeout behavior and no hidden fallback? [Spec §FR-021, SC-012]
- [ ] CHK020 Are explicit per-origin request-rate and concurrency limits required, validated, and measurable for warmers and playback resolution? [Spec §FR-021, SC-013]

## Notes

- Leave items unchecked until reviewer evaluates requirement quality.
- Implementation behavior belongs in tests; this checklist reviews requirements language.

