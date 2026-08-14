#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — Local Database Management Script
#
# Mirrors the GitHub Actions db.yml pipeline for local use.
# Runs against the local Docker PostgreSQL (via docker-compose.local.yml).
#
# Usage:
#   ./scripts/db.sh migrate       — run Alembic migrations
#   ./scripts/db.sh seed-admin    — create/update admin user (idempotent)
#   ./scripts/db.sh seed-songs    — seed songs from backend/data/songs.txt
#   ./scripts/db.sh rollback      — roll back last migration
#   ./scripts/db.sh status        — show current migration state
#   ./scripts/db.sh shell         — open psql shell in local DB
#
# Prerequisites:
#   Local Docker stack must be running: ./local/run-local.sh start
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_ENV="$PROJECT_ROOT/backend/.env"

# Auto-detect which compose file is active by checking running containers.
# The backend container name is the same in both modes: chhath_backend.
# We just need the right compose file to exec into it.
# Default to local dev compose; override with COMPOSE_FILE env var if needed.
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_ROOT/local/docker-compose.local.yml}"

# If the production-mimic compose is running (docker-compose.yml), use that.
# Detection: check if the backend container was started by docker-compose.yml
# by inspecting its compose project label.
if docker inspect chhath_backend --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' 2>/dev/null | grep -q "docker-compose.yml"; then
  COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
fi

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()    { echo -e "${CYAN}  ›${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $*"; }
error()   { echo -e "${RED}  ✗ ERROR:${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${CYAN}══ $* ${NC}"; }
divider() { echo -e "${DIM}────────────────────────────────────────────────────${NC}"; }

# ── Check backend container is running ───────────────────────────────────────
check_backend_running() {
  if ! docker compose -f "$COMPOSE_FILE" ps --status running backend 2>/dev/null | grep -q "backend"; then
    error "Backend container is not running.\n  Start it first: ./local/run-local.sh start"
  fi
}

# ── Run a command inside the backend container ────────────────────────────────
run_in_backend() {
  docker compose -f "$COMPOSE_FILE" exec backend "$@"
}

# ── Banner ────────────────────────────────────────────────────────────────────
print_banner() {
  echo ""
  echo -e "${BOLD}${YELLOW}  🪔  Chhath Radio — Database Management${NC}"
  echo -e "${DIM}  Local Docker stack${NC}"
  divider
}

# =============================================================================
# Commands
# =============================================================================

cmd_migrate() {
  print_banner
  step "Running Alembic migrations"
  check_backend_running
  info "Running: alembic upgrade head"
  run_in_backend alembic upgrade head
  echo ""
  info "Current migration state:"
  run_in_backend alembic current
  success "Migrations complete"
}

cmd_seed_admin() {
  print_banner
  step "Seeding admin user"
  check_backend_running

  # Load ADMIN_EMAIL and ADMIN_PASSWORD from .env if not already set
  if [ -f "$BACKEND_ENV" ]; then
    ADMIN_EMAIL="${ADMIN_EMAIL:-$(grep '^ADMIN_EMAIL=' "$BACKEND_ENV" | cut -d= -f2-)}"
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(grep '^ADMIN_PASSWORD=' "$BACKEND_ENV" | cut -d= -f2-)}"
  fi

  if [ -z "${ADMIN_EMAIL:-}" ]; then
    read -r -p "  Admin email: " ADMIN_EMAIL
  fi
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    read -r -s -p "  Admin password: " ADMIN_PASSWORD
    echo ""
  fi

  info "Seeding admin: $ADMIN_EMAIL"
  run_in_backend env ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" python seed_admin.py
  success "Admin seed complete"
}

cmd_seed_songs() {
  print_banner
  step "Seeding songs"
  check_backend_running

  if ! docker compose -f "$COMPOSE_FILE" exec backend test -f data/songs.txt 2>/dev/null; then
    warn "No backend/data/songs.txt found."
    info "Create it with format: Title|Artist|YouTubeVideoID (one per line)"
    info "Lines starting with # are comments."
    exit 0
  fi

  info "Seeding songs from data/songs.txt..."
  run_in_backend python -c "
import sys
sys.path.insert(0, '.')
from app.db.database import SessionLocal
from app.models.song import Song
from sqlalchemy import select
import uuid

db = SessionLocal()
try:
    with open('data/songs.txt') as f:
        lines = [l.strip() for l in f if l.strip() and not l.startswith('#')]
    count = 0
    for i, line in enumerate(lines):
        parts = line.split('|')
        if len(parts) < 3:
            print(f'  Skipping malformed line: {line}')
            continue
        title, artist, yt_id = parts[0].strip(), parts[1].strip(), parts[2].strip()
        existing = db.scalar(select(Song).where(Song.youtube_video_id == yt_id))
        if not existing:
            db.add(Song(id=uuid.uuid4(), title=title, artist=artist,
                        youtube_video_id=yt_id, sort_order=i, enabled=True))
            count += 1
            print(f'  + {title} — {artist}')
        else:
            print(f'  ~ {title} (already exists, skipped)')
    db.commit()
    print(f'Done: {count} new songs added')
finally:
    db.close()
"
  success "Song seed complete"
}

cmd_rollback() {
  print_banner
  step "Rolling back last migration"
  check_backend_running

  echo ""
  warn "This will roll back the LAST Alembic migration."
  warn "Data in rolled-back tables may be lost."
  echo ""
  read -r -p "  Type 'yes' to confirm: " confirm
  if [ "$confirm" != "yes" ]; then
    info "Aborted — nothing changed."
    exit 0
  fi

  info "Current state:"
  run_in_backend alembic current
  echo ""
  info "Rolling back..."
  run_in_backend alembic downgrade -1
  echo ""
  info "State after rollback:"
  run_in_backend alembic current
  success "Rollback complete"
}

cmd_status() {
  print_banner
  step "Migration status"
  check_backend_running

  info "Current migration:"
  run_in_backend alembic current
  echo ""
  info "Migration history:"
  run_in_backend alembic history --verbose
}

cmd_shell() {
  print_banner
  step "Opening psql shell"
  check_backend_running

  info "Connecting to local PostgreSQL..."
  docker compose -f "$COMPOSE_FILE" exec db \
    psql -U chhath -d chhath_radio
}

# ── Entry point ───────────────────────────────────────────────────────────────
COMMAND="${1:-help}"

case "$COMMAND" in
  migrate)    cmd_migrate ;;
  seed-admin) cmd_seed_admin ;;
  seed-songs) cmd_seed_songs ;;
  rollback)   cmd_rollback ;;
  status)     cmd_status ;;
  shell)      cmd_shell ;;
  help|*)
    echo ""
    echo -e "${BOLD}  Chhath Radio — Database Management${NC}"
    echo ""
    echo -e "  Usage: ${CYAN}./scripts/db.sh <command>${NC}"
    echo ""
    echo -e "  ${CYAN}migrate${NC}      Run Alembic migrations (alembic upgrade head)"
    echo -e "  ${CYAN}seed-admin${NC}   Create/update admin user (idempotent)"
    echo -e "  ${CYAN}seed-songs${NC}   Seed songs from backend/data/songs.txt"
    echo -e "  ${CYAN}rollback${NC}     Roll back last migration (with confirmation)"
    echo -e "  ${CYAN}status${NC}       Show current migration state"
    echo -e "  ${CYAN}shell${NC}        Open psql shell in local DB"
    echo ""
    echo -e "  ${DIM}Requires local Docker stack to be running:${NC}"
    echo -e "  ${CYAN}./local/run-local.sh start${NC}"
    echo ""
    ;;
esac