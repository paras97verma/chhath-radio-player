# CHHATH RADIO — Comprehensive Implementation & Engineering Plan

This document is the definitive, step-by-step blueprint for building **CHHATH RADIO**. It is designed to be extremely verbose, precise, and beginner-friendly, ensuring that any developer—regardless of experience—can follow it to create a bug-free, production-grade application.

**Every rule in this document must be treated as a strict technical requirement.**

---

## 1. Product Vision & Strict Constraints

**CHHATH RADIO** (छठ के गीत, बिना रुके) is a premium, immersive web experience for continuously listening to a curated collection of Chhath songs. It feels like standing on a digital Chhath ghat where the music never stops.

### 🚫 The Absolute Golden Rules
1. **Official YouTube Embed ONLY**: The music is played through the official YouTube IFrame Player API.
2. **NO Audio Downloading**: Do not use `yt-dlp`, scraping, proxying, or any method to download or extract the raw audio/video files.
3. **NO Ad-Blocking**: The app must not attempt to block, hide, or circumvent YouTube advertisements. If YouTube serves an ad, it plays normally.
4. **NO Fake Players**: The YouTube player must remain a genuine, visible embedded player. Do not cover it with opaque overlays or build custom buttons that pretend to be the actual YouTube controls.
5. **Single Player Rule**: There is only ever **one** YouTube iframe on the page. You do not create a new iframe for every song; you instruct the existing iframe to load a new video ID.
6. **No Public Login**: Regular visitors do not need accounts. The only login system is for the site administrator.

---

## 2. Technical Architecture & Tech Stack

The application uses a modern, modular, full-stack architecture.

### Frontend
*   **Framework**: Next.js (React) using the App Router.
*   **Language**: Strict TypeScript.
*   **Styling**: Tailwind CSS.
*   **3D Engine**: Three.js integrated via React Three Fiber (R3F) and Drei.
*   **Animation**: Framer Motion (for UI transitions).

### Backend
*   **Framework**: FastAPI (Python).
*   **Validation**: Pydantic v2.
*   **Database ORM**: SQLAlchemy 2.x.
*   **Migrations**: Alembic.
*   **Database**: PostgreSQL (Source of truth).
*   **Realtime/Cache**: Redis (for tracking active listeners).

### Testing
*   **Frontend**: Vitest, React Testing Library.
*   **E2E (Browser)**: Playwright (Chromium, Firefox, WebKit).
*   **Backend**: Pytest with an isolated PostgreSQL test database.

---

## Phase 1: Project Initialization & Directory Structure

**Goal:** Set up the foundational skeleton for the frontend and backend.

### 1.1 Backend Setup (`/backend`)
1.  Initialize a Python virtual environment.
2.  Install dependencies: `fastapi`, `uvicorn`, `sqlalchemy`, `alembic`, `psycopg2-binary`, `pydantic`, `pytest`, `pyjwt`, `passlib`.
3.  Create the following folder structure:
    *   `app/api/`: Route handlers (Controllers).
    *   `app/models/`: SQLAlchemy database models.
    *   `app/schemas/`: Pydantic validation schemas.
    *   `app/services/`: Business logic.
    *   `app/core/`: Settings and configuration.
    *   `app/db/`: Database connection and session management.
4.  Configure Alembic (`alembic init alembic`) to point to the `app.models` metadata.

### 1.2 Frontend Setup (`/frontend` or root)
1.  Run `npx create-next-app@latest` (select TypeScript, Tailwind, App Router).
2.  Create the following structure:
    *   `src/app/`: Next.js pages and layouts.
    *   `src/components/radio/`: UI specific to the radio (Player, Queue).
    *   `src/components/ghat/`: 3D React Three Fiber components.
    *   `src/components/ui/`: Reusable Tailwind components (Buttons, Panels).
    *   `src/lib/`: API clients, utility functions, Time-of-Day engine logic.

### 1.3 Local Development Docker
1.  Create a `docker-compose.yml` at the project root.
2.  Define a `postgres` service (image: `postgres:15-alpine`).
3.  Define a `redis` service (image: `redis:alpine`).
4.  *For Newbies:* This means developers only need to run `docker compose up -d` to have a fully working database and cache on their laptop.

---

## Phase 2: Database Schema & Core API

**Goal:** Build the authoritative PostgreSQL database and the REST APIs to manage and retrieve data.

### 2.1 Database Models (SQLAlchemy)
Create these exact tables:
*   **songs**: `id` (UUID), `title` (String), `artist` (String), `youtube_video_id` (String, required), `youtube_url` (Text), `category` (String), `enabled` (Boolean, default True), `sort_order` (Integer).
*   **channels**: `id` (UUID), `name` (String), `slug` (String, unique), `enabled` (Boolean).
*   **channel_songs**: A many-to-many relationship table linking `channels.id` and `songs.id` with a `sort_order`.
*   **festival_days**: `id` (UUID), `date` (Date), `state` (String e.g., 'SANDHYA_ARGHYA'), `title` (String).
*   **site_settings**: Key-value pairs for global config.
*   **admins**: `id` (UUID), `email` (String), `password_hash` (String).

### 2.2 Public REST API (FastAPI)
These endpoints do not require authentication:
*   `GET /api/songs`: Returns a list of *only enabled* songs.
*   `GET /api/channels/{slug}`: Returns channel metadata and its curated list of enabled songs.
*   `GET /api/radio/queue`: Returns the deterministic queue of songs for the default radio.
*   `GET /api/festival/current`: Checks today's date against `festival_days` and returns the active festival state (if any).

### 2.3 Secure Admin REST API
These endpoints require a JWT token in the `Authorization: Bearer <token>` header:
*   `POST /api/admin/login`: Accepts email/password, returns JWT.
*   `POST /api/admin/songs`: Creates a new song. **Logic Rule:** It must parse the provided YouTube URL to extract just the 11-character `youtube_video_id`.
*   `PATCH /api/admin/songs/{id}` & `DELETE /api/admin/songs/{id}`.
*   *Validation Rule:* Never trust frontend input. Validate URLs, ensure IDs are UUIDs, and sanitize text using Pydantic.

---

## Phase 3: The YouTube Player Adapter (The Engine)

**Goal:** Create a clean, decoupled bridge between our React app and the official YouTube IFrame API.

### 3.1 The Adapter Interface
To make our code testable, we don't hardcode YouTube logic directly into UI components. We define a TypeScript interface:
```typescript
interface YouTubePlayerAdapter {
  initialize(container: HTMLElement): Promise<void>;
  loadVideo(videoId: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  getState(): string; // e.g., 'PLAYING', 'ENDED'
  onStateChange(callback: (state: string) => void): () => void;
  destroy(): void;
}
```

### 3.2 Production Implementation (`YouTubeIFramePlayerAdapter`)
1. Dynamically injects the `https://www.youtube.com/iframe_api` script.
2. Creates a `new window.YT.Player`.
3. Maps YouTube's obscure state numbers (e.g., `0` for Ended, `1` for Playing, `3` for Buffering) into readable strings (`ENDED`, `PLAYING`, `BUFFERING`).
4. **Crucial Rule:** The `destroy()` method must remove event listeners to prevent memory leaks in React.

### 3.3 Test Implementation (`MockYouTubePlayerAdapter`)
1. A fake class used *only* during automated testing.
2. It allows our tests to say `mockAdapter.simulateSongEnd()` without actually connecting to YouTube.

---

## Phase 4: The Radio Queue Controller

**Goal:** Manage the queue of songs and handle automatic progression.

### 4.1 State Management (React Context / Zustand)
We need a central `RadioController` that tracks:
*   `queue`: Array of song objects.
*   `currentIndex`: Number.
*   `playState`: 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'ERROR'.

### 4.2 The Queue Algorithm
When the `YouTubePlayerAdapter` emits an `ENDED` event:
1.  Check if `currentIndex + 1` exists in the queue.
2.  If it exists, update `currentIndex`.
3.  Tell the adapter to `loadVideo(queue[currentIndex].youtube_video_id)`.
4.  Update the "Now Playing" UI metadata.

### 4.3 Error Recovery
If a YouTube video is private, deleted, or blocks embedding, YouTube emits an `ERROR` event.
*   **Rule:** The app must NOT crash.
*   **Action:** Log the error, mark the song as 'skipped', immediately advance `currentIndex`, and attempt to load the next song.

### 4.4 Session Guard (Race Condition Prevention)
When a user clicks "Next" rapidly, or switches channels, we must generate a random `radioSessionId`. Old YouTube events tied to a previous session must be ignored so they don't accidentally skip songs in the new queue.

---

## Phase 5: The 3D Ghat Environment & Time-of-Day

**Goal:** Build the immersive visual identity that makes Chhath Radio unique.

### 5.1 The `TimeOfDayEngine` (TypeScript Utility)
A function that takes the user's local browser time and returns a state:
*   `04:30–06:30` -> `DAWN` (Usha Arghya mood: dark blue, orange horizon).
*   `06:30–11:00` -> `MORNING` (Fresh, bright golden sun).
*   `11:00–16:30` -> `AFTERNOON` (Clear sky, bright river).
*   `16:30–19:00` -> `SUNSET` (Sandhya Arghya mood: deep orange, long reflections).
*   `19:00–04:30` -> `NIGHT` (Deep navy, moon, glowing diyas).

### 5.2 React Three Fiber (`GhatScene`)
1.  **River:** A wide plane geometry with a custom shader (or Drei's `Water` component) to simulate slow, calming ripples.
2.  **Sun/Moon:** A glowing sphere positioned on the horizon based on the time of day.
3.  **Diyas:** 3 to 10 small floating objects emitting warm point lights.
4.  **Ghat Silhouette:** A minimal, low-poly stepped geometry in the background. Do not use high-res realistic architectural models.

### 5.3 Interpolation & Performance
*   Colors and fog density must transition *smoothly* using `THREE.MathUtils.lerp()`. Do not snap abruptly from Day to Night.
*   **Accessibility Rule:** If `window.matchMedia('(prefers-reduced-motion: reduce)')` is true, disable camera parallax and slow down river waves.

---

## Phase 6: Public Presence (Real-time Listener Count)

**Goal:** Show a live count of how many people are listening right now, without requiring login.

### 6.1 The Logic
1.  When a user opens the site, generate a random UUID (`anonymous_session_id`) in `localStorage`.
2.  Every 15 seconds, the frontend sends a `POST /api/presence/heartbeat` request containing this ID.
3.  The FastAPI backend stores this ID in **Redis** with a Time-To-Live (TTL) of 45 seconds.
4.  If the user closes the tab, the heartbeat stops, and Redis automatically deletes the ID after 45 seconds.

### 6.2 The Display
*   The frontend polls `GET /api/presence/listeners` (or uses a WebSocket) to get the total count of keys in Redis.
*   Displays: `● 1,284 listening now` in the UI.

---

## Phase 7: UI Assembly & Polish

**Goal:** Construct the HTML/Tailwind interface that sits on top of the 3D scene.

### 7.1 Visual Hierarchy
*   **Z-Index 0:** The 3D Canvas (Background).
*   **Z-Index 10:** Translucent UI panels (Smoked glass effect: low opacity background, subtle backdrop blur, thin 1px border).
*   **Z-Index 20:** The YouTube Player.

### 7.2 Core Components
*   **Now Playing Panel:** Displays song title and artist. Must fade smoothly when songs change.
*   **Up Next Panel:** Shows the next 3 songs in the queue.
*   **Play/Pause Controls:** A prominent "PLAY RADIO" button. *Note on Mobile Autoplay:* Mobile browsers prevent audio from auto-starting without a physical screen tap. The user MUST tap this button to start the experience.
*   **Ghat Mode:** A button that fades out all UI elements except the YouTube player and the Now Playing text, intended for viewing on a TV.
*   **Chhath Facts:** A side panel toggled by pressing the `F` key, displaying curated cultural facts.

---

## Phase 8: Admin Dashboard UI

**Goal:** A protected web interface for the owner to manage the radio.

1.  Create a route at `/admin`.
2.  Implement a login screen that stores the JWT in an `HttpOnly` cookie or secure storage.
3.  **Song Catalog UI:** A data table listing all songs.
4.  **Add Song Form:** 
    *   Input: "Paste YouTube URL".
    *   Action: Frontend validates the URL, extracts the ID, and fetches the thumbnail for preview.
5.  **Toggles:** A simple switch to quickly mark a song as "Enabled" or "Disabled" (instantly removing it from the public queue if a video breaks).

---

## Phase 9: Quality Assurance & E2E Testing

**Goal:** Ensure the app never breaks in production.

### 9.1 Backend Testing (Pytest)
*   Write tests to ensure `/api/admin/*` endpoints reject requests without a valid token (401 Unauthorized).
*   Write tests to ensure the queue logic returns songs in the correct `sort_order`.

### 9.2 Frontend & E2E Testing (Playwright)
*   Write a script that boots the app, clicks "Play", uses the `MockYouTubePlayerAdapter` to emit an `ENDED` event, and verifies that the UI updates to the next song automatically.
*   Test the app at different viewport sizes (Mobile `390x844`, Desktop `1440x900`).
*   Test that clicking the "Channel" button resets the queue correctly.

### 9.3 Accessibility (Axe-core)
*   Ensure all buttons have `aria-labels`.
*   Ensure the "Now Playing" area has an `aria-live` region so screen readers announce song changes.

---
*End of Plan. Execution should strictly follow these phases, completing tests for each before moving to the next.*
