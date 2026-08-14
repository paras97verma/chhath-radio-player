# Chhath Radio — Deployment Guide

> 🪔 *छठ के गीत, बिना रुके*

This guide covers everything needed to deploy Chhath Radio to production and run it locally.

---

## Architecture

| Layer | Service | Cost |
|---|---|---|
| Backend (FastAPI) | [Render](https://render.com) Web Service | Free (750 hrs/mo) |
| Frontend (Next.js) | [Vercel](https://vercel.com) | Free |
| Database (PostgreSQL) | [Supabase](https://supabase.com) | Free (500MB) |
| Cache (Redis) | [Upstash](https://upstash.com) | Free (10k cmd/day) |
| CI/CD | GitHub Actions | Free |

---

## Quick Start — First Deployment

Run the interactive setup script. It guides you through every step:

```bash
chmod +x scripts/deploy-setup.sh
./scripts/deploy-setup.sh
```

The script will:
1. Check prerequisites (git, docker, curl, gh CLI)
2. Guide you to create accounts on Supabase, Upstash, Render, Vercel
3. Collect all credentials interactively (with inline instructions)
4. Write `backend/.env` and `frontend/.env.local` for local dev
5. Set all GitHub Actions secrets automatically (via `gh` CLI)
6. Configure Render and Vercel environment variables
7. Trigger the first production deployment
8. Poll the health endpoint until the backend is live

---

## Local Development

### Prerequisites

- Docker Desktop (running)
- `./local/run-local.sh` (the local runner)

### Start the local stack

```bash
./local/run-local.sh start
```

You will be asked to choose a mode:

```
  Select run mode:

  1) Hot-reload dev   — source code mounted, instant file changes
                        (uses local/docker-compose.local.yml)

  2) Production mimic — built Docker images, identical to Render/Vercel
                        (uses docker-compose.yml)
```

**Hot-reload dev** (mode 1): Best for active development. Source code is mounted into containers. Backend uses `uvicorn --reload`, frontend uses Next.js dev server with HMR. Any file change is picked up instantly — no rebuild needed.

**Production mimic** (mode 2): Best for verifying the production build locally before deploying. Builds the same Docker images as Render/Vercel. No hot reload — requires rebuild on code changes.

### Other local commands

```bash
./local/run-local.sh stop       # stop all services
./local/run-local.sh restart    # restart all services
./local/run-local.sh logs       # tail all logs
./local/run-local.sh logs backend  # tail backend logs only
./local/run-local.sh status     # show container status
./local/run-local.sh shell      # open shell in backend container
./local/run-local.sh clean      # full reset (removes volumes)
```

### Local URLs

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Admin panel | http://localhost:3000/admin |
| Backend API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |
| Health check | http://localhost:8000/api/health |

---

## Database Management

### Local (Docker network)

```bash
./scripts/db.sh migrate       # run Alembic migrations
./scripts/db.sh seed-admin    # create/update admin user
./scripts/db.sh seed-songs    # seed songs from backend/data/songs.txt
./scripts/db.sh rollback      # roll back last migration (with confirmation)
./scripts/db.sh status        # show current migration state
./scripts/db.sh shell         # open psql shell
```

All commands run inside the Docker network via `docker compose exec backend`.

### Production (GitHub Actions)

Go to **GitHub → Actions → Database Operations → Run workflow** and select:

| Operation | Description |
|---|---|
| `migrate` | Run `alembic upgrade head` against production DB |
| `seed-admin` | Create/update admin user (idempotent) |
| `seed-songs` | Seed songs from `backend/data/songs.txt` |
| `rollback` | Roll back last migration (requires `confirm=yes`) |
| `status` | Show current migration state |

> **Note**: Migrations also run automatically on every deploy via `run_server.sh`. The `seed-admin` operation is also run automatically on startup if `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set.

---

## CI/CD Pipelines

### Backend pipeline (`.github/workflows/backend.yml`)

Triggers on push to `main` when `backend/**` changes.

```
push to main (backend/**)
  └── test (pytest + real PostgreSQL + Redis)
        └── [pass] deploy to Render
              ├── Update Render env vars via API
              ├── Trigger Render deploy hook
              └── Poll /api/health until healthy
```

### Frontend pipeline (`.github/workflows/frontend.yml`)

Triggers on push to `main` when `frontend/**` changes.

```
push to main (frontend/**)
  └── test (vitest unit tests)
        └── build-check (Docker build smoke test with NEXT_PUBLIC_* from secrets)
              └── [pass] deploy to Vercel
                    ├── vercel build --prod (injects NEXT_PUBLIC_* from secrets)
                    ├── vercel deploy --prebuilt --prod
                    └── Verify site is live
```

### Database pipeline (`.github/workflows/db.yml`)

Manual trigger only (`workflow_dispatch`). See Database Management above.

---

## GitHub Actions Secrets

All secrets are set automatically by `scripts/deploy-setup.sh`. To set them manually:

**GitHub → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Description | Where to get it |
|---|---|---|
| `DATABASE_URL` | Supabase PostgreSQL URI | Supabase → Settings → Database → Connection Pooling |
| `REDIS_URL` | Upstash Redis URL | Upstash → Database → Details |
| `SECRET_KEY` | JWT signing secret (min 32 chars) | `openssl rand -hex 32` |
| `ADMIN_EMAIL` | Admin account email | Your choice |
| `ADMIN_PASSWORD` | Admin account password | Your choice |
| `VAPID_PUBLIC_KEY` | VAPID public key | `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | VAPID private key | Same as above |
| `RENDER_API_KEY` | Render API key | Render → Account Settings → API Keys |
| `RENDER_SERVICE_ID` | Render service ID | Render dashboard URL: `/web/srv-XXXXXXXX` |
| `RENDER_DEPLOY_HOOK_URL` | Render deploy hook | Render → Service → Settings → Deploy Hook |
| `VERCEL_TOKEN` | Vercel personal token | Vercel → Account → Tokens |
| `VERCEL_ORG_ID` | Vercel org/team ID | `vercel link` → `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Vercel project ID | `vercel link` → `.vercel/project.json` |
| `NEXT_PUBLIC_API_URL` | Backend public URL | Your Render service URL |
| `NEXT_PUBLIC_SITE_URL` | Frontend public URL | Your Vercel project URL |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID public key (frontend) | Same as `VAPID_PUBLIC_KEY` |

---

## Environment Variables

### Backend (`backend/.env`)

Copy `backend/.env.example` → `backend/.env` and fill in values.

Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `SECRET_KEY` | JWT signing secret (min 32 chars) |
| `ADMIN_EMAIL` | Admin account email |
| `ADMIN_PASSWORD` | Admin account password |
| `CORS_ORIGINS` | Allowed CORS origins (use `*` for local dev) |
| `WEB_CONCURRENCY` | Gunicorn workers (1 for Render free tier) |

### Frontend (`frontend/.env.local`)

Copy `frontend/.env.example` → `frontend/.env.local` and fill in values.

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend URL (empty = use Next.js rewrites) |
| `NEXT_PUBLIC_SITE_URL` | Frontend URL (for OG tags, share links) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID public key for push notifications |

---

## Render Setup (Backend)

1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repo
3. Settings:
   - **Name**: `chhath-radio-api`
   - **Runtime**: Docker
   - **Root Directory**: `backend`
   - **Branch**: `main`
   - **Auto-Deploy**: **NO** (GitHub Actions controls deploys)
4. Click **Create Web Service**
5. Go to **Settings → Deploy Hook** → copy the URL
6. Go to **Account Settings → API Keys** → create a key

Render automatically runs `run_server.sh` on startup, which:
- Runs `alembic upgrade head` (migrations)
- Seeds the admin user (if `ADMIN_EMAIL`/`ADMIN_PASSWORD` are set)
- Starts Gunicorn + Uvicorn workers

---

## Vercel Setup (Frontend)

1. Go to [vercel.com](https://vercel.com) → New Project → Import your GitHub repo
2. Settings:
   - **Framework**: Next.js (auto-detected)
   - **Root Directory**: `frontend`
   - **Auto-Deploy**: **NO** (GitHub Actions controls deploys)
3. Click **Deploy**
4. Go to **Project → Settings → Git → Deploy Hooks** → create a hook for `main`
5. Go to **Account → Tokens** → create a token
6. Run `npx vercel link` in `frontend/` to get `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`

`NEXT_PUBLIC_*` vars are injected at build time by GitHub Actions from repository secrets. They are NOT read from Vercel's environment variable settings (to ensure reproducible builds).

---

## Re-deploying

### Automatic (recommended)

Push to `main` — GitHub Actions runs tests and deploys automatically:

```bash
git push origin main
```

### Manual (on-demand)

```bash
# Re-run the setup script (updates credentials + triggers deploy)
./scripts/deploy-setup.sh

# Or trigger via GitHub Actions UI:
# GitHub → Actions → Backend CI/CD → Run workflow
# GitHub → Actions → Frontend CI/CD → Run workflow
```

---

## Troubleshooting

### Backend not starting on Render

1. Check Render logs: **Service → Logs**
2. Common causes:
   - `DATABASE_URL` not set or wrong format
   - `SECRET_KEY` too short (must be ≥ 32 chars)
   - Alembic migration failed (check logs for SQL errors)

### Frontend build failing on Vercel

1. Check GitHub Actions logs: **Actions → Frontend CI/CD**
2. Common causes:
   - `NEXT_PUBLIC_API_URL` secret not set in GitHub
   - TypeScript errors (run `npm run build` locally first)

### Listener count not updating

- Count drops within ~6 seconds of a tab closing (TTL-based expiry)
- Count increases immediately when a new browser (not tab) connects
- Multiple tabs of the same browser share one session ID (via `localStorage`)

### Database migration failed

```bash
# Check current state
./scripts/db.sh status

# Roll back if needed
./scripts/db.sh rollback

# Or via GitHub Actions:
# Actions → Database Operations → Run workflow → status/rollback
```

---

## Songs Data Format

To seed songs, create `backend/data/songs.txt`:

```
# Format: Title|Artist|YouTubeVideoID
# Lines starting with # are comments

Chhath Puja Geet|Traditional|dQw4w9WgXcQ
Ugi He Suraj Dev|Sharda Sinha|abc123xyz
```

Then run:
```bash
./scripts/db.sh seed-songs          # local
# or GitHub Actions → Database Operations → seed-songs