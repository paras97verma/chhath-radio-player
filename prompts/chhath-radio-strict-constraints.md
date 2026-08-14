# CHHATH RADIO — STRICT CONSTRAINTS & ENGINEERING CONTRACT

> This document is NON-NEGOTIABLE.
> Treat every requirement as an acceptance criterion.
> If another prompt conflicts with this document, this document wins for technical correctness, security, compliance, reliability, and testing.

---

# 1. PRODUCT BOUNDARY

CHHATH RADIO is:

- A curated Chhath music experience.
- A website that plays owner-selected YouTube videos using the official YouTube embedded player/API.
- An immersive minimalist 3D Chhath environment.
- A curated queue/radio experience.
- A small admin system for managing the catalog.

It is NOT:

- A YouTube downloader.
- An audio extraction service.
- A YouTube proxy.
- A generic YouTube search engine.
- A custom audio streaming CDN.
- A social network.
- A music licensing marketplace.
- A service intended to bypass YouTube advertising or restrictions.

---

# 2. ABSOLUTE YOUTUBE CONSTRAINTS

## 2.1 Official player only

Playback MUST use the official YouTube IFrame Player API / official embedded player.

Allowed:

- `iframe`
- YouTube IFrame Player API
- `player.loadVideoById()`
- `player.cueVideoById()`
- `player.playVideo()`
- `player.pauseVideo()`
- `player.stopVideo()`
- `player.getPlayerState()`
- official player events

Forbidden:

- yt-dlp
- youtube-dl
- scraping YouTube video streams
- extracting audio URLs
- downloading video/audio
- proxying YouTube media
- reverse-engineering YouTube playback URLs
- custom HTTP audio streaming from YouTube
- browser interception of YouTube media requests
- DRM circumvention
- ad-blocking or ad-removal logic

The application must never require access to the raw YouTube audio stream.

---

# 3. NO AD-CIRCUMVENTION

The application MUST NOT:

- block YouTube advertisements
- hide YouTube advertisements
- overlay UI over advertisements
- intercept ad requests
- modify YouTube player network requests
- use proxy servers to remove advertisements
- claim guaranteed ad-free YouTube playback

The application may provide a clean surrounding experience, but YouTube controls advertising behavior.

---

# 4. YOUTUBE PLAYER VISIBILITY

The YouTube player must remain a genuine visible embedded player.

Do not:

- make the iframe effectively invisible
- put a transparent overlay over player controls
- create a fake player over the iframe
- intercept clicks intended for YouTube controls
- obscure YouTube player content

The 3D environment must visually frame the player rather than cover it.

---

# 5. ONE ACTIVE PLAYER

The application MUST maintain only one active YouTube player instance for the radio experience.

Forbidden:

- multiple simultaneous autoplay players
- hidden duplicate players
- creating a new iframe on every song change

Song changes should reuse the same player.

---

# 6. AUTOPLAY

Never assume autoplay is guaranteed.

Initial state:

```text
CHHATH RADIO

छठ के गीत, बिना रुके।

[ PLAY RADIO ]
```

After explicit user interaction:

- initialize/load the selected video
- start playback if permitted
- continue queue behavior according to browser/YouTube rules

If autoplay is blocked:

```text
Tap Play to start Chhath Radio.
```

The application must remain functional.

---

# 7. SONG QUEUE

The queue must be deterministic.

Given:

```text
channel
song list
sort order
shuffle setting
```

the frontend must know exactly which song is current and which song comes next.

When a song ends:

```text
ENDED
  ↓
find next valid song
  ↓
load next YouTube video
  ↓
update Now Playing
```

Do not create race conditions.

---

# 8. QUEUE VALIDATION

Before playback, validate:

- song exists
- song is enabled
- YouTube Video ID is present
- Video ID has valid expected format
- song belongs to the selected channel when applicable

Invalid entries must be skipped safely.

---

# 9. EMBEDDING FAILURES

If YouTube reports:

- video unavailable
- embedding disabled
- removed video
- invalid video
- playback error

the application must:

1. record the failure
2. mark the song as unavailable for the current session
3. avoid infinite retries
4. move to the next valid song
5. keep the application usable

Never crash the radio because one YouTube video fails.

---

# 10. FRONTEND STACK CONSTRAINT

Use:

- Next.js
- React
- TypeScript
- Tailwind CSS
- Three.js
- React Three Fiber
- @react-three/drei
- Framer Motion

Do not replace the frontend with:

- plain static HTML as the primary architecture
- Django templates
- Flask templates
- server-rendered Python UI
- another frontend framework unless explicitly approved

---

# 11. BACKEND STACK CONSTRAINT

Use:

- Python
- FastAPI
- Pydantic v2
- SQLAlchemy 2.x
- Alembic
- PostgreSQL

Do not build the production backend around:

- SQLite
- JSON files as the primary database
- in-memory dictionaries
- hardcoded song catalogs

SQLite may be used only for isolated local tests if necessary.

---

# 12. DATABASE RULES

Production data must live in PostgreSQL.

Never:

- hardcode the production song catalog into React
- duplicate authoritative song data in frontend code
- modify production schema manually without migrations

Every schema change requires an Alembic migration.

---

# 13. API RULES

All backend APIs must:

- validate input
- validate authentication where required
- return predictable JSON
- use appropriate HTTP status codes
- handle errors consistently
- avoid leaking stack traces

Never return:

- database passwords
- API secrets
- JWT secrets
- admin credentials
- internal stack traces

---

# 14. ADMIN SECURITY

Admin operations must require authentication.

Protected operations include:

- create song
- edit song
- delete song
- enable/disable song
- reorder songs
- create channel
- edit channel
- modify festival settings
- modify site settings

Never rely on frontend-only authorization.

Authorization MUST be enforced by the backend.

---

# 15. INPUT VALIDATION

Every admin input must be validated server-side.

Validate:

- title length
- artist length
- YouTube URL
- YouTube Video ID
- category
- language
- enabled status
- sort order

Never trust client-side validation alone.

---

# 16. YOUTUBE VIDEO ID RULE

Accept standard YouTube URLs where practical:

```text
https://www.youtube.com/watch?v=VIDEO_ID
https://youtu.be/VIDEO_ID
https://www.youtube.com/embed/VIDEO_ID
```

Normalize them into:

```text
youtube_video_id
```

Do not store arbitrary remote media URLs as playback sources.

---

# 17. DATA MODEL

Minimum tables:

```text
songs
channels
channel_songs
festival_days
site_settings
analytics_events
admins
```

A song should contain approximately:

```text
id
title
youtube_video_id
youtube_url
artist
language
category
thumbnail_url
enabled
sort_order
rights_notes
created_at
updated_at
```

---

# 18. API DESIGN

Minimum endpoints:

```text
GET    /api/songs
GET    /api/songs/{id}

GET    /api/channels
GET    /api/channels/{id}

GET    /api/radio/queue

GET    /api/festival/current
GET    /api/settings

POST   /api/admin/songs
PATCH  /api/admin/songs/{id}
DELETE /api/admin/songs/{id}

POST   /api/admin/channels
PATCH  /api/admin/channels/{id}

PATCH  /api/admin/settings
```

Use consistent response schemas.

---

# 19. FRONTEND STATE

Use a clear radio state model.

Minimum:

```text
IDLE
LOADING
PLAYING
PAUSED
BUFFERING
ENDED
ERROR
```

Do not scatter playback state across unrelated components.

Create a central radio/player controller.

---

# 20. YOUTUBE EVENT HANDLING

Handle at minimum:

```text
UNSTARTED
ENDED
PLAYING
PAUSED
BUFFERING
CUED
ERROR
```

Listeners must be cleaned up.

React component unmount must not leave:

- stale player listeners
- timers
- subscriptions
- duplicate callbacks

---

# 21. RACE CONDITION PREVENTION

The application must protect against:

- double-click Play
- rapid Next actions
- song ending while user manually selects another song
- channel change during buffering
- component unmount during player initialization
- duplicate YouTube state events

Use request/session tokens or equivalent state guards where necessary.

Only the current radio session may advance the current queue.

---

# 22. TIME-OF-DAY ENGINE

Time of day must be centralized.

Do not implement separate time calculations in multiple components.

Use a single engine producing:

```text
DAWN
MORNING
AFTERNOON
SUNSET
EVENING
NIGHT
```

All visual systems consume that state.

---

# 23. TIME ZONE

Use the browser's local time by default.

Do not hardcode India Standard Time for every visitor.

If a Chhath festival schedule is configured for India, store its timezone explicitly.

---

# 24. SMOOTH VISUAL TRANSITIONS

Do not abruptly replace:

- sky
- sun
- river
- fog
- lighting

Use interpolation.

Time-of-day changes must feel environmental rather than like a theme switch.

---

# 25. 3D PERFORMANCE

The 3D scene must never prevent the radio player from working.

Use:

- device pixel ratio limits
- quality levels
- lazy initialization
- lightweight geometry
- limited particles
- controlled post-processing

Quality levels:

```text
HIGH
MEDIUM
LOW
```

---

# 26. LOW-END DEVICE FALLBACK

On low-end devices:

- reduce particle count
- disable expensive effects
- reduce shadows
- reduce reflections
- simplify materials
- reduce resolution where appropriate

If WebGL is unavailable:

show a beautiful static/fallback background and keep the music player fully functional.

---

# 27. REDUCED MOTION

Honor:

```text
prefers-reduced-motion
```

When enabled:

- disable camera parallax
- minimize river animation
- reduce particles
- remove nonessential transitions
- avoid large movement

---

# 28. RESPONSIVE REQUIREMENTS

Must support:

- desktop
- laptop
- tablet
- mobile
- large TV/Ghat Mode

The YouTube player must remain usable at every supported viewport.

---

# 29. GHAT MODE

Ghat Mode may:

- simplify navigation
- enlarge visual scene
- reduce UI
- use browser fullscreen after user interaction where supported

It must NOT:

- hide the YouTube player
- cover YouTube controls
- bypass browser fullscreen permissions

---

# 30. PWA

PWA may provide:

- manifest
- installability
- icons
- offline shell

Do not claim offline playback of YouTube songs.

YouTube playback requires normal network/browser availability.

---

# 31. OFFLINE BEHAVIOR

If the backend is unreachable:

- show cached/static shell if available
- show a clear connection message
- do not crash

Do not attempt to cache YouTube audio/video for offline playback.

---

# 32. ACCESSIBILITY

Must include:

- semantic HTML
- keyboard navigation
- focus states
- accessible labels
- sufficient contrast
- screen-reader-friendly controls
- reduced motion

All interactive elements must be keyboard reachable.

---

# 33. SEO

Each public route must have:

- title
- description
- canonical URL
- Open Graph metadata where appropriate

Do not generate hundreds of thin SEO pages automatically.

---

# 34. ANALYTICS

Analytics must be privacy-conscious.

Track only useful events such as:

```text
page_view
radio_started
song_started
song_completed
song_skipped
channel_selected
ghat_mode_started
share_clicked
```

Do not record:

- raw personal data
- passwords
- authentication tokens
- private admin information

---

# 35. LOGGING

Backend logs should include:

- timestamp
- request ID
- endpoint
- status
- useful error context

Never log:

- passwords
- access tokens
- secrets
- full authorization headers

---

# 36. ERROR HANDLING

Frontend errors must not leave a blank page.

Backend errors must return structured responses.

Example:

```json
{
  "error": {
    "code": "SONG_NOT_AVAILABLE",
    "message": "The selected song is currently unavailable."
  }
}
```

---

# 37. TESTING REQUIREMENT

No feature is complete until it has tests.

Minimum:

- unit tests
- API/integration tests
- database tests
- frontend component tests
- browser E2E tests
- accessibility checks
- responsive checks
- production smoke tests

---

# 38. YOUTUBE TESTING RULE

Automated CI tests MUST NOT depend on a real arbitrary YouTube video behaving perfectly.

Use a mock/stub abstraction for deterministic application tests.

Create:

```text
YouTubePlayerAdapter
```

with:

```text
loadVideo()
play()
pause()
stop()
getState()
onStateChange()
destroy()
```

Production implementation:

```text
YouTubeIFramePlayerAdapter
```

Test implementation:

```text
MockYouTubePlayerAdapter
```

This makes queue tests deterministic.

---

# 39. REAL YOUTUBE SMOKE TEST

A separate optional production smoke test may verify:

- iframe loads
- player initializes
- selected test video is embeddable

Do not make the entire CI pipeline dependent on YouTube network behavior.

---

# 40. NO FAKE SUCCESS

Tests must not simply assert that functions were called.

Where practical, assert user-visible behavior.

Example:

Bad:

```text
expect(loadVideoById).toHaveBeenCalled()
```

Better:

```text
current song title changed to next song
player state became PLAYING
queue index advanced
```

---

# 41. DEFINITION OF DONE

A feature is DONE only if:

- implemented
- typed
- validated
- tested
- accessible
- responsive
- error-handled
- documented

---

# 42. CODE QUALITY

Use:

- TypeScript strict mode
- Python type hints
- Ruff
- Black
- ESLint
- Prettier
- mypy where practical

No:

- `any` everywhere
- ignored type errors without explanation
- dead code
- duplicate business logic
- giant components

---

# 43. ENVIRONMENT VARIABLES

Secrets must be environment variables.

Never commit:

- database passwords
- JWT secrets
- Supabase service keys
- admin credentials
- API keys

Provide:

```text
.env.example
```

with placeholders.

---

# 44. DEPENDENCY RULE

Do not add libraries merely because they are popular.

Every dependency should solve a real problem.

Avoid unnecessary:

- animation libraries
- state-management libraries
- 3D frameworks on top of R3F
- UI libraries that duplicate Tailwind
- backend frameworks

---

# 45. SECURITY TESTS

Test:

- unauthorized admin request → 401/403
- malformed YouTube URL → 400
- invalid song ID → 404
- invalid input → 422
- SQL injection payloads
- XSS payloads
- unauthorized modification
- CSRF considerations where applicable
- rate limiting for sensitive admin APIs

---

# 46. NO TRUST IN CLIENT DATA

The frontend cannot decide:

```text
isAdmin = true
```

and expect the backend to trust it.

All permissions must be server-validated.

---

# 47. FINAL NON-NEGOTIABLE PRINCIPLES

1. Official YouTube embed/API only.
2. Never extract YouTube audio.
3. Never bypass YouTube advertising.
4. One active radio player.
5. Curated videos only.
6. Backend authorization is mandatory.
7. PostgreSQL is the production database.
8. Time-of-day is centralized.
9. 3D must degrade gracefully.
10. Accessibility is mandatory.
11. Tests are mandatory.
12. CI must be deterministic.
13. Production smoke tests must be separate from deterministic unit/E2E tests.
14. No feature is complete without acceptance tests.
15. The site must remain usable if YouTube or WebGL fails.
