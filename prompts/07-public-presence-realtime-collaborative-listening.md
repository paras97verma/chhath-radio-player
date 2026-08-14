# CHHATH RADIO — Public Presence, Realtime Listeners & Collaborative Listening Specification

## 1. Purpose

CHHATH RADIO is a **public radio experience**.

Visitors do NOT need accounts or login.

The only authenticated area is the private admin interface.

This document defines:

- public social links
- realtime listener count
- public presence indicators
- collaborative listening
- anonymous visitor identity
- synchronization architecture
- privacy constraints
- admin requirements

---

# 2. Public-First Product Model

The public website must work immediately without:

- signup
- login
- email
- password
- social authentication

Visitor flow:

```text
Open CHHATH RADIO
       ↓
Press PLAY
       ↓
Listen
       ↓
Optionally join Collaborative Listening
```

Do not put a login wall around the radio.

---

# 3. Social / Creator Links

The public UI should provide configurable links for:

```text
Instagram
LinkedIn
Link / Website
```

The values must come from site configuration rather than being hardcoded into components.

Suggested configuration:

```text
instagram_url
linkedin_url
website_url
```

Optional future links:

```text
youtube_channel_url
github_url
x_url
```

Only display links that are configured.

---

# 4. Social UI

Desktop:

```text
CHHATH RADIO

Instagram · LinkedIn · Website
```

Mobile:

```text
◎ Instagram
◎ LinkedIn
◎ Website
```

The links should be subtle and premium.

They must not compete visually with:

- Play
- Current Song
- Radio status

Open external social links safely.

---

# 5. Realtime Listener Count

Display a public realtime listener indicator.

Example:

```text
● 1,284 listeners listening now
```

Alternative minimal form:

```text
● 1,284 listening
```

The number should update automatically.

---

# 6. Listener Definition

A listener is an anonymous browser session that:

1. has opened the radio experience, and
2. has recently interacted with or is actively participating in playback.

Do not count every HTTP request as a listener.

Do not count bots as listeners.

---

# 7. Anonymous Visitor ID

Visitors should receive a random anonymous session identifier.

Example:

```text
listener_session_id
```

This identifier:

- must not contain email
- must not contain name
- must not contain IP address
- must not encode personal information

Store it in browser storage or an equivalent anonymous session mechanism.

---

# 8. Heartbeat

Active listeners periodically send a heartbeat.

Example:

```text
POST /api/presence/heartbeat
```

Payload:

```json
{
  "session_id": "anonymous-random-id",
  "radio_session_id": "radio-session-id",
  "channel_id": "channel-id"
}
```

The server records the latest activity time.

---

# 9. Listener Expiration

A listener should disappear from the active count after a configurable inactivity period.

Example:

```text
heartbeat interval: 15 seconds
active timeout: 45 seconds
```

These values should be configurable.

The exact implementation may use Redis or another realtime presence store.

---

# 10. Realtime Count

Recommended architecture:

```text
Visitor Browser
      │
      │ heartbeat
      ▼
FastAPI
      │
      ▼
Redis / Presence Store
      │
      ▼
Realtime Listener Count
```

PostgreSQL should NOT be used as the high-frequency presence counter.

---

# 11. Public Listener API

Example:

```text
GET /api/presence/listeners
```

Response:

```json
{
  "listeners": 1284,
  "updated_at": "2026-08-12T12:00:00Z"
}
```

The frontend may poll this endpoint or use a realtime transport.

---

# 12. Realtime Transport

Preferred:

```text
WebSocket
```

Fallback:

```text
periodic HTTP polling
```

Do not make WebSocket availability a hard dependency for the radio itself.

If realtime presence fails:

```text
radio continues working
```

The listener count may temporarily show:

```text
Listening now
```

or the last known safe value.

---

# 13. Listener Count Accuracy

The number should be presented as an approximate realtime audience count.

Do not claim:

> Exactly 1,284 humans are listening.

Prefer:

> 1,284 listening now

The backend may use TTL-based anonymous presence.

---

# 14. Collaborative Listening

Visitors can optionally join a synchronized listening room.

The goal:

> Multiple anonymous visitors hear the same curated radio position at approximately the same time.

No login is required.

---

# 15. Collaborative Mode

Public radio remains the default.

Example:

```text
NORMAL RADIO

[ Play ]

[ Join Together ]
```

When a visitor chooses:

```text
Join Together
```

they enter the current collaborative listening room.

---

# 16. Collaboration Model

There should be one optional public room initially:

```text
CHHATH RADIO — LIVE
```

Future versions may support multiple rooms.

Do NOT build a complex social network.

---

# 17. Synchronization

The server is the source of truth for:

```text
current song
current queue position
playback start timestamp
paused/playing state
```

Example:

```text
Song:
abc123

Started:
12:00:00 UTC

Current server time:
12:02:37 UTC

Expected playback position:
157 seconds
```

The client calculates the expected position.

---

# 18. Important YouTube Limitation

Collaborative listening must remain compatible with the official YouTube embedded player.

The application must NOT:

- extract YouTube audio
- create a custom audio stream
- proxy YouTube media
- download YouTube media
- synchronize a hidden audio stream

Each participant uses their own official YouTube embed.

---

# 19. Synchronization Algorithm

Conceptual:

```text
Receive room state
        ↓
Get server timestamp
        ↓
Calculate expected playback position
        ↓
Compare with local player
        ↓
If small difference:
    continue
If significant difference:
    seek/correct using supported YouTube player controls
```

Use a configurable synchronization tolerance.

Example:

```text
< 2 seconds:
    do nothing

2–5 seconds:
    gradual correction if practical

> 5 seconds:
    hard correction
```

Avoid constantly seeking.

---

# 20. Room State

Conceptually:

```json
{
  "room": "public",
  "song_id": "...",
  "youtube_video_id": "...",
  "state": "PLAYING",
  "started_at": "...",
  "server_time": "...",
  "queue_version": 42
}
```

---

# 21. Host Model

MVP should NOT require a user to be the permanent host.

The server defines the canonical radio timeline.

Visitors are synchronized clients.

This avoids:

```text
host closes browser
→ everyone stops
```

---

# 22. New Visitor Joining

When a visitor joins:

```text
Join room
    ↓
Get canonical state
    ↓
Load current YouTube video
    ↓
Calculate position
    ↓
Cue/play
    ↓
Join synchronized playback
```

Autoplay restrictions still apply.

If browser autoplay is blocked:

```text
Tap to join synchronized listening
```

---

# 23. Late Joiners

A visitor joining halfway through a song should normally start at the current position rather than from the beginning.

---

# 24. Song Transition

At the end of a song:

```text
Server radio state
        ↓
Next song
        ↓
New playback start timestamp
        ↓
Broadcast room state
        ↓
Clients load next video
```

The existing YouTube queue/player rules remain authoritative.

---

# 25. Race Conditions

Collaborative synchronization must include:

```text
radio_session_id
queue_version
state_version
```

Clients must ignore stale state updates.

Example:

```text
state_version 100
```

must never overwrite:

```text
state_version 101
```

---

# 26. Connection Loss

If a visitor temporarily loses connection:

```text
continue local playback if possible
```

When connection returns:

```text
fetch current room state
calculate drift
correct if necessary
```

The visitor should not be kicked out unnecessarily.

---

# 27. Room Failure

If collaborative infrastructure fails:

```text
Collaborative mode unavailable
```

but:

```text
Normal Radio
```

must continue working.

---

# 28. Privacy

Do not publicly expose:

- visitor IP addresses
- device IDs
- names
- email addresses
- exact geographic location
- private browsing information

Public presence should only expose an aggregate count.

---

# 29. Analytics

Optional anonymous events:

```text
radio_started
radio_paused
song_started
song_completed
channel_changed
collab_joined
collab_left
```

Avoid invasive tracking.

---

# 30. Admin Visibility

Admin may see:

```text
Current listeners
Current collaborative listeners
Current song
Current channel
```

Optional:

```text
listeners by channel
```

Do not expose individual visitor identities.

---

# 31. Admin Controls

Admin may configure:

```text
Instagram URL
LinkedIn URL
Website URL
Listener count visibility
Collaborative listening enabled/disabled
Presence heartbeat interval
Presence timeout
```

---

# 32. Public UI Placement

Recommended hierarchy:

```text
                 CHHATH RADIO

              ● 1,284 listening

                  [ PLAY ]

              CURRENT SONG
             Song Name

          [ JOIN TOGETHER ]

        Instagram · LinkedIn · Web
```

Do not make the listener count larger than the current song or primary play action.

---

# 33. Ghat Mode

Ghat Mode may simplify the UI to:

```text
● 1,284 listening

        CURRENT SONG

          [ PLAY ]

     Together: 486 listeners
```

Social links can become secondary.

---

# 34. Accessibility

Listener count must have accessible text.

Example:

```text
aria-label="1,284 people listening now"
```

Do not rely only on a pulsing dot.

---

# 35. Performance

Presence updates must not cause:

- full page rerenders
- 3D scene resets
- YouTube player recreation

Listener count updates should update only the relevant UI state.

---

# 36. Security

Public presence endpoints must be protected against abuse.

Consider:

- rate limiting
- heartbeat validation
- session TTL
- origin validation where appropriate
- payload size limits

Never trust the client-provided listener count.

---

# 37. Recommended Technology

For MVP:

```text
Frontend:
Next.js + React + TypeScript

Backend:
FastAPI + Python

Database:
PostgreSQL

Realtime Presence:
Redis

Realtime Collaboration:
WebSocket

Playback:
Official YouTube IFrame API
```

---

# 38. No Public Authentication

This is a strict product rule.

Visitors:

```text
NO LOGIN
NO SIGNUP
NO ACCOUNT
```

Admin:

```text
AUTHENTICATED
PRIVATE
```

---

# 39. Admin/Public Separation

Public:

```text
/
 /channels
 /about
 /radio
```

Private:

```text
/admin
/admin/songs
/admin/channels
/admin/settings
/admin/analytics
```

Admin routes must be protected by backend authentication/authorization.

---

# 40. Acceptance Criteria

The feature is complete when:

- social links appear correctly
- links are configurable
- no visitor login exists
- anonymous listeners are counted
- listener count updates automatically
- count expires inactive visitors
- no personal identity is exposed
- collaborative listening can be joined without login
- late joiners synchronize approximately
- YouTube remains the playback provider
- no YouTube media extraction exists
- stale synchronization messages are rejected
- reconnect works
- normal radio survives collaboration failure
- admin can disable collaboration
- mobile behavior is supported
- accessibility tests pass
- realtime tests pass
- E2E collaboration test passes

---

# 41. Product Principle

CHHATH RADIO should feel like:

> Thousands of people quietly gathering at the same digital Chhath ghat.

But the implementation must remain:

```text
anonymous
simple
privacy-conscious
YouTube-compliant
reliable
beautiful
```
