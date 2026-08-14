# CHHATH RADIO — Lyzo AI Master Build Prompt

## 0. Product definition

Build a premium, immersive, minimalist website called **CHHATH RADIO**.

The website is essentially a curated **YouTube-powered Chhath music player**.

The owner will manually select YouTube videos and add their YouTube Video IDs/URLs to a predefined catalog. Visitors should be able to open the website, press Play, and listen/watch the selected Chhath songs through the official YouTube embedded player.

### Core positioning

**CHHATH RADIO**

**छठ के गीत, बिना रुके।**

The experience should feel like:

> **YouTube Player + digital Chhath ghat + minimalist 3D art installation**

It must NOT look like a generic music streaming SaaS application.

---

# 1. IMPORTANT YOUTUBE IMPLEMENTATION REQUIREMENT

Use the official **YouTube IFrame Player API** / embedded YouTube player.

Do NOT:

- download YouTube videos
- extract YouTube audio URLs
- proxy YouTube audio
- use yt-dlp
- scrape YouTube
- bypass YouTube advertising
- create a custom player that hides or replaces YouTube's player controls
- obscure the YouTube player with an overlay

The selected songs must remain YouTube-hosted and be played through the official embedded player.

The YouTube player should be integrated into the visual experience while remaining a genuine visible embedded player.

Use the YouTube IFrame API to:

- load a selected video
- play
- pause
- stop
- seek where permitted
- change volume
- receive player state events
- detect when a song ends
- load the next selected video

The website must respect YouTube's current embed/player requirements.

---

# 2. ABOUT ADS

The product goal is a clean, uninterrupted listening experience.

However, do NOT implement any mechanism intended to bypass, suppress, block, or circumvent YouTube ads.

Do not claim that the website can guarantee "no ads".

Use the normal official YouTube embedded player.

If a selected YouTube video has no ad served for a particular viewer/session, that is naturally fine.

If YouTube serves an ad, allow YouTube's player to handle it normally.

Do not use ad blockers, proxying, modified embeds, CSS tricks, overlays, or other mechanisms to hide YouTube ads or player UI.

---

# 3. SELECTED/PRE-AVAILABLE SONG CATALOG

The site should NOT be a YouTube search engine.

There should be a curated catalog controlled by the site owner.

The owner will provide entries such as:

```text
{
  "id": "unique-song-id",
  "youtubeVideoId": "XXXXXXXXXXX",
  "title": "Kaanch Hi Baans Ke Bahangiya",
  "artist": "Artist Name",
  "language": "Bhojpuri",
  "category": "Traditional",
  "duration": null,
  "thumbnail": null,
  "enabled": true,
  "sortOrder": 1
}
```

The initial catalog can be stored in the backend/database.

The frontend should receive only enabled songs.

---

# 4. YOUTUBE PLAYER BEHAVIOR

Use one YouTube player only.

The page should have a single persistent player instance.

When the current song ends:

1. receive YouTube player state = ENDED
2. determine the next enabled song
3. update Now Playing
4. load the next YouTube Video ID
5. continue playback where browser/YouTube autoplay rules permit

Do not create multiple simultaneously autoplaying YouTube players.

If browser autoplay restrictions prevent automatic playback, show a prominent Play button and require the user to initiate playback.

After the first user interaction, continue through the curated queue using the YouTube IFrame Player API.

---

# 5. PLAYER UI

The YouTube player itself must remain a genuine visible embedded player.

Do NOT place visual elements over the YouTube player.

The surrounding interface can be beautifully designed.

Recommended composition:

```text
                CHHATH RADIO

        [ cinematic 3D environment ]

             ┌───────────────┐
             │               │
             │   YOUTUBE     │
             │    PLAYER     │
             │               │
             └───────────────┘

             NOW PLAYING
        Song title / artist

           ◀   ▶   🔊

          UP NEXT
```

Keep the player visually integrated with the page, but never obscure it.

---

# 6. DESIGN PHILOSOPHY

The website should communicate the entire Chhath atmosphere with very few UI elements.

Avoid:

- giant menus
- excessive cards
- dashboard-like layouts
- excessive gradients
- generic purple/blue SaaS styling
- stock-photo aesthetics
- excessive text
- excessive animations
- unnecessary icons
- gamification

The design should be:

- minimalist
- premium
- cinematic
- spiritual
- warm
- Indian
- elegant
- atmospheric
- modern
- 3D
- highly interactive
- performant

Think of the website as a **digital art installation for Chhath**.

---

# 7. VISUAL CONCEPT

The central visual metaphor is:

## Sun + River + Ghat + Diya + Soop + Atmosphere

Do not try to render a photorealistic festival crowd.

Instead create an elegant abstract 3D environment.

For example:

- a calm 3D river surface
- a low-poly / stylized ghat silhouette
- a large sun
- subtle volumetric-looking light
- a few floating diyas
- minimal Chhath-inspired geometry
- soft atmospheric fog
- subtle particles
- distant hills/ghat silhouettes
- gentle water reflections

The scene should feel premium and artistic.

---

# 8. 3D TECHNOLOGY

Use:

**Three.js**

with:

**React Three Fiber**

and:

**@react-three/drei**

Use 3D only where it adds atmosphere.

Do not turn the website into a video game.

The 3D scene should be:

- low-poly
- stylized
- elegant
- lightweight
- GPU-conscious

Avoid extremely detailed models.

Prefer procedural geometry and simple meshes.

---

# 9. 3D SCENE

Create a scene containing approximately:

### Sun

A large glowing sphere/disc.

### River

A wide horizontal plane with subtle shader-based or procedural wave movement.

### Ghat

Minimal stepped geometry or a silhouette of a traditional riverside ghat.

### Diyas

Small glowing floating objects.

Use a small number.

### Atmosphere

Subtle particles and fog.

### Background

Minimal sky gradient or large background plane.

Do not use a heavy video background.

---

# 10. TIME-OF-DAY SYSTEM

The entire visual environment must change based on the user's local time.

Create a reusable:

`TimeOfDayEngine`

It should calculate:

- dawn
- morning
- afternoon
- sunset
- evening
- night

Do not use abrupt visual changes.

Use smooth interpolation.

---

# 11. DAWN

Approximate visual state:

04:30–06:30

Mood:

**Usha Arghya / sunrise**

Visuals:

- dark blue transitioning to orange
- rising sun
- light fog
- calm river
- few diyas
- soft golden horizon
- subtle birds if performant

Text:

**उषा अर्घ्य**

or:

**सुबह की पवित्र बेला**

Keep text minimal.

---

# 12. MORNING

Approximate:

06:30–11:00

Visuals:

- warm golden sky
- bright sun
- calm blue/golden river
- subtle reflections
- peaceful environment

Mood:

Fresh, spiritual, hopeful.

---

# 13. AFTERNOON

Approximate:

11:00–16:30

Visuals:

- brighter sky
- stronger sun
- cleaner blue atmosphere
- brighter river
- fewer glowing elements

Mood:

Warm, peaceful, energetic.

---

# 14. SUNSET / SANDHYA ARGHYA

Approximate:

16:30–19:00

This should be the most beautiful visual state.

Visuals:

- large orange sun near horizon
- orange/gold sky
- golden river
- long reflections
- multiple subtle diyas
- warm ghat silhouette
- atmospheric haze

Text:

**संध्या अर्घ्य**

This mode should feel emotionally powerful but still minimalist.

---

# 15. NIGHT

Approximate:

19:00–04:30

Visuals:

- deep navy sky
- moon
- stars
- dark river
- floating diyas
- subtle golden reflections
- very soft ambient glow

Mood:

Quiet, devotional, peaceful.

---

# 16. SMOOTH TIME TRANSITIONS

Do not simply switch themes at exact times.

Use interpolation.

Example:

```text
sunIntensity = lerp(previous, target, transitionProgress)
skyColor = lerp(previous, target, transitionProgress)
fogDensity = lerp(previous, target, transitionProgress)
```

The visual environment should transition smoothly.

---

# 17. INTERACTION

The user should be able to interact subtly with the 3D scene.

Possible interactions:

### Mouse movement

Very subtle parallax.

### Mouse drag

Allow gentle camera orbit within strict limits.

### Scroll

Very subtle camera movement.

### Mobile gyroscope

If permission is available, optional subtle device-based parallax.

Never allow the scene to become disorienting.

Provide reduced-motion support.

---

# 18. AUDIO/VISUAL REACTIVITY

Because the audio is being played inside YouTube's embedded player, do NOT attempt to extract raw audio data from YouTube.

Do not attempt to bypass YouTube's player or obtain an audio stream.

Instead, create optional visual transitions based on:

- playback state
- song change
- time elapsed
- selected category
- time of day

For example:

When a new song starts:

- gently brighten the diya glow
- create a small water ripple
- animate the song title into view

Do NOT claim that the 3D scene is reacting to the actual audio waveform unless a technically/legal supported audio source is later added.

---

# 19. HOME SCREEN

The homepage should be almost entirely visual.

Desktop composition:

```text
┌─────────────────────────────────────────────┐
│                                             │
│             CHHATH RADIO                    │
│                                             │
│       छठ के गीत, बिना रुके।                 │
│                                             │
│               3D GHAT                       │
│                                             │
│          ┌───────────────┐                  │
│          │   YOUTUBE     │                  │
│          │    PLAYER     │                  │
│          └───────────────┘                  │
│                                             │
│             NOW PLAYING                     │
│       Kaanch Hi Baans Ke Bahangiya          │
│                                             │
│              [ PLAY ]                       │
│                                             │
│               UP NEXT                       │
│                                             │
└─────────────────────────────────────────────┘
```

Do not literally use this ASCII layout.

Use it only as conceptual guidance.

---

# 20. BRANDING

Primary brand:

**CHHATH RADIO**

Hindi:

**छठ रेडियो**

Tagline:

**छठ के गीत, बिना रुके।**

Secondary:

**Non-stop Chhath Geet**

Logo concept:

A minimal sun rising above a river with a tiny diya.

Do not create a complex logo.

---

# 21. COLOR SYSTEM

Suggested colors:

```text
Night:
#0B1220

Deep River:
#123B52

River:
#245B73

Sun Gold:
#E9B949

Sun Orange:
#F4A62A

Deep Orange:
#D96B27

Sand:
#F5D7A1

Diya Gold:
#FFD76A

Text:
#FFF8E8
```

Do not use all colors simultaneously.

Use them according to the time-of-day scene.

---

# 22. TYPOGRAPHY

English:

Inter / Manrope / DM Sans

Hindi:

Noto Sans Devanagari

Large headings should be elegant and sparse.

---

# 23. NOW PLAYING

Display:

```text
NOW PLAYING

Song title

Artist

Bhojpuri · Traditional
```

When the song changes:

- update artwork/thumbnail if available
- update title
- update artist
- update category
- perform a subtle transition

---

# 24. UP NEXT

Display only 3–5 upcoming songs.

Example:

```text
UP NEXT

01  Uga Ho Suraj Dev
02  Hey Chhathi Maiya
03  Kelwa Ke Paat Par
```

Keep it minimal.

---

# 25. CURATED CHANNELS

Create:

- CHHATH RADIO
- BHOJPURI
- MAITHILI
- MAGAHI
- TRADITIONAL
- CHHATHI MAIYA
- SURYA DEV
- MORNING
- SANDHYA ARGHYA
- USHA ARGHYA

Changing channel should change the curated YouTube queue.

---

# 26. OWNER-CURATED SONG DATABASE

Create an admin interface where the owner can add YouTube videos.

Fields:

- title
- YouTube URL
- YouTube video ID
- artist
- language
- category
- thumbnail
- enabled
- sort order

The system should automatically extract the Video ID from standard YouTube URLs when possible.

Supported examples:

```text
https://www.youtube.com/watch?v=VIDEO_ID
https://youtu.be/VIDEO_ID
https://www.youtube.com/embed/VIDEO_ID
```

Validate the ID.

Do not download the video.

---

# 27. ADMIN DASHBOARD

Create a secure admin dashboard.

Sections:

## Songs

- add
- edit
- disable
- delete
- reorder

## Channels

- create
- edit
- reorder songs
- enable/disable

## Settings

- site title
- tagline
- Chhath dates
- featured channel
- time-of-day settings

## Analytics

Basic anonymous metrics:

- page views
- play button clicks
- song starts
- song completions
- skips
- channel selections
- shares
- Ghat Mode activations

---

# 28. CHHATH FESTIVAL MODE

Create configurable festival dates.

Support:

1. Nahai Khai
2. Kharna
3. Sandhya Arghya
4. Usha Arghya

During festival days, automatically change:

- visual environment
- featured channel
- greeting
- festival label

Example:

```text
आज
संध्या अर्घ्य

जय छठी मईया 🙏
```

Do not permanently hard-code festival dates.

Store them in settings/database.

---

# 29. GHAT MODE

Create:

**GHAT MODE**

When activated:

- maximize the 3D scene
- enter browser fullscreen where supported and only after user interaction
- minimize surrounding UI
- keep YouTube player visible and compliant
- show current song information
- keep essential controls available

The YouTube player must never be obscured by the 3D scene or any overlay.

This mode should be suitable for a TV/large display.

---

# 30. MOBILE

Design mobile separately.

Mobile priorities:

1. 3D atmosphere
2. YouTube player
3. Play
4. Now Playing
5. Up Next

Avoid tiny controls.

Use a bottom sheet or compact player information panel where appropriate.

---

# 31. PWA

Make it a Progressive Web App.

App name:

Chhath Radio

Short name:

Chhath Radio

Add:

- manifest
- icons
- install prompt where supported
- responsive splash
- mobile home-screen support

Do not claim that background audio playback will behave like a native app on every browser; browser/platform restrictions apply.

---

# 32. SEO

Create:

`/`

`/chhath-radio`

`/chhath-geet`

`/bhojpuri-chhath-geet`

`/maithili-chhath-geet`

`/chhathi-maiya-geet`

`/surya-dev-geet`

`/chhath-puja`

`/nahai-khai`

`/kharna`

`/sandhya-arghya`

`/usha-arghya`

Each page should have meaningful, unique content.

---

# 33. SHARING

Add:

- WhatsApp
- Copy Link
- Native Share API

Primary share message:

```text
🙏 जय छठी मईया 🙏

छठ के गीत बिना रुके सुनिए ❤️

🎵 CHHATH RADIO
```

---

# 34. CHHATH GREETING GENERATOR

Create:

**Create Chhath Greeting**

Inputs:

- name
- family name
- optional location

Generate a shareable greeting card.

Example:

```text
🙏 जय छठी मईया 🙏

[NAME] एवं [FAMILY] परिवार की ओर से
आपको एवं आपके परिवार को
छठ पूजा की हार्दिक शुभकामनाएँ।

☀️ सुख • शांति • समृद्धि ☀️
```

Allow:

- copy text
- native share
- WhatsApp share
- download generated image

---

# 35. TECH STACK

Use the following architecture.

## Frontend

**Next.js + React + TypeScript**

Use App Router.

## Styling

**Tailwind CSS**

## 3D

**Three.js**

**React Three Fiber**

**@react-three/drei**

## Animation

**Framer Motion**

Use Framer Motion for DOM/UI animation.

Use Three.js/R3F animation loop for the 3D scene.

## Backend

Use:

**Python + FastAPI**

The owner is highly comfortable with Python, so business logic/API should be implemented in FastAPI.

## Database

**PostgreSQL**

Prefer:

**Supabase PostgreSQL**

if using Supabase for infrastructure.

## ORM

Use:

**SQLAlchemy 2.x**

with:

**Alembic**

for migrations.

## Validation

Use:

**Pydantic v2**

## Authentication

Use:

**Supabase Auth**

or a secure FastAPI-compatible authentication approach.

Admin authentication must be protected.

## Deployment

Frontend:

Vercel

Backend:

Railway / Render / Fly.io / AWS

Database:

Supabase PostgreSQL

Do not unnecessarily introduce Kubernetes.

---

# 36. PROJECT ARCHITECTURE

Use a monorepo:

```text
chhath-radio/
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   ├── public/
│   └── styles/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── repositories/
│   │   └── core/
│   ├── alembic/
│   └── tests/
│
└── README.md
```

---

# 37. FRONTEND COMPONENTS

Create reusable components:

```text
ChhathScene
TimeOfDayEngine
River
Sun
Moon
Ghat
Diyas
Atmosphere
YouTubePlayer
RadioController
NowPlaying
UpNext
ChannelSelector
GhatMode
FestivalBanner
ChhathCountdown
ShareButtons
GreetingGenerator
```

---

# 38. BACKEND API

Create APIs approximately like:

```text
GET    /api/songs
GET    /api/songs/{id}

GET    /api/channels
GET    /api/channels/{id}

GET    /api/radio/queue

POST   /api/admin/songs
PATCH  /api/admin/songs/{id}
DELETE /api/admin/songs/{id}

POST   /api/admin/channels
PATCH  /api/admin/channels/{id}

GET    /api/settings
PATCH  /api/admin/settings

GET    /api/festival/current
```

Use clean REST conventions.

---

# 39. DATABASE MODEL

Suggested tables:

```text
songs
channels
channel_songs
festival_days
site_settings
analytics_events
admins
```

Song fields:

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
created_at
updated_at
```

Channel fields:

```text
id
name
slug
description
enabled
sort_order
```

Channel song fields:

```text
channel_id
song_id
sort_order
```

Festival day:

```text
id
name
slug
start_datetime
end_datetime
featured_channel_id
theme
message
```

---

# 40. IMPORTANT YOUTUBE RULE

Never build functionality that requires extracting the actual audio stream from YouTube.

The application must use:

**YouTube IFrame Player API**

and official embedded playback.

The YouTube player remains the source of playback.

The website only manages:

- selected video IDs
- queue
- metadata
- UI
- scene
- player commands
- playback state

---

# 41. YOUTUBE PRIVACY

Prefer the privacy-enhanced YouTube embed domain where compatible:

`youtube-nocookie.com`

Use the official embed/API mechanisms.

Do not imply that privacy-enhanced mode means "no ads".

---

# 42. AUTOPLAY

The application should gracefully handle browser autoplay restrictions.

First visit:

```text
CHHATH RADIO

छठ के गीत, बिना रुके।

[ ▶ PLAY RADIO ]
```

After user clicks:

Start the selected YouTube video.

Then continue to the next selected song when the current video ends, subject to YouTube/browser behavior.

---

# 43. PLAYER STATE

Implement:

```text
UNSTARTED
ENDED
PLAYING
PAUSED
BUFFERING
CUED
ERROR
```

Synchronize React state with YouTube player state.

Do not create duplicate player instances.

Clean up listeners on unmount.

---

# 44. PERFORMANCE

The 3D experience must not destroy performance.

Target:

- smooth desktop rendering
- acceptable mobile rendering
- low memory use
- no giant textures
- no unnecessary 3D models

Use:

- device pixel ratio limits
- lazy initialization
- lightweight geometries
- reduced effects on mobile
- reduced-motion support

For low-end devices, automatically reduce 3D complexity.

Possible quality levels:

```text
HIGH
MEDIUM
LOW
```

---

# 45. ACCESSIBILITY

Support:

- keyboard navigation
- screen readers
- focus states
- accessible buttons
- readable contrast
- reduced motion
- semantic HTML

Do not make the 3D scene the only way to understand the application.

---

# 46. ERROR STATES

If YouTube fails:

Display:

```text
Playback unavailable

Trying the next song...
```

Then automatically move to the next available song when possible.

If the selected video has embedding disabled:

skip it and log the problem.

Do not crash the application.

---

# 47. OWNER WORKFLOW

The owner should be able to:

1. Find a Chhath song on YouTube.
2. Copy the YouTube URL.
3. Open Chhath Radio Admin.
4. Click Add Song.
5. Paste URL.
6. Enter metadata.
7. Select categories/channels.
8. Save.
9. The song becomes available in the site's curated queue.

No YouTube scraping is required.

---

# 48. INITIAL SEED DATA

Create sample/demo entries using placeholder YouTube IDs.

Do NOT invent real YouTube IDs.

The owner will replace them with real selected videos.

---

# 49. CONTENT SAFETY / RIGHTS

The application should include a simple admin field:

`rights_notes`

and:

`embedding_allowed`

Only use videos that the site owner has decided are appropriate to embed and that remain available for embedding.

Do not provide copyright circumvention functionality.

---

# 50. FINAL DESIGN STANDARD

The finished result should feel like:

> **A digital Chhath ghat that happens to contain a YouTube music player.**

Not:

> a dashboard containing a YouTube iframe.

The 3D environment is the emotional identity.

The YouTube player is the functional engine.

The UI should disappear into the experience.

The user should open the site and immediately feel:

☀️ warmth

🌊 river

🪔 diya

🙏 devotion

🎵 Chhath music

---

# 51. IMPLEMENTATION ORDER

Build in this order:

### Phase 1

Project architecture.

### Phase 2

Homepage visual design.

### Phase 3

Three.js/R3F Chhath environment.

### Phase 4

Time-of-day engine.

### Phase 5

YouTube IFrame Player integration.

### Phase 6

Curated song catalog.

### Phase 7

Next-song queue.

### Phase 8

FastAPI backend.

### Phase 9

PostgreSQL database.

### Phase 10

Admin dashboard.

### Phase 11

Ghat Mode.

### Phase 12

PWA.

### Phase 13

SEO.

### Phase 14

Sharing and greeting generator.

### Phase 15

Performance/accessibility audit.

---

# 52. DO NOT OVERBUILD

Do not implement:

- user social profiles
- comments
- chat
- recommendations powered by AI
- payment system
- complex subscriptions
- custom audio streaming infrastructure
- video downloading
- YouTube scraping

Keep the first release focused.

The product is:

**Curated Chhath YouTube music + immersive 3D Chhath environment.**

---

# 53. ACCEPTANCE CRITERIA

The application is complete when:

- homepage loads quickly
- 3D Chhath scene is visible
- scene changes with local time
- YouTube player is visible and functional
- user can press Play
- selected YouTube video plays
- current song metadata is shown
- song end advances to next selected video
- curated channels work
- admin can add YouTube videos
- admin can reorder songs
- admin can enable/disable songs
- Ghat Mode works
- mobile layout works
- PWA works where supported
- SEO metadata exists
- no YouTube audio extraction exists
- no ad-blocking/circumvention exists
- YouTube player is not obscured by overlays
- no fake listener count is shown as real
- application handles unavailable/embedding-disabled videos gracefully

Build this as a polished production-quality application, not a simple landing page.
