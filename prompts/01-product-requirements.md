# CHHATH RADIO — Product Requirements Document

## 1. Product Vision

CHHATH RADIO is a premium, immersive web experience for continuously listening to a curated collection of Chhath songs through official YouTube embedded playback.

The experience should feel like:

> A quiet digital Chhath ghat where the music never stops.

The product combines:

- curated Chhath songs
- official YouTube embedded player
- non-stop queue behavior
- minimalist 3D river/ghat environment
- time-of-day visual changes
- Chhath festival context
- responsive web experience
- optional Ghat Mode for large screens

---

# 2. Primary User

The primary user wants to:

1. Open the website.
2. Immediately understand that it is a Chhath music radio.
3. Press Play.
4. Listen continuously.
5. See what song is currently playing.
6. Let the site automatically move to the next curated song.
7. Experience a changing Chhath atmosphere based on time of day.

The user should not need to search YouTube manually.

---

# 3. Core Experience

Homepage:

```text
                CHHATH RADIO
             छठ के गीत, बिना रुके।

                    [ PLAY ]

        ┌─────────────────────────┐
        │                         │
        │    YOUTUBE PLAYER       │
        │                         │
        └─────────────────────────┘

              NOW PLAYING
          Current Song Title

                UP NEXT
          Song A · Song B · Song C
```

The actual visual environment should be a minimalist 3D river/ghat scene.

---

# 4. MVP Features

## Must Have

- Homepage
- Official YouTube embedded player
- Curated song catalog
- Radio queue
- Automatic next-song handling
- Play/pause
- Next song
- Current song information
- Up Next list
- Channel/category support
- Time-of-day visual engine
- Responsive layout
- Ghat Mode
- WebGL fallback
- Admin song management
- PostgreSQL persistence
- FastAPI backend
- Automated testing

---

# 5. Channels

Initial channels may include:

```text
All Chhath
Bhojpuri Chhath
Maithili Chhath
Traditional Chhath
Chhathi Maiya
Surya Dev
Sandhya Arghya
Usha Arghya
```

Channels are curated moods, not necessarily separate technical radio stations.

---

# 6. Song Catalog

Each song should have:

```text
title
artist
youtube_video_id
youtube_url
language
category
channel
thumbnail
enabled
sort_order
```

Only enabled songs participate in public playback.

---

# 7. Radio Behavior

When user starts radio:

```text
Select queue
       ↓
Select current song
       ↓
Load YouTube video
       ↓
Play if permitted
       ↓
Listen
       ↓
ENDED
       ↓
Select next valid song
       ↓
Repeat
```

If a song cannot be played, skip it.

---

# 8. User Controls

Minimum:

- Play
- Pause
- Next
- Channel
- Up Next
- Ghat Mode
- Volume through YouTube player
- Mute / Unmute
- Chhath Facts panel toggle

Do not build unnecessary music-player controls that duplicate YouTube functionality.

---

# 8a. Keyboard Shortcuts

The radio must support a full set of keyboard shortcuts for hands-free control.

All shortcuts must be:

- documented in the UI (visible shortcut hint overlay or tooltip)
- accessible via a keyboard shortcut reference panel
- non-conflicting with browser defaults where possible

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `M` | Mute / Unmute |
| `↑` (Up Arrow) | Volume +10% |
| `↓` (Down Arrow) | Volume −10% |
| `←` (Left Arrow) | Seek backward 10 seconds |
| `→` (Right Arrow) | Seek forward 10 seconds |
| `Shift + ←` | Previous song |
| `Shift + →` | Next song |
| `F` | Toggle Chhath Facts panel |
| `G` | Toggle Ghat Mode |
| `?` | Show / hide keyboard shortcut reference |
| `Escape` | Close any open panel / exit Ghat Mode |

Implementation notes:

- Keyboard shortcuts must not fire when focus is inside a text input or textarea.
- Volume control via keyboard must use the YouTube IFrame Player API (`setVolume`, `mute`, `unMute`).
- Seek via keyboard must use `seekTo()` from the YouTube IFrame Player API.
- Previous song (`Shift + ←`) restarts the current song if more than 3 seconds have elapsed; otherwise goes to the previous song in the queue.
- All shortcuts must be announced to screen readers via `aria-live` region.
- Shortcut hints should appear as small labels on relevant UI buttons (e.g., `[Space]` beside Play).

---

# 8b. Chhath Facts Feature

CHHATH RADIO includes a curated panel of interesting cultural facts about the Chhath festival.

Purpose:

- Educate visitors about the cultural and spiritual significance of Chhath Puja.
- Enrich the listening experience with contextual knowledge.
- Feel like a natural extension of the immersive ghat environment.

Behavior:

- The panel is toggled by pressing `F` on the keyboard or clicking a dedicated icon button in the UI.
- The panel slides in from the side or appears as a floating overlay (consistent with the design language).
- Facts are displayed one at a time with a subtle transition.
- The user can navigate between facts using arrow keys or swipe on mobile.
- Facts cycle automatically every 30 seconds when the panel is open (configurable).
- The panel can be dismissed with `Escape` or the close button.

Fact content:

Each fact entry should contain:

```text
icon        — a culturally relevant Lucide icon or custom SVG symbol
title       — short heading (e.g., "Surya Dev")
body        — 1–3 sentences of factual content
category    — e.g., Ritual, History, Significance, Food, Nature
```

Example facts:

```text
☀ Surya Dev
Chhath Puja is one of the few Hindu festivals dedicated to the Sun God (Surya Dev)
and his consort Usha (the dawn). Devotees offer arghya to the setting and rising sun.
Category: Significance

🌊 The Sacred River
The ritual of standing in water during Chhath symbolizes purification and gratitude.
The Ganga, Kosi, and Gandak rivers are among the most sacred sites for the festival.
Category: Ritual

🪔 Thekua
Thekua is the traditional prasad of Chhath — a sweet fried wheat and jaggery biscuit
offered to Surya Dev. It is prepared with great care and devotion.
Category: Food

🌅 Four-Day Festival
Chhath spans four days: Nahai Khai, Kharna, Sandhya Arghya, and Usha Arghya.
Each day has specific rituals, fasting rules, and offerings.
Category: History
```

Admin management:

- Admin can add, edit, enable/disable, and reorder Chhath facts.
- Facts are stored in the database.
- Facts can be assigned a category and an icon identifier.

UI placement:

- A subtle icon button (e.g., a sun or book icon) in the main UI triggers the panel.
- The button should show a keyboard shortcut hint: `[F]`.
- On mobile, the button is accessible in the bottom control bar.
- The panel must not obscure the YouTube player.

Accessibility:

- The panel must be keyboard navigable.
- Facts must be readable by screen readers.
- The panel must be closeable via `Escape`.
- Auto-cycling must pause when the panel has keyboard focus.

---

# 9. Time-of-Day Experience

The environment changes according to local browser time.

States:

```text
DAWN
MORNING
AFTERNOON
SUNSET
EVENING
NIGHT
```

Each state modifies:

- sky
- sunlight
- river
- fog
- lighting
- diya intensity
- atmosphere

---

# 10. Chhath Festival States

Support configurable festival states:

```text
NAHAI_KHAI
KHARNA
SANDHYA_ARGHYA
USHA_ARGHYA
```

Festival state may influence:

- label
- featured channel
- visual mood
- curated playlist

---

# 11. Ghat Mode

Ghat Mode is intended for:

- television
- large monitors
- ambient listening

It should minimize:

- navigation
- secondary information
- controls

It should emphasize:

- river
- sun
- ghat
- diyas
- current song
- YouTube player

---

# 12. Admin

Admin must be able to:

- login
- create songs
- edit songs
- disable songs
- delete songs
- reorder songs
- create/edit channels
- assign songs to channels
- configure festival states
- configure site settings

---

# 13. Admin Song Workflow

```text
Admin Login
    ↓
Add Song
    ↓
Paste YouTube URL
    ↓
Extract Video ID
    ↓
Validate
    ↓
Enter Metadata
    ↓
Save
    ↓
Enable
    ↓
Song enters queue
```

---

# 14. Public Pages

MVP:

```text
/
 /channels
 /channel/[slug]
 /about
```

Admin:

```text
/admin
/admin/songs
/admin/channels
/admin/settings
```

Keep public page count small.

---

# 15. About Page

Explain briefly:

- what CHHATH RADIO is
- that songs are played through YouTube embeds
- curated nature of the catalog
- cultural purpose

Do not make this a long marketing page.

---

# 16. Sharing

Allow sharing of the website/current channel where practical.

Shared URL should open a useful page.

Do not attempt to share a hidden/custom audio stream.

---

# 17. Mobile

Mobile must prioritize:

1. Play
2. Player
3. Current song
4. Next songs
5. Channel selection

The 3D environment should simplify automatically.

---

# 18. Desktop

Desktop should prioritize:

- immersive environment
- large player
- atmosphere
- current song
- queue

---

# 19. Success Criteria

A successful visitor should be able to:

```text
Open
→ Understand
→ Play
→ Listen
→ See current song
→ Automatically hear next song
→ Enjoy changing atmosphere
```

with minimal interaction.

---

# 20. Product Principle

The website is not trying to compete with YouTube as a general music platform.

It is a **curated Chhath listening experience**.

---

# 21. Engagement Features (Phase 2)

The following features were added in Phase 2 to increase engagement, shareability, and cultural immersion.

## 21.1 Animated Listener Count Badge

**Component:** `frontend/components/radio/ListenerCount.tsx`

Displays the real-time listener count with two visual modes:

- **Calm mode** (< 50 listeners): amber pulsing dot + "N listeners right now"
- **Hot mode** (≥ 50 listeners): red heartbeat-glow badge + "🔴 LIVE — N log sun rahe hain"

The heartbeat animation (`@keyframes heartbeat`) is defined in `globals.css` and uses a double-beat pulse with a red box-shadow glow. The count is formatted with `Intl.NumberFormat("en-IN")` for Indian number formatting (e.g., 1,24,567).

The threshold (`HOT_THRESHOLD = 50`) is a compile-time constant in the component.

## 21.2 WhatsApp Song Request Button

**Component:** `frontend/components/radio/WhatsAppRequest.tsx`

A "Gaana request karein" button that opens a pre-filled WhatsApp message to the station's number.

- Zero backend work — pure client-side `wa.me` deep link
- Pre-fills the current song title and artist in the message
- Includes Chhath Radio branding and blessing line
- Hidden if `NEXT_PUBLIC_WHATSAPP_NUMBER` env var is not set
- Uses the official WhatsApp green (`#25D366`) with a hover glow

**Configuration:**
```env
NEXT_PUBLIC_WHATSAPP_NUMBER=919876543210   # country code + number, no +
```

## 21.3 Shareable "Now Playing" OG Card

**Routes:**
- `frontend/app/share/page.tsx` — full-screen share card page
- `frontend/app/share/og-image/route.tsx` — dynamic OG image (1200×630 PNG via `ImageResponse`)

**Usage:**
```
/share?title=Kaanch+Hi+Baans&artist=Sharda+Sinha
```

The share page renders a beautiful dark card with the song title, artist, diya decorations, and a CTA link. The OG image is generated server-side (Edge runtime) and used by WhatsApp, Twitter, and Instagram for link previews.

The `NowPlaying` component has a "Share" button that:
1. Uses `navigator.share()` on mobile (native share sheet)
2. Falls back to `navigator.clipboard.writeText()` on desktop
3. Shows a "Link copied!" confirmation for 2 seconds

## 21.4 Virtual Jal Arghya (Water Offering)

**Component:** `frontend/components/radio/JalArghya.tsx`

An interactive feature where users tap a sun/water circle to offer virtual jal arghya to Chhathi Maiya.

**Behavior:**
- Each tap creates an animated water ripple at the tap position
- A floating "💧 Jal Arghya" text floats upward and fades
- A random blessing from 25 curated Hindi/Bhojpuri blessings appears for 2.5 seconds
- The offering count is persisted in `localStorage` (key: `chhath_arghya_count`)
- The button animates with a scale-down + blue glow on tap
- Keyboard accessible (Enter / Space)

**Blessings pool:** 25 unique entries covering Chhathi Maiya, Surya Dev, family blessings, and festival greetings.

**localStorage key:** `chhath_arghya_count`

---

# 22. Scale Architecture (Phase 3)

See `SCALE_PLAN.md` for the full scale-to-millions architecture plan.

**Summary of bottlenecks and fixes:**

| Component | Current limit | Fix |
|---|---|---|
| FastAPI (single Uvicorn) | ~500–2000 req/s | Gunicorn multi-worker + load balancer |
| Presence heartbeat (HTTP polling) | ~67K req/s at 1M users | Replace with SSE / WebSocket |
| PostgreSQL (song queue) | Read-heavy, easily cached | Redis cache for `/api/radio/queue` |
| Redis presence | Handles millions of keys | Already fine |
| Frontend (Vercel/CDN) | Millions of users | Already fine — static assets CDN-cached |

The single biggest change for millions of users: replace the polling presence system with **Server-Sent Events (SSE)**. At 1M concurrent listeners, 67,000 HTTP requests per second will overwhelm a single VPS. With SSE, one persistent connection per listener is far cheaper.
The curation and atmosphere are the product.
