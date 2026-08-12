#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — Local Admin Seeder
#
# Creates the first admin user inside the running local backend container.
# Run this AFTER the stack is up (./local/run.sh start).
#
# Usage:
#   ./local/seed-admin.sh
#
# The script is interactive — it will prompt for email and password.
# It is safe to run multiple times; existing admins are not duplicated.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.local.yml"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()    { echo -e "${CYAN}  ›${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $*"; }
error()   { echo -e "${RED}  ✗ ERROR:${NC} $*" >&2; exit 1; }
divider() { echo -e "${DIM}────────────────────────────────────────────────────${NC}"; }

echo ""
echo -e "${BOLD}${YELLOW}  🪔  Chhath Radio — Seed Local Admin User${NC}"
divider
echo ""

# Check the backend container is running
if ! docker compose -f "$COMPOSE_FILE" ps backend 2>/dev/null | grep -q "running\|Up"; then
  error "Backend container is not running.\n  Start the stack first: ${CYAN}./local/run.sh start${NC}"
fi

# Collect credentials interactively
echo -e "  ${BOLD}?${NC} Admin email [admin@chhathradio.com]:"
read -r -p "  → " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@chhathradio.com}"

echo -e "  ${BOLD}?${NC} Admin password (will not be echoed):"
read -r -s -p "  → " ADMIN_PASSWORD
echo ""

[ -z "$ADMIN_PASSWORD" ] && error "Password cannot be empty."

echo ""
info "Seeding admin user '${ADMIN_EMAIL}' into local backend..."

docker compose -f "$COMPOSE_FILE" exec -T backend sh -c \
  "ADMIN_EMAIL='${ADMIN_EMAIL}' ADMIN_PASSWORD='${ADMIN_PASSWORD}' python seed_admin.py"

echo ""
success "Done! You can now log in at ${GREEN}http://localhost:3000/admin${NC}"
echo -e "  Email:    ${BOLD}${ADMIN_EMAIL}${NC}"
echo -e "  Password: ${DIM}(the one you just entered)${NC}"
echo ""