# CHHATH RADIO — Technical Architecture

## 1. Architecture

Use a modular full-stack architecture:

```text
Browser
   │
   ▼
Next.js / React / TypeScript
   │
   ├── Radio Controller
   ├── YouTube Adapter
   ├── Time-of-Day Engine
   ├── Festival Engine
   ├── 3D Scene
   └── UI
   │
   │ HTTPS REST API
   ▼
FastAPI
   │
   ├── Songs
   ├── Channels
   ├── Radio Queue
   ├── Festival
   ├── Settings
   └── Admin
   │
   ▼
PostgreSQL
```

---

# 2. Frontend

Use:

- Next.js
- React
- TypeScript
- Tailwind CSS
- Three.js
- React Three Fiber
- Drei
- Framer Motion

Use strict TypeScript.

---

# 3. Backend

Use:

- Python
- FastAPI
- Pydantic v2
- SQLAlchemy 2.x
- Alembic
- PostgreSQL

---

# 4. Frontend Architecture

Recommended:

```text
src/
├── app/
├── components/
│   ├── radio/
│   ├── youtube/
│   ├── ghat/
│   ├── navigation/
│   └── ui/
├── features/
│   ├── radio/
│   ├── channels/
│   ├── festival/
│   └── settings/
├── hooks/
├── lib/
│   ├── api/
│   ├── time/
│   └── youtube/
├── types/
└── styles/
```

---

# 5. Radio Controller

Create one central radio controller.

Responsibilities:

- current song
- queue
- queue index
- play state
- next
- previous if supported
- channel changes
- player lifecycle
- error recovery

Do not duplicate queue logic across components.

---

# 6. YouTube Adapter

Use an abstraction:

```text
YouTubePlayerAdapter
```

Production implementation:

```text
YouTubeIFramePlayerAdapter
```

Testing implementation:

```text
MockYouTubePlayerAdapter
```

This keeps business logic independent from the YouTube SDK.

---

# 7. Time-of-Day Engine

Create:

```text
TimeOfDayEngine
```

Output:

```typescript
type TimeOfDay =
  | "DAWN"
  | "MORNING"
  | "AFTERNOON"
  | "SUNSET"
  | "EVENING"
  | "NIGHT";
```

Expose environmental parameters.

---

# 8. Festival Engine

Create:

```text
FestivalEngine
```

It determines:

- current festival state
- active festival label
- featured mood
- configured festival schedule

Do not mix festival-date logic with visual rendering.

---

# 9. 3D Scene Architecture

Use React Three Fiber.

Suggested components:

```text
GhatScene
├── Sky
├── Sun
├── Moon
├── River
├── Ghat
├── Diyas
├── Atmosphere
└── CameraController
```

Each component should consume centralized environment state.

---

# 10. Performance

Use:

- lazy-loaded 3D scene
- capped device pixel ratio
- adaptive quality
- limited geometry
- limited particles
- reduced shadows
- optional post-processing

---

# 11. WebGL Fallback

If WebGL cannot initialize:

```text
StaticGhatBackground
```

must replace the 3D scene.

The rest of the application remains functional.

---

# 12. Backend Architecture

Recommended:

```text
app/
├── main.py
├── api/
├── models/
├── schemas/
├── services/
├── repositories/
├── auth/
├── db/
└── core/
```

Separate:

```text
API
→ Service
→ Repository
→ Database
```

Avoid putting database logic directly in route handlers.

---

# 13. Services

Recommended:

```text
SongService
ChannelService
RadioService
FestivalService
SettingsService
AdminService
```

---

# 14. API

REST API under:

```text
/api/*
```

Use Pydantic request/response schemas.

Generate OpenAPI automatically from FastAPI.

---

# 15. Database

PostgreSQL is the production source of truth.

Use SQLAlchemy models.

Use Alembic migrations.

---

# 16. Caching

Public catalog responses may be cached.

Admin data should not be served from stale cache.

Do not cache sensitive admin responses publicly.

---

# 17. Authentication

Admin authentication must be backend-enforced.

Never trust frontend role flags.

---

# 18. Configuration

Use environment variables:

```text
DATABASE_URL
APP_ENV
SECRET_KEY
ADMIN_AUTH_CONFIGURATION
PUBLIC_BASE_URL
```

Provide `.env.example`.

---

# 19. Error Boundaries

Frontend:

- React error boundary around major application sections
- separate fallback for 3D
- player errors handled independently

Backend:

- structured API errors
- centralized exception handling

---

# 20. Observability

Minimum:

- structured logs
- request IDs
- health endpoint
- readiness endpoint

Optional:

- Sentry
- OpenTelemetry

Only add these if required.

---

# 21. Architecture Principle

The core radio experience must work even if:

- 3D fails
- animation fails
- analytics fails
- one YouTube video fails

Only the essential dependencies should be capable of blocking playback.
