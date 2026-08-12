#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — Interactive Local Runner
#
# Runs the full stack (postgres, redis, backend, frontend) via Docker.
# Can be run from anywhere — it resolves the project root automatically.
#
# Usage:
#   ./local/run-local.sh            → interactive menu
#   ./local/run-local.sh start      → start all services
#   ./local/run-local.sh stop       → stop all services
#   ./local/run-local.sh restart    → restart all services
#   ./local/run-local.sh logs       → tail logs (all services)
#   ./local/run-local.sh logs backend  → tail logs (one service)
#   ./local/run-local.sh clean      → full reset (removes volumes)
#   ./local/run-local.sh status     → show container status
#   ./local/run-local.sh shell      → open a shell in the backend container
# =============================================================================

set -euo pipefail

# ── Resolve project root (one level up from local/) ──────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.local.yml"
BACKEND_ENV="$PROJECT_ROOT/backend/.env"
BACKEND_ENV_EXAMPLE="$PROJECT_ROOT/backend/.env.example"

# Sanity check — make sure we resolved the right root
[ ! -f "$BACKEND_ENV_EXAMPLE" ] && \
  { echo "ERROR: Could not find project root. Run this script from the project root or from local/."; exit 1; }

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()    { echo -e "${CYAN}  ›${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $*"; }
error()   { echo -e "${RED}  ✗ ERROR:${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}══ $* ${NC}"; }
divider() { echo -e "${DIM}────────────────────────────────────────────────────${NC}"; }

# ── Banner ────────────────────────────────────────────────────────────────────
print_banner() {
  echo ""
  echo -e "${BOLD}${YELLOW}"
  echo "  🪔  Chhath Radio — Local Development Stack"
  echo -e "${NC}${DIM}  छठ के गीत, बिना रुके${NC}"
  divider
}

# ── Dependency checks ─────────────────────────────────────────────────────────
check_deps() {
  step "Checking dependencies"

  if ! command -v docker >/dev/null 2>&1; then
    error "Docker is not installed.\n  Install it from: https://docs.docker.com/get-docker/"
  fi
  success "Docker found: $(docker --version)"

  if ! docker compose version >/dev/null 2>&1; then
    error "Docker Compose v2 is not installed.\n  Update Docker Desktop or install the Compose plugin."
  fi
  success "Docker Compose found: $(docker compose version --short)"

  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon is not running. Start Docker Desktop and try again."
  fi
  success "Docker daemon is running."
}

# ── Environment setup ─────────────────────────────────────────────────────────
setup_env() {
  step "Setting up environment"

  if [ ! -f "$BACKEND_ENV" ]; then
    info "No backend/.env found — creating from .env.example..."
    cp "$BACKEND_ENV_EXAMPLE" "$BACKEND_ENV"

    # Generate a real secret key
    local secret
    if command -v openssl >/dev/null 2>&1; then
      secret=$(openssl rand -hex 32)
    else
      secret=$(cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
    fi

    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|change-me-to-a-long-random-string-in-production|${secret}|g" "$BACKEND_ENV"
    else
      sed -i "s|change-me-to-a-long-random-string-in-production|${secret}|g" "$BACKEND_ENV"
    fi

    success "Created backend/.env with a generated SECRET_KEY."
    warn "Review backend/.env before deploying to production."
  else
    success "backend/.env already exists."
  fi
}

# ── Wait for a service to become healthy ─────────────────────────────────────
wait_healthy() {
  local service="$1"
  local max=40
  local attempt=0
  local spinner=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')

  printf "  ${CYAN}›${NC} Waiting for ${BOLD}%s${NC} to be healthy " "$service"
  while [ $attempt -lt $max ]; do
    local health
    # Docker Compose v2 may output a JSON array or newline-delimited JSON objects.
    # We handle both by reading all lines and checking any object's Health field.
    health=$(docker compose -f "$COMPOSE_FILE" ps --format json "$service" 2>/dev/null \
      | python3 -c "
import sys, json
data = sys.stdin.read().strip()
if not data:
    print('')
    sys.exit(0)
# Try as a JSON array first, then as newline-delimited JSON objects
try:
    objs = json.loads(data)
    if isinstance(objs, list):
        print(objs[0].get('Health', '') if objs else '')
    else:
        print(objs.get('Health', ''))
except json.JSONDecodeError:
    # Newline-delimited JSON (one object per line)
    for line in data.splitlines():
        line = line.strip()
        if line:
            try:
                obj = json.loads(line)
                print(obj.get('Health', ''))
                sys.exit(0)
            except json.JSONDecodeError:
                pass
    print('')
" 2>/dev/null || echo "")

    if [ "$health" = "healthy" ]; then
      echo -e " ${GREEN}✓${NC}"
      return 0
    fi

    printf "\r  ${CYAN}›${NC} Waiting for ${BOLD}%s${NC} to be healthy %s" "$service" "${spinner[$((attempt % 10))]}"
    attempt=$((attempt + 1))
    sleep 2
  done

  echo ""
  error "$service did not become healthy in time.\n  Run: ./local/run-local.sh logs $service"
}

# ── Open URL in the default browser (cross-platform) ─────────────────────────
open_browser() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    # macOS
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    # Linux (X11/Wayland)
    xdg-open "$url" &
  elif command -v wslview >/dev/null 2>&1; then
    # WSL
    wslview "$url"
  elif command -v start >/dev/null 2>&1; then
    # Windows (Git Bash / MSYS)
    start "$url"
  else
    info "Could not detect a browser opener. Visit ${GREEN}${url}${NC} manually."
  fi
}

# ── Print URLs and open the frontend in the browser ──────────────────────────
print_urls() {
  local frontend_url="http://localhost:3000"
  local admin_url="http://localhost:3000/admin"

  echo ""
  divider
  echo -e "  ${BOLD}${GREEN}All services are running! 🪔${NC}"
  echo ""
  echo -e "  ${BOLD}🏠 Homepage:${NC}  ${GREEN}${frontend_url}${NC}"
  echo -e "  ${BOLD}🔐 Admin:${NC}     ${GREEN}${admin_url}${NC}"
  echo -e "  ${BOLD}⚙️  Backend:${NC}   ${GREEN}http://localhost:8000${NC}"
  echo -e "  ${BOLD}📖 API Docs:${NC}  ${GREEN}http://localhost:8000/docs${NC}"
  echo -e "  ${BOLD}❤️  Health:${NC}    ${GREEN}http://localhost:8000/health${NC}"
  echo ""
  echo -e "  ${DIM}Useful commands:${NC}"
  echo -e "  ${CYAN}./local/run-local.sh logs${NC}           — tail all logs"
  echo -e "  ${CYAN}./local/run-local.sh logs frontend${NC}  — frontend logs only"
  echo -e "  ${CYAN}./local/run-local.sh logs backend${NC}   — backend logs only"
  echo -e "  ${CYAN}./local/run-local.sh stop${NC}           — stop all services"
  echo -e "  ${CYAN}./local/run-local.sh status${NC}         — show container status"
  echo -e "  ${CYAN}./local/run-local.sh shell${NC}          — open backend shell"
  divider
  echo ""

  # Auto-open homepage and admin in the default browser
  info "Opening ${GREEN}${frontend_url}${NC} in your browser..."
  open_browser "$frontend_url"
  sleep 1
  info "Opening ${GREEN}${admin_url}${NC} in your browser..."
  open_browser "$admin_url"
}

# ── Commands ──────────────────────────────────────────────────────────────────
# ── Kill any stale/conflicting containers before starting ────────────────────
kill_blockers() {
  step "Removing any stale containers that could block startup"
  # Stop and remove containers defined in this compose file (ignore errors if not running)
  docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
  success "Stale containers cleared."
}

cmd_start() {
  print_banner
  check_deps
  setup_env
  kill_blockers

  step "Building Docker images"
  info "This may take a few minutes on first run..."
  docker compose -f "$COMPOSE_FILE" build

  step "Starting infrastructure (postgres + redis)"
  docker compose -f "$COMPOSE_FILE" up -d postgres redis
  wait_healthy postgres
  wait_healthy redis

  step "Starting backend (runs Alembic migrations automatically)"
  docker compose -f "$COMPOSE_FILE" up -d backend
  wait_healthy backend

  step "Starting frontend"
  docker compose -f "$COMPOSE_FILE" up -d frontend

  # Give frontend a moment to start (it doesn't have a health check)
  sleep 3

  print_urls
}

cmd_stop() {
  print_banner
  step "Stopping all services"
  docker compose -f "$COMPOSE_FILE" stop
  success "All services stopped."
  echo ""
}

cmd_restart() {
  print_banner
  step "Restarting all services"
  docker compose -f "$COMPOSE_FILE" restart
  success "All services restarted."
  print_urls
}

cmd_logs() {
  local service="${1:-}"
  if [ -n "$service" ]; then
    info "Tailing logs for: $service (Ctrl+C to exit)"
    docker compose -f "$COMPOSE_FILE" logs -f --tail=100 "$service"
  else
    info "Tailing logs for all services (Ctrl+C to exit)"
    docker compose -f "$COMPOSE_FILE" logs -f --tail=50
  fi
}

cmd_clean() {
  print_banner
  echo ""
  warn "This will REMOVE all containers AND volumes."
  warn "Your local database data will be permanently deleted."
  echo ""
  read -r -p "  Are you sure you want to do a full reset? [y/N] " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    step "Removing all containers and volumes"
    docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
    success "Full reset complete. Run './local/run-local.sh start' to start fresh."
  else
    info "Aborted — nothing was changed."
  fi
  echo ""
}

cmd_status() {
  print_banner
  step "Container status"
  docker compose -f "$COMPOSE_FILE" ps
  echo ""
}

cmd_shell() {
  info "Opening shell in backend container..."
  docker compose -f "$COMPOSE_FILE" exec backend /bin/bash || \
  docker compose -f "$COMPOSE_FILE" exec backend /bin/sh
}

# ── Interactive menu (no args) ────────────────────────────────────────────────
interactive_menu() {
  print_banner
  echo ""
  echo -e "  ${BOLD}What would you like to do?${NC}"
  echo ""
  echo -e "  ${CYAN}1)${NC} Start all services"
  echo -e "  ${CYAN}2)${NC} Stop all services"
  echo -e "  ${CYAN}3)${NC} Restart all services"
  echo -e "  ${CYAN}4)${NC} Tail logs (all services)"
  echo -e "  ${CYAN}5)${NC} Show container status"
  echo -e "  ${CYAN}6)${NC} Open backend shell"
  echo -e "  ${CYAN}7)${NC} Full reset (removes volumes)"
  echo -e "  ${CYAN}q)${NC} Quit"
  echo ""
  read -r -p "  Enter choice [1-7 or q]: " choice
  echo ""

  case "$choice" in
    1) cmd_start ;;
    2) cmd_stop ;;
    3) cmd_restart ;;
    4) cmd_logs ;;
    5) cmd_status ;;
    6) cmd_shell ;;
    7) cmd_clean ;;
    q|Q) info "Bye!"; exit 0 ;;
    *) warn "Invalid choice. Run the script again."; exit 1 ;;
  esac
}

# ── Entry point ───────────────────────────────────────────────────────────────
COMMAND="${1:-menu}"

case "$COMMAND" in
  menu)         interactive_menu ;;
  start)        cmd_start ;;
  stop)         cmd_stop ;;
  restart)      cmd_restart ;;
  logs)         cmd_logs "${2:-}" ;;
  clean)        cmd_clean ;;
  status)       cmd_status ;;
  shell)        cmd_shell ;;
  *)
    echo "Usage: $0 {start|stop|restart|logs [service]|clean|status|shell}"
    exit 1
    ;;
esac