# CHHATH RADIO — YouTube Integration Specification

## 1. Purpose

YouTube is the playback provider.

CHHATH RADIO provides curation, queue management, metadata, and atmosphere around the official YouTube embedded player.

---

# 2. Official Integration Only

Use:

**YouTube IFrame Player API / official embedded player.**

Never:

- download YouTube audio
- extract audio URLs
- proxy YouTube media
- scrape playback streams
- use yt-dlp
- intercept media requests
- circumvent YouTube advertising
- hide YouTube player controls with overlays

---

# 3. Player Architecture

Create:

```text
RadioController
      │
      ▼
YouTubePlayerAdapter
      │
      ▼
YouTube IFrame API
```

The RadioController must not depend directly on YouTube SDK internals.

---

# 4. Adapter Interface

Conceptually:

```typescript
interface YouTubePlayerAdapter {
  initialize(container: HTMLElement): Promise<void>;
  loadVideo(videoId: string): Promise<void>;
  cueVideo(videoId: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  getState(): PlayerState;
  onStateChange(callback: (state: PlayerState) => void): () => void;
  onError(callback: (error: unknown) => void): () => void;
  destroy(): void;
}
```

---

# 5. Player States

Map YouTube states to application states:

```text
UNSTARTED
ENDED
PLAYING
PAUSED
BUFFERING
CUED
ERROR
```

Application states:

```text
IDLE
LOADING
PLAYING
PAUSED
BUFFERING
ENDED
ERROR
```

---

# 6. Initialization

Do not initialize multiple players.

Lifecycle:

```text
page load
   ↓
player unavailable
   ↓
user interaction
   ↓
initialize player
   ↓
load selected video
   ↓
play if permitted
```

---

# 7. One Player Rule

Only one active YouTube player should exist for the radio experience.

Never create:

```text
player1
player2
player3
```

to implement queue playback.

Reuse the same player.

---

# 8. Queue

The frontend receives a curated queue.

Example:

```text
[A, B, C, D]
```

Current index:

```text
0
```

When A ends:

```text
index = 1
```

Load B.

---

# 9. Queue Algorithm

Pseudo-behavior:

```text
onEnded():
    if currentSession is stale:
        return

    next = queue.nextValid()

    if next exists:
        current = next
        update UI
        player.loadVideo(next.youtube_video_id)
    else:
        handleQueueEnd()
```

---

# 10. Session Guard

Every queue session should have a session identifier.

Example:

```text
radioSessionId
```

When channel changes:

```text
new session
```

Events from the previous session must not advance the new queue.

This prevents race conditions.

---

# 11. Channel Change

When the user changes channel:

```text
stop current progression
invalidate old session
fetch/new queue
select first valid song
load into same player
update metadata
```

Do not allow the old player's `ENDED` callback to advance the new channel.

---

# 12. Song Errors

If YouTube reports an error:

```text
record error
mark unavailable for session
select next valid song
continue
```

Avoid infinite retry loops.

---

# 13. Error Recovery

Maximum retry behavior should be bounded.

Example:

```text
same song → retry at most once
then → skip
```

Exact policy can be configurable.

---

# 14. Autoplay

Autoplay is browser-dependent.

The site must not promise autoplay.

If autoplay is blocked:

```text
Playback is ready.

[ PLAY RADIO ]
```

User interaction should start playback.

---

# 15. Player Controls

Do not create a fake replacement for YouTube controls.

The official player remains the source of truth for:

- volume
- playback controls
- YouTube behavior

The surrounding application may provide:

- Play Radio
- Next
- channel
- queue
- Ghat Mode

---

# 16. Preloading

Use YouTube's supported cueing/loading capabilities where appropriate.

Do not create hidden duplicate players to preload multiple songs.

A single-player architecture is mandatory.

---

# 17. YouTube Metadata

The application may maintain its own curated metadata:

```text
title
artist
language
category
```

Do not assume YouTube metadata is always available or stable.

The curated database is the source of truth for UI metadata.

---

# 18. Thumbnail

Use a YouTube thumbnail only where appropriate.

Do not rely on thumbnail availability for playback.

---

# 19. Ad Behavior

The application must not attempt to:

- remove ads
- skip ads programmatically
- block ad requests
- manipulate YouTube's advertising system

The player must behave as an official YouTube embed.

---

# 20. Mobile

Mobile browsers may impose stronger autoplay restrictions.

Always provide a manual Play fallback.

Do not assume:

```text
loadVideo → play
```

will always work without user interaction.

---

# 21. Mock Player

Tests must use:

```text
MockYouTubePlayerAdapter
```

It must allow tests to simulate:

```text
PLAYING
PAUSED
BUFFERING
ENDED
ERROR
```

without depending on YouTube's network.

---

# 22. Production Player

Production adapter:

```text
YouTubeIFramePlayerAdapter
```

Responsibilities:

- load official API
- create iframe
- register listeners
- translate events
- expose adapter interface
- clean up

---

# 23. Cleanup

When the player component is destroyed:

```text
remove listeners
clear timers
destroy player
release references
```

No leaked player instances.

---

# 24. Compliance Principle

The application adds value through:

```text
curation
+
queue
+
metadata
+
3D atmosphere
+
Chhath context
```

not by modifying or extracting YouTube's media.

---

# 25. Acceptance Criteria

The integration is complete only when:

- official player works
- one player exists
- queue advances
- errors skip safely
- channel changes work
- autoplay failure is handled
- mobile works
- mock adapter tests pass
- real production smoke test is available
- no media extraction exists anywhere in the codebase
