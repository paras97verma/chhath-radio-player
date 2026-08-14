# 🪔 Chhath Radio

> A culturally-immersive internet radio platform for Chhath Puja — live music, virtual offerings, ambient ghat sounds, and the spirit of the Ghat, anywhere in the world.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688)](https://fastapi.tiangolo.com)

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎵 **Live Radio** | Continuous YouTube-backed song queue with auto-advance |
| 👥 **Listener Count** | Animated LIVE badge — heartbeat glow when count is high |
| 📋 **Song Queue** | See what's coming up next |
| 📱 **WhatsApp Requests** | One-tap song request via WhatsApp (`Gaana request karein`) |
| 🌊 **Ghat Ambience** | Layered ambient sounds — water, birds, bells, crickets — auto-matched to time of day |
| 🪔 **Jal Arghya** | Virtual sun offering with animated water ripple and 25 personalised blessings |
| ⏳ **Chhath Countdown** | Live countdown (days/hours/minutes/seconds) to the next Chhath event |
| 🔗 **Share Card** | `/share` route with OG image for Instagram Stories / WhatsApp previews |
| 🌅 **3D Ghat Scene** | Three.js ghat environment that changes with time of day |

---

## 🏗️ Architecture

```
chhath-radio/
├── frontend/                  # Next.js 14 (App Router, TypeScript, Tailwind)
│   ├── app/
│   │   ├── page.tsx           # Main radio page
│   │   ├── share/             # Shareable Now Playing card
│   │   │   ├── page.tsx       # Share card page
│   │   │   └── og-image/      # Dynamic OG image (Edge runtime)
│   │   └── admin/             # Admin panel
│   ├── components/
│   │   ├── radio/             # Core radio UI components
│   │   │   ├── RadioPlayer.tsx
│   │   │   ├── NowPlaying.tsx
│   │   │   ├── Controls.tsx
│   │   │   ├── UpNext.tsx
│   │   │   ├── ListenerCount.tsx
│   │   │   ├── WhatsAppRequest.tsx
│   │   │   ├── JalArghya.tsx
│   │   │   ├── GhatAmbience.tsx
│   │   │   ├── ChhathCountdown.tsx
│   │   │   └── ChhathFacts.tsx
│   │   └── ghat/              # 3D scene components
│   ├── lib/                   # Utilities (api, store, time-of-day)
│   └── public/sounds/         # Ambient MP3 files (committed to git)
├── backend/                   # FastAPI (Python 3.11)
│   ├── app/
│   │   ├── api/               # REST endpoints
│   │   ├── models/            # SQLAlchemy models
│   │   └── services/          # Business logic
│   ├── tests/                 # pytest unit + integration tests
│   └── gunicorn.conf.py       # Production multi-worker config
├── scripts/
│   ├── import_songs.py        # YouTube bulk-import tool
│   └── download-sounds.sh     # Ambient sound downloader (run once)
├── local/                     # Docker Compose for local dev
├── SCALE_PLAN.md              # Scale-to-millions architecture plan
└── Makefile                   # All common tasks
```

**Stack:** Next.js · FastAPI · PostgreSQL · Redis · Docker · Gunicorn + Uvicorn

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local frontend dev)
- Python 3.11+ (for local backend dev)
- `make` (GNU Make)

### 1. Clone and configure

```bash
git clone https://github.com/your-org/chhath-radio.git
cd chhath-radio
cp backend/.env.example backend/.env
# Edit backend/.env — set DATABASE_URL, REDIS_URL, SECRET_KEY
```

### 2. Start everything with Docker

```bash
make start
```

This starts: PostgreSQL, Redis, FastAPI backend, Next.js frontend.

### 3. Open the app

- **Frontend:** http://localhost:3000
- **API docs:** http://localhost:8000/docs

---

## 🛠️ Development

### Common commands

```bash
make start          # Start all services (Docker)
make stop           # Stop all services
make logs           # Tail all logs
make logs-backend   # Backend logs only
make logs-frontend  # Frontend logs only
make shell-backend  # Shell into backend container
make shell-frontend # Shell into frontend container
make migrate        # Run DB migrations
make test           # Run all tests
make test-backend   # Backend tests only (pytest)
make test-frontend  # Frontend tests only (vitest)
make lint           # Lint all code
make clean          # Remove containers and volumes
```

### Running tests

```bash
make test           # All tests
make test-backend   # pytest (backend)
make test-frontend  # vitest (frontend)
make test-cov       # With coverage reports
```

---

## 🎵 Importing Songs

Bulk-import songs from YouTube:

```bash
# Single video
python scripts/import_songs.py --url "https://youtube.com/watch?v=..."

# Playlist
python scripts/import_songs.py --playlist "https://youtube.com/playlist?list=..."

# From a text file (one URL per line)
python scripts/import_songs.py --file urls.txt

# Dry run (preview without importing)
python scripts/import_songs.py --file urls.txt --dry-run
```

Or via Makefile:

```bash
make import-songs FILE=urls.txt TOKEN=<admin-jwt>
make import-songs-dry FILE=urls.txt
```

---

## 🌊 Ghat Ambient Sounds

Sound files live in `frontend/public/sounds/` and are committed to git.

To download/refresh them:

```bash
bash scripts/download-sounds.sh
# or
make download-sounds
```

| File | Description | Time of day |
|---|---|---|
| `river-flow.mp3` | Flowing river / ghat water | All |
| `birds-morning.mp3` | Morning birds chirping | Dawn, Morning |
| `birds-day.mp3` | Daytime birds | Afternoon |
| `crickets.mp3` | Evening/night crickets | Sunset, Night |
| `wind-gentle.mp3` | Soft wind | Afternoon, Night |
| `conch-distant.mp3` | Distant conch / shankh | Dawn, Sunset |
| `crowd-ghat.mp3` | Devotee crowd murmur | Morning, Sunset |

The `GhatAmbience` component auto-selects a time-of-day preset and silently skips missing files.

---

## 🪔 Jal Arghya (Virtual Offering)

Users tap the sun/water circle to offer virtual jal arghya to Chhathi Maiya. Each tap:
- Creates an animated water ripple
- Shows a floating "💧 Jal Arghya" text
- Displays one of 25 curated Hindi/Bhojpuri blessings
- Increments a persistent offering count (stored in `localStorage`)

---

## ⏳ Chhath Countdown

The `ChhathCountdown` component shows a live countdown (days/hours/minutes/seconds) to the next Chhath Puja event — Nahay Khay, Kharna, Sandhya Arghya, or Usha Arghya. Dates are pre-computed for 2024–2027.

---

## 📱 WhatsApp Song Requests

Set your WhatsApp number in the frontend environment:

```env
NEXT_PUBLIC_WHATSAPP_NUMBER=919876543210
```

Listeners tap "Gaana request karein" to send a pre-filled WhatsApp message with the current song title and artist.

---

## 🔗 Share Card

The `/share` route renders a beautiful OG card:

```
/share?title=Kaanch+Hi+Baans&artist=Sharda+Sinha
```

The `NowPlaying` component has a Share button that uses `navigator.share()` on mobile and clipboard fallback on desktop.

---

## ⚙️ Environment Variables

### Frontend (`frontend/.env.local`)

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | Backend API URL | `http://localhost:8000` |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | WhatsApp number (country code + number) | — |
| `NEXT_PUBLIC_SITE_URL` | Public site URL (for OG cards) | `http://localhost:3000` |

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `SECRET_KEY` | JWT secret key |
| `LOG_LEVEL` | Logging level (default: `info`) |
| `WEB_CONCURRENCY` | Gunicorn worker count (default: `2*CPU+1`) |

---

## 🚢 Production Deployment

See [SCALE_PLAN.md](SCALE_PLAN.md) for the full scale-to-millions architecture plan.

### Quick production checklist

- [ ] Set all env vars (`SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`)
- [ ] Use managed PostgreSQL (RDS, Supabase, Neon)
- [ ] Use managed Redis (ElastiCache, Upstash)
- [ ] Deploy frontend to Vercel (zero-config, global CDN)
- [ ] Run backend with Gunicorn: `gunicorn -c backend/gunicorn.conf.py app.main:app`
- [ ] Set `WEB_CONCURRENCY` to `2 × CPU + 1`
- [ ] Put backend behind a load balancer with SSL termination
- [ ] Configure `CORS_ORIGINS` in backend settings

---

## 🙏 Cultural Notes

Chhath Puja is one of the most ancient Hindu festivals, dedicated to Surya (the Sun God) and Chhathi Maiya. It is celebrated primarily in Bihar, Jharkhand, eastern Uttar Pradesh, and the Nepali Terai — and by diaspora communities worldwide.

The four-day festival:
1. **Nahay Khay** — ritual bath and sattvic meal
2. **Kharna** — day-long fast, evening prasad
3. **Sandhya Arghya** — sunset offering to the setting sun 🌇
4. **Usha Arghya** — sunrise offering to the rising sun 🌅

This platform is built with deep respect for the tradition. 🪔

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

Chhathi Maiya ki Jai! 🌅