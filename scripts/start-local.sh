#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — One-Shot Local Development Starter
#
# Starts PostgreSQL, Redis, FastAPI Backend, and Next.js Frontend.
# Runs Alembic DB migrations, seeds default admin, seeds songs from songs.txt,
# ensures immediate cache updates, and opens the app in your browser.
#
# Usage:
#   ./scripts/start-local.sh          # Full startup with real YouTube metadata
#   ./scripts/start-local.sh --fast   # Fast startup (placeholder song titles, no oEmbed delay)
#   ./scripts/start-local.sh --clear  # Wipe existing songs in DB before seeding
#
# Default Admin Credentials:
#   Email:    admin@chhathradio.com
#   Password: adminpassword123
# =============================================================================

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/local/docker-compose.local.yml"
BACKEND_ENV="$PROJECT_ROOT/backend/.env"
BACKEND_ENV_EXAMPLE="$PROJECT_ROOT/backend/.env.example"
SONGS_FILE="/scripts/songs.txt"

# ── Parse arguments ───────────────────────────────────────────────────────────
FAST_SEED=false
CLEAR_SONGS=false

for arg in "$@"; do
  case "$arg" in
    --fast)
      FAST_SEED=true
      shift
      ;;
    --clear)
      CLEAR_SONGS=true
      shift
      ;;
  esac
done

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BLUE='\033[0;34m'; MAGENTA='\033[0;35m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()    { echo -e "${CYAN}  ›${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $*"; }
error()   { echo -e "${RED}  ✗ ERROR:${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}══ $* ${NC}"; }
divider() { echo -e "${DIM}──────────────────────────────────────────────────────────────${NC}"; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${YELLOW}  🪔  Chhath Radio — Local One-Shot Launcher${NC}"
echo -e "${DIM}  छठ के गीत, बिना रुके — Full-Stack Local Environment${NC}"
divider

# ── 1. Check Dependencies ─────────────────────────────────────────────────────
step "1. Checking prerequisites"

if ! command -v docker >/dev/null 2>&1; then
  echo ""
  warn "Docker CLI is not found on your PATH."
  echo -e "  To run the full stack locally with PostgreSQL and Redis:"
  echo -e "  1. Install Docker Desktop: ${CYAN}https://docs.docker.com/get-docker/${NC}"
  echo -e "     or via Homebrew:        ${CYAN}brew install --cask docker${NC}"
  echo -e "  2. Start Docker Desktop and re-run this script."
  echo ""
  error "Docker is required to launch the database, cache, backend, and frontend."
fi

if ! docker info >/dev/null 2>&1; then
  echo ""
  warn "Docker daemon is not running."
  echo -e "  Please open/start Docker Desktop on your Mac:"
  echo -e "    ${CYAN}open -a Docker${NC}"
  echo -e "  Once Docker has finished starting, re-run this script."
  echo ""
  error "Docker daemon must be running."
fi

success "Docker & Docker Compose are ready."

# ── 2. Environment Setup ──────────────────────────────────────────────────────
step "2. Setting up environment & credentials"

# Ensure backend/.env exists
if [ ! -f "$BACKEND_ENV" ]; then
  info "Creating backend/.env from .env.example..."
  cp "$BACKEND_ENV_EXAMPLE" "$BACKEND_ENV"

  # Generate SECRET_KEY
  if command -v openssl >/dev/null 2>&1; then
    GEN_SECRET=$(openssl rand -hex 32)
  else
    GEN_SECRET=$(cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
  fi

  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|change-me-to-a-long-random-string-at-least-32-chars|${GEN_SECRET}|g" "$BACKEND_ENV"
  else
    sed -i "s|change-me-to-a-long-random-string-at-least-32-chars|${GEN_SECRET}|g" "$BACKEND_ENV"
  fi
  success "Generated backend/.env with secure SECRET_KEY."
else
  success "backend/.env found."
fi

# Default Admin Credentials
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@chhathradio.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-adminpassword123}"

# Ensure ADMIN_EMAIL & ADMIN_PASSWORD in backend/.env if empty
if ! grep -q "^ADMIN_EMAIL=." "$BACKEND_ENV"; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=${ADMIN_EMAIL}|" "$BACKEND_ENV"
  else
    sed -i "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=${ADMIN_EMAIL}|" "$BACKEND_ENV"
  fi
fi
if ! grep -q "^ADMIN_PASSWORD=." "$BACKEND_ENV"; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" "$BACKEND_ENV"
  else
    sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" "$BACKEND_ENV"
  fi
fi

# Ensure local dev cache bypass is active in .env
if ! grep -q "^QUEUE_CACHE_TTL=" "$BACKEND_ENV"; then
  echo "" >> "$BACKEND_ENV"
  echo "QUEUE_CACHE_TTL=0" >> "$BACKEND_ENV"
fi

# Ensure CALENDARIFIC_API_KEY is configured in .env
CALENDARIFIC_KEY="${CALENDARIFIC_API_KEY:-tasaJ8hlEPGg6TMNJXi1yg9f3e50mdv0}"
if ! grep -q "^CALENDARIFIC_API_KEY=." "$BACKEND_ENV"; then
  if grep -q "^CALENDARIFIC_API_KEY=" "$BACKEND_ENV"; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^CALENDARIFIC_API_KEY=.*|CALENDARIFIC_API_KEY=${CALENDARIFIC_KEY}|" "$BACKEND_ENV"
    else
      sed -i "s|^CALENDARIFIC_API_KEY=.*|CALENDARIFIC_API_KEY=${CALENDARIFIC_KEY}|" "$BACKEND_ENV"
    fi
  else
    echo "" >> "$BACKEND_ENV"
    echo "CALENDARIFIC_API_KEY=${CALENDARIFIC_KEY}" >> "$BACKEND_ENV"
  fi
fi

info "Admin Email:    ${BOLD}${ADMIN_EMAIL}${NC}"
info "Admin Password: ${BOLD}${ADMIN_PASSWORD}${NC}"
info "Calendarific:   ${GREEN}Configured${NC} (tasaJ8...)"
info "Songs Cache:    ${GREEN}QUEUE_CACHE_TTL=0${NC} (Instant updates enabled for local dev)"

# ── 3. Start Database & Redis ─────────────────────────────────────────────────
step "3. Starting Infrastructure (PostgreSQL & Redis)"

docker compose -f "$COMPOSE_FILE" up -d postgres redis

# Wait for postgres
info "Waiting for PostgreSQL database..."
until docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U chhath -d chhath_radio >/dev/null 2>&1; do
  sleep 1
done
success "PostgreSQL is ready."

# Wait for redis
info "Waiting for Redis cache..."
until docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping | grep -q "PONG"; do
  sleep 1
done
success "Redis is ready."

# ── 4. Start Backend Container ────────────────────────────────────────────────
step "4. Starting Backend API"

docker compose -f "$COMPOSE_FILE" up -d backend

info "Waiting for Backend API health check (http://localhost:8000/api/health)..."
BACKEND_HEALTHY=false
for i in $(seq 1 45); do
  if docker compose -f "$COMPOSE_FILE" exec -T backend python -c "
import urllib.request
try:
    resp = urllib.request.urlopen('http://localhost:8000/api/health', timeout=2)
    exit(0 if resp.status == 200 else 1)
except Exception:
    exit(1)
" >/dev/null 2>&1; then
    BACKEND_HEALTHY=true
    break
  fi
  sleep 1
done

if [ "$BACKEND_HEALTHY" != "true" ]; then
  error "Backend failed to become healthy in time. Check logs: docker compose -f local/docker-compose.local.yml logs backend"
fi
success "Backend API is healthy on http://localhost:8000."

# ── 5. Run Database Migrations ────────────────────────────────────────────────
step "5. Running Alembic Database Migrations"

info "Applying database schema migrations..."
docker compose -f "$COMPOSE_FILE" exec -T backend alembic upgrade head
success "Migrations applied successfully."

# ── 6. Seed Admin User ────────────────────────────────────────────────────────
step "6. Seeding Admin User"

docker compose -f "$COMPOSE_FILE" exec -T \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  backend python seed_admin.py
success "Admin credentials verified/seeded: $ADMIN_EMAIL"

# ── 7. Seed Songs from songs.txt ──────────────────────────────────────────────
step "7. Seeding Songs from scripts/songs.txt"

SEED_ARGS="--file $SONGS_FILE"
if [ "$CLEAR_SONGS" = "true" ]; then
  SEED_ARGS="$SEED_ARGS --clear"
fi
if [ "$FAST_SEED" = "true" ]; then
  SEED_ARGS="$SEED_ARGS --no-fetch"
  info "Fast mode: Skipping oEmbed metadata fetch (placeholder titles)."
else
  info "Fetching metadata from YouTube oEmbed for real titles/artists..."
fi

docker compose -f "$COMPOSE_FILE" exec -T backend python seed_songs.py $SEED_ARGS
success "Songs seeding complete."

# ── 8. Start Frontend Container ───────────────────────────────────────────────
step "8. Starting Frontend (Next.js Dev Server)"

docker compose -f "$COMPOSE_FILE" up -d frontend

info "Waiting for Frontend to respond on http://localhost:3000..."
FRONTEND_READY=false
for i in $(seq 1 45); do
  if command -v curl >/dev/null 2>&1; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || echo "000")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "304" ] || [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "308" ]; then
      FRONTEND_READY=true
      break
    fi
  else
    if docker compose -f "$COMPOSE_FILE" ps frontend | grep -q "Up"; then
      sleep 3
      FRONTEND_READY=true
      break
    fi
  fi
  sleep 1
done

if [ "$FRONTEND_READY" = "true" ]; then
  success "Frontend is ready at http://localhost:3000."
else
  warn "Frontend is starting up in the background (first Next.js compilation may take ~15s)."
fi

# ── 9. Open in Browser ────────────────────────────────────────────────────────
step "9. Opening App in Browser"

open_url() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v start >/dev/null 2>&1; then
    start "$url"
  else
    info "Navigate manually to: $url"
  fi
}

# Auto-open app in browser
open_url "http://localhost:3000"

# ── 10. Summary & Cheat Sheet ─────────────────────────────────────────────────
echo ""
divider
echo -e "${BOLD}${GREEN}  🎉 Chhath Radio is completely up and running! 🪔${NC}"
divider
echo ""
echo -e "  ${BOLD}🌐 Web Application:${NC}"
echo -e "     ${CYAN}Homepage (Player):${NC}    ${BOLD}http://localhost:3000${NC}"
echo -e "     ${CYAN}Admin Dashboard:${NC}      ${BOLD}http://localhost:3000/admin${NC}"
echo ""
echo -e "  ${BOLD}🔐 Default Admin Login:${NC}"
echo -e "     ${CYAN}Email:${NC}                ${BOLD}${ADMIN_EMAIL}${NC}"
echo -e "     ${CYAN}Password:${NC}             ${BOLD}${ADMIN_PASSWORD}${NC}"
echo ""
echo -e "  ${BOLD}⚙️  Backend & APIs:${NC}"
echo -e "     ${CYAN}API Server:${NC}           ${BOLD}http://localhost:8000${NC}"
echo -e "     ${CYAN}Interactive Docs:${NC}     ${BOLD}http://localhost:8000/docs${NC}"
echo -e "     ${CYAN}Health Check:${NC}         ${BOLD}http://localhost:8000/api/health${NC}"
echo ""
echo -e "  ${BOLD}⚡ Realtime Songs Updates:${NC}"
echo -e "     ${GREEN}Instant DB Updates Active:${NC} Any changes made to the songs table"
echo -e "     in the database or admin panel are reflected immediately without stale cache!"
echo ""
echo -e "  ${BOLD}📋 Helpful Commands:${NC}"
echo -e "     ${CYAN}./scripts/start-local.sh --fast${NC}   # Re-run seeder in fast mode"
echo -e "     ${CYAN}./scripts/start-local.sh --clear${NC}  # Clear DB & re-seed songs"
echo -e "     ${CYAN}docker compose -f local/docker-compose.local.yml logs -f${NC}  # View logs"
echo -e "     ${CYAN}docker compose -f local/docker-compose.local.yml down${NC}     # Stop containers"
echo ""
divider

