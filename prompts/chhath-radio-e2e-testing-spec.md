# CHHATH RADIO — AUTOMATED E2E & TESTING SPECIFICATION

## 1. PURPOSE

This document defines the automated quality gate for CHHATH RADIO.

The application is not considered production-ready until the automated test suite passes.

Testing must cover:

- frontend
- backend
- database
- radio queue
- YouTube integration abstraction
- admin
- 3D fallback
- time-of-day
- accessibility
- responsive behavior
- security
- performance
- production smoke behavior

---

# 2. TESTING STACK

## Frontend unit/component

Use:

- Vitest
- React Testing Library

## Backend

Use:

- pytest
- pytest-asyncio
- HTTPX
- SQLAlchemy test database

## Browser E2E

Use:

**Playwright**

Test:

- Chromium
- Firefox
- WebKit

At minimum, Chromium must be a required CI browser.

---

# 3. TEST PROJECT STRUCTURE

Recommended:

```text
tests/
├── unit/
│   ├── frontend/
│   └── backend/
│
├── integration/
│   ├── api/
│   └── database/
│
├── e2e/
│   ├── radio.spec.ts
│   ├── admin.spec.ts
│   ├── responsive.spec.ts
│   ├── accessibility.spec.ts
│   ├── errors.spec.ts
│   └── ghat-mode.spec.ts
│
├── fixtures/
│   ├── songs.json
│   ├── channels.json
│   └── users.json
│
└── smoke/
    └── production.spec.ts
```

---

# 4. CI COMMANDS

The project must provide:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run test:a11y
npm run build
```

Backend:

```bash
pytest
ruff check .
mypy .
```

Create one top-level command:

```bash
npm run verify
```

or equivalent that executes all mandatory checks.

---

# 5. TEST DATABASE

Automated integration tests must use an isolated database.

Never run destructive tests against production.

Recommended:

```text
PostgreSQL test database
```

Run migrations before tests.

Seed deterministic fixtures.

Clean/reset after each test suite.

---

# 6. DETERMINISTIC SONG FIXTURES

Use known fake/demo YouTube IDs for application logic.

Example:

```text
test-song-1
test-song-2
test-song-3
```

These IDs are for mocked player tests only.

Do not accidentally publish them as real production songs.

---

# 7. YOUTUBE PLAYER ABSTRACTION

The application must expose a player abstraction.

Example:

```typescript
interface YouTubePlayerAdapter {
  loadVideo(videoId: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  getState(): PlayerState;
  onStateChange(callback: (state: PlayerState) => void): () => void;
  destroy(): void;
}
```

Production:

```text
YouTubeIFramePlayerAdapter
```

Tests:

```text
MockYouTubePlayerAdapter
```

---

# 8. UNIT TEST — QUEUE

Test:

### Given

```text
Song A
Song B
Song C
```

### When

Song A ends.

### Then

Current song becomes:

```text
Song B
```

---

# 9. UNIT TEST — LAST SONG

Given:

```text
A
B
C
```

When C ends:

Verify configured behavior:

- loop to A, OR
- stop radio

The behavior must be explicitly configured.

Never leave this ambiguous.

---

# 10. UNIT TEST — DISABLED SONG

Given:

```text
A enabled
B disabled
C enabled
```

When A ends:

Expected:

```text
C
```

B must never be loaded.

---

# 11. UNIT TEST — INVALID SONG

Given a queue containing:

```text
A valid
B invalid
C valid
```

Expected:

```text
A → C
```

No crash.

---

# 12. UNIT TEST — YOUTUBE ERROR

Simulate:

```text
player ERROR
```

Expected:

- error logged
- current song marked unavailable for session
- next song selected
- UI remains usable

---

# 13. UNIT TEST — DOUBLE PLAY

Simulate two rapid clicks:

```text
Play
Play
```

Expected:

- one player initialization
- one active playback command
- no duplicate iframe
- no duplicate queue progression

---

# 14. UNIT TEST — RAPID NEXT

Simulate:

```text
Next
Next
Next
```

Expected:

- queue index remains valid
- no race condition
- only final requested song becomes current
- no duplicate player instances

---

# 15. UNIT TEST — CHANNEL CHANGE

Given:

```text
Channel A → songs 1,2,3
Channel B → songs 4,5,6
```

When channel changes:

Expected:

- queue resets correctly
- current song belongs to Channel B
- old queue cannot advance the new queue

---

# 16. UNIT TEST — TIME OF DAY

Test exact boundaries.

For example:

```text
04:29 → NIGHT
04:30 → DAWN
06:30 → MORNING
11:00 → AFTERNOON
16:30 → SUNSET
19:00 → NIGHT
```

Use configurable boundaries rather than hardcoded magic numbers.

---

# 17. UNIT TEST — TIME TRANSITIONS

Given:

```text
MORNING → SUNSET
```

Verify:

- interpolation values remain between start/end
- no NaN values
- no abrupt invalid state
- transition eventually reaches target

---

# 18. UNIT TEST — FESTIVAL DAY

Given a configured festival date:

```text
SANDHYA_ARGHYA
```

Expected:

- correct festival state
- correct label
- correct featured channel

Outside the date:

- no stale festival state

---

# 19. API TEST — PUBLIC SONGS

```http
GET /api/songs
```

Expected:

```text
200
```

Response contains only appropriate public fields.

Do not expose:

- admin secrets
- internal credentials
- sensitive fields

---

# 20. API TEST — DISABLED SONG

Disabled songs should not appear in public radio results unless explicitly requested by an authenticated admin endpoint.

---

# 21. API TEST — SONG CREATION

Authenticated admin:

```http
POST /api/admin/songs
```

with valid payload.

Expected:

```text
201
```

Database contains the new song.

---

# 22. API TEST — UNAUTHORIZED CREATION

Anonymous:

```http
POST /api/admin/songs
```

Expected:

```text
401 or 403
```

No database mutation.

---

# 23. API TEST — MALFORMED YOUTUBE URL

Send:

```text
https://example.com/video
```

Expected:

```text
400 or 422
```

No database mutation.

---

# 24. API TEST — XSS INPUT

Attempt:

```html
<script>alert(1)</script>
```

in:

- title
- artist
- description

Expected:

- safely stored/escaped
- never executed in browser

---

# 25. API TEST — SQL INJECTION

Test malicious strings against:

- song title
- search
- channel
- IDs

Expected:

- no SQL execution
- no unauthorized data
- safe parameterized queries

---

# 26. DATABASE TESTS

Test:

- song creation
- song update
- song deletion
- channel creation
- channel-song ordering
- foreign keys
- uniqueness
- migrations

---

# 27. E2E — HOMEPAGE

Playwright:

1. Open homepage.
2. Verify CHHATH RADIO appears.
3. Verify tagline appears.
4. Verify YouTube player container exists.
5. Verify Play Radio button exists.
6. Verify 3D scene or fallback exists.

Expected: no console-level application error.

---

# 28. E2E — START RADIO

1. Open homepage.
2. Click Play Radio.
3. Verify UI transitions from idle to playing/loading.
4. Verify Now Playing appears.
5. Verify song metadata is visible.

Use the mocked player in CI.

---

# 29. E2E — SONG ENDED

1. Start radio.
2. Mock current player state = ENDED.
3. Verify next song loads.
4. Verify Now Playing changes.
5. Verify queue index increments.

---

# 30. E2E — PLAYER ERROR

1. Start radio.
2. Mock YouTube error.
3. Verify error handling.
4. Verify next song loads.
5. Verify page remains interactive.

---

# 31. E2E — PLAY/PAUSE

Verify:

```text
Play → PLAYING
Pause → PAUSED
Play → PLAYING
```

No duplicate players.

---

# 32. E2E — CHANNEL SWITCHING

1. Open channel selector.
2. Select Bhojpuri.
3. Verify selected channel.
4. Verify queue changes.
5. Verify current song belongs to selected queue.

---

# 33. E2E — UP NEXT

Verify:

- current song is not duplicated in Up Next
- next 3–5 songs appear
- disabled songs do not appear
- ordering is correct

---

# 34. E2E — GHAT MODE

1. Start radio.
2. Enter Ghat Mode.
3. Verify navigation becomes minimal.
4. Verify player remains visible.
5. Verify song title remains visible.
6. Exit Ghat Mode.
7. Verify normal UI returns.

---

# 35. E2E — TIME OF DAY

Mock browser/system time.

Test:

```text
05:30
08:00
14:00
17:30
22:00
```

Verify correct visual state classes/data attributes.

Do not test WebGL pixel-perfectly.

Test state rather than exact rendered pixels.

---

# 36. E2E — MOBILE

Playwright viewport:

```text
390 × 844
```

Verify:

- no horizontal overflow
- player fits viewport
- Play button accessible
- Now Playing visible
- Up Next usable
- navigation usable

---

# 37. E2E — TABLET

Viewport approximately:

```text
768 × 1024
```

Verify:

- layout remains coherent
- player maintains aspect ratio
- 3D scene does not overlap UI
- no horizontal overflow

---

# 38. E2E — DESKTOP

Viewport:

```text
1440 × 900
```

Verify:

- scene fills viewport
- player is prominent
- navigation works
- no unwanted scrollbars
- no overlapping elements

---

# 39. E2E — LARGE DISPLAY

Viewport:

```text
1920 × 1080
```

Verify:

- scene remains visually balanced
- player is not tiny
- text remains readable
- Ghat Mode is usable

---

# 40. ACCESSIBILITY TEST

Use:

**axe-core / Playwright axe**

Check:

- color contrast
- missing labels
- button names
- landmark structure
- heading structure
- keyboard accessibility

No critical accessibility violations.

---

# 41. KEYBOARD TEST

Verify:

```text
Tab
Shift+Tab
Enter
Space
Escape
```

Expected:

- all controls reachable
- Play can be activated
- menus can be closed
- Ghat Mode can be exited
- focus is visible

---

# 42. REDUCED MOTION TEST

Set:

```text
prefers-reduced-motion: reduce
```

Verify:

- major animation disabled/reduced
- page remains functional
- player works
- navigation works

---

# 43. WEBGL FAILURE TEST

Mock WebGL failure.

Expected:

- static visual fallback appears
- radio player remains functional
- no blank screen
- no fatal React error

---

# 44. NETWORK FAILURE TEST

Simulate backend failure.

Expected:

- friendly error
- no infinite loading
- cached/static shell remains if available
- user can retry

---

# 45. SLOW NETWORK TEST

Use Playwright throttling.

Verify:

- meaningful loading state
- no layout catastrophe
- no unbounded spinners
- controls remain understandable

---

# 46. ADMIN E2E

Test complete flow:

```text
Login
  ↓
Admin Dashboard
  ↓
Add Song
  ↓
Paste YouTube URL
  ↓
Validate
  ↓
Save
  ↓
Song appears
  ↓
Assign Channel
  ↓
Enable
  ↓
Public radio sees song
```

---

# 47. ADMIN EDIT

Test:

```text
Edit title
Edit artist
Change category
Disable song
Save
```

Verify public catalog updates correctly.

---

# 48. ADMIN DELETE

Test:

1. Create test song.
2. Delete it.
3. Verify it disappears from admin list.
4. Verify it does not appear in public queue.
5. Verify related channel relationship is handled correctly.

---

# 49. ADMIN REORDER

Given:

```text
A
B
C
```

Move C to position 1.

Expected:

```text
C
A
B
```

Verify persistence after page reload.

---

# 50. SECURITY E2E

Attempt:

- access admin without login
- modify song without login
- delete song without login
- manipulate user role
- submit malformed IDs
- inject HTML

All must fail safely.

---

# 51. NO SECRET LEAK TEST

Scan built frontend output for obvious secret patterns.

Never expose:

- database passwords
- service-role keys
- JWT signing secrets
- private API credentials

Public client configuration must be explicitly safe for browser exposure.

---

# 52. CONSOLE ERROR TEST

During critical E2E tests:

Fail the test if unexpected:

```text
console.error
pageerror
```

occurs.

Known harmless third-party messages may be explicitly allowlisted with justification.

Never broadly suppress console errors.

---

# 53. NETWORK ERROR TEST

Fail tests for unexpected failed requests to the application's own API.

Third-party YouTube network behavior should be separately handled/allowlisted.

---

# 54. PERFORMANCE BUDGET

Initial targets:

Desktop:

- Lighthouse Performance ≥ 85
- LCP < 2.5s target
- CLS < 0.1 target

Mobile:

- Lighthouse Performance ≥ 75 initially
- LCP < 4s target

These are targets, not excuses to sacrifice functionality.

---

# 55. JAVASCRIPT BUNDLE

Monitor bundle size.

Do not ship large unused libraries.

Three.js-related code should be loaded efficiently.

Use code splitting/lazy loading where appropriate.

---

# 56. 3D PERFORMANCE TEST

Test at:

```text
HIGH
MEDIUM
LOW
```

Verify:

- scene remains responsive
- player remains usable
- no runaway memory
- no continuous object creation
- animation loops are cleaned up

---

# 57. MEMORY LEAK TEST

Repeatedly:

```text
Enter page
Start radio
Change song
Change channel
Enter Ghat Mode
Exit
Unmount
Remount
```

Verify:

- no duplicate player
- no duplicated event listeners
- no continuously growing timers
- no abandoned animation loops

---

# 58. PWA TEST

Verify:

- manifest exists
- name is correct
- icons exist
- installability requirements where supported
- app shell loads

Do NOT test offline YouTube playback because it is not supported by this architecture.

---

# 59. SEO TEST

Verify:

- title
- description
- canonical
- Open Graph
- robots configuration
- sitemap where implemented

Ensure no staging pages are accidentally indexed.

---

# 60. API CONTRACT TESTS

Generate/maintain OpenAPI schema.

Tests must ensure:

- response structure matches Pydantic models
- required fields exist
- invalid requests fail correctly

---

# 61. MIGRATION TEST

CI must:

1. create empty PostgreSQL database
2. run Alembic migrations
3. verify schema
4. seed fixtures
5. run integration tests

This ensures migrations work from a clean state.

---

# 62. CLEAN INSTALL TEST

CI should test:

```bash
fresh checkout
install dependencies
run migrations
build frontend
run backend
run E2E
```

The project must not depend on developer-local files.

---

# 63. CI PIPELINE

Recommended:

```text
Pull Request
     │
     ├── Lint
     ├── Typecheck
     ├── Unit Tests
     ├── Backend Tests
     ├── DB Migration Test
     ├── Build
     ├── Playwright Chromium
     ├── Accessibility
     └── Security checks
              │
              ▼
           PASS
              │
              ▼
          Merge
```

---

# 64. PRODUCTION SMOKE TEST

After deployment:

1. Open production URL.
2. Verify HTTPS.
3. Verify homepage.
4. Verify API health.
5. Verify database connectivity.
6. Verify song catalog.
7. Verify YouTube player initialization.
8. Verify Play button.
9. Verify Ghat Mode.
10. Verify mobile layout.

Production smoke tests should use a known embeddable test/production-selected video.

---

# 65. HEALTH ENDPOINT

Implement:

```text
GET /health
```

Expected:

```json
{
  "status": "ok"
}
```

Optionally:

```text
GET /health/ready
```

for database readiness.

Do not expose sensitive infrastructure details.

---

# 66. TEST DATA CLEANUP

Every E2E test that mutates admin data must:

- use uniquely identifiable test records
- clean up after itself
- never depend on test execution order

Tests must be independently runnable.

---

# 67. TEST ISOLATION

Avoid:

```text
test B depends on test A having run
```

Every test should establish its own state.

---

# 68. FLAKY TEST POLICY

No test should be marked flaky merely to make CI pass.

If a test flakes:

1. reproduce
2. identify race/timing issue
3. fix application/test
4. rerun

Retries may exist as a diagnostic tool but must not hide systematic failures.

---

# 69. VISUAL REGRESSION

Use Playwright screenshots only for stable UI areas.

Do NOT make exact screenshot equality mandatory for animated WebGL scenes.

Visual regression may test:

- header
- player container
- Now Playing
- Up Next
- admin UI
- mobile layout

Use tolerances appropriate to fonts/rendering.

---

# 70. ACCESSIBILITY REGRESSION

Every major UI route must pass automated accessibility checks.

At minimum:

```text
/
 /chhath-radio
 /chhath-geet
 /chhath-puja
 /admin
```

Admin routes require authentication during testing.

---

# 71. FINAL AUTOMATED ACCEPTANCE SUITE

The final `verify` command must prove:

```text
✓ dependencies install
✓ lint passes
✓ formatting passes
✓ TypeScript passes
✓ Python checks pass
✓ unit tests pass
✓ API tests pass
✓ database tests pass
✓ migrations pass
✓ build succeeds
✓ Playwright E2E passes
✓ accessibility passes
✓ responsive tests pass
✓ security tests pass
✓ production smoke test available
```

---

# 72. RELEASE GATE

A release MUST NOT be considered successful if:

- TypeScript fails
- backend tests fail
- migrations fail
- critical E2E fails
- critical accessibility failure exists
- admin authorization fails
- YouTube queue logic fails
- player abstraction fails
- application crashes when WebGL is unavailable

---

# 73. FINAL USER JOURNEY TEST

One complete automated journey should simulate:

```text
VISITOR OPENS SITE
        ↓
SEES CHHATH ENVIRONMENT
        ↓
SEES CURRENT TIME-OF-DAY STATE
        ↓
CLICKS PLAY RADIO
        ↓
YOUTUBE PLAYER INITIALIZES
        ↓
SONG 1 PLAYS
        ↓
NOW PLAYING UPDATES
        ↓
SONG 1 ENDS
        ↓
SONG 2 LOADS
        ↓
VISITOR CHANGES CHANNEL
        ↓
QUEUE RESETS
        ↓
VISITOR ENTERS GHAT MODE
        ↓
PLAYER REMAINS VISIBLE
        ↓
VISITOR EXITS GHAT MODE
        ↓
VISITOR SHARES
        ↓
NO ERRORS
```

This journey must pass in CI using the deterministic YouTube player adapter.

---

# 74. FINAL QUALITY PRINCIPLE

The application should fail gracefully.

If:

```text
YouTube fails
```

the website survives.

If:

```text
WebGL fails
```

the website survives.

If:

```text
one song fails
```

the radio continues.

If:

```text
backend temporarily fails
```

the UI explains the problem.

If:

```text
autoplay is blocked
```

the user can press Play.

If:

```text
device is weak
```

3D quality decreases.

The user should almost never see a broken application.

---

# 75. FINAL DEFINITION OF QUALITY

CHHATH RADIO is production-ready only when it is:

**Correct + Tested + Accessible + Responsive + Secure + Performant + Graceful under failure.**
