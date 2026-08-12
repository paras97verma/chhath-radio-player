#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — Production Admin Seeder
#
# Creates an admin user inside the running backend container on the VPS.
# Run this AFTER a successful deployment (./scripts/deploy.sh).
#
# Usage:
#   ./scripts/seed-admin-prod.sh
#
# The script is interactive — it will prompt for VPS connection details,
# admin email, and password. It is safe to run multiple times; existing
# admins are not duplicated.
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()    { echo -e "${CYAN}  ›${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $*"; }
error()   { echo -e "${RED}  ✗ ERROR:${NC} $*" >&2; exit 1; }
divider() { echo -e "${DIM}────────────────────────────────────────────────────${NC}"; }
ask()     { echo -e "${BOLD}  ?${NC} $*"; }

echo ""
echo -e "${BOLD}${YELLOW}  🚀  Chhath Radio — Seed Production Admin User${NC}"
divider
echo ""
echo -e "  ${DIM}This script connects to your VPS and creates an admin user"
echo -e "  inside the running backend Docker container.${NC}"
echo ""

# ── VPS connection details ────────────────────────────────────────────────────
ask "VPS IP address or hostname:"
read -r -p "  → " VPS_HOST
[ -z "$VPS_HOST" ] && error "VPS host is required."

ask "SSH username [ubuntu]:"
read -r -p "  → " VPS_USER
VPS_USER="${VPS_USER:-ubuntu}"

local_default_key="$HOME/.ssh/id_rsa"
ask "Path to SSH private key [$local_default_key]:"
read -r -p "  → " SSH_KEY
SSH_KEY="${SSH_KEY:-$local_default_key}"
[ ! -f "$SSH_KEY" ] && error "SSH key not found at: $SSH_KEY"

ask "Remote app directory [/opt/chhath-radio]:"
read -r -p "  → " REMOTE_APP_DIR
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/chhath-radio}"

echo ""
divider

# ── Admin credentials ─────────────────────────────────────────────────────────
ask "Admin email [admin@chhathradio.com]:"
read -r -p "  → " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@chhathradio.com}"

ask "Admin password (will not be echoed):"
read -r -s -p "  → " ADMIN_PASSWORD
echo ""
[ -z "$ADMIN_PASSWORD" ] && error "Password cannot be empty."

echo ""
divider
echo -e "  ${BOLD}Summary:${NC}"
echo -e "  VPS:        ${GREEN}${VPS_USER}@${VPS_HOST}${NC}"
echo -e "  Remote dir: ${GREEN}${REMOTE_APP_DIR}${NC}"
echo -e "  Admin:      ${GREEN}${ADMIN_EMAIL}${NC}"
divider
echo ""
read -r -p "  Proceed? [Y/n] " confirm
[[ "$confirm" =~ ^[Nn]$ ]] && { info "Aborted."; exit 0; }

# ── Verify SSH ────────────────────────────────────────────────────────────────
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=15"

info "Verifying SSH connection to ${VPS_HOST}..."
if ! ssh $SSH_OPTS "${VPS_USER}@${VPS_HOST}" "echo ok" >/dev/null 2>&1; then
  error "Cannot connect to ${VPS_USER}@${VPS_HOST}\n  Check your VPS IP, SSH key, and firewall settings."
fi
success "SSH connection OK."

# ── Check backend container is running ────────────────────────────────────────
info "Checking backend container on VPS..."
CONTAINER_STATUS=$(ssh $SSH_OPTS "${VPS_USER}@${VPS_HOST}" \
  "cd ${REMOTE_APP_DIR} && docker compose ps --format '{{.State}}' backend 2>/dev/null || echo 'not_found'")

if [[ "$CONTAINER_STATUS" != "running" ]]; then
  error "Backend container is not running on the VPS.\n  Deploy first: ${CYAN}./scripts/deploy.sh${NC}"
fi
success "Backend container is running."

# ── Seed admin ────────────────────────────────────────────────────────────────
info "Seeding admin user '${ADMIN_EMAIL}' on VPS..."

ssh $SSH_OPTS "${VPS_USER}@${VPS_HOST}" bash <<REMOTE
set -euo pipefail
cd ${REMOTE_APP_DIR}
docker compose exec -T backend sh -c \
  "ADMIN_EMAIL='${ADMIN_EMAIL}' ADMIN_PASSWORD='${ADMIN_PASSWORD}' python seed_admin.py"
REMOTE

echo ""
success "Admin user seeded successfully!"
echo ""
echo -e "  ${BOLD}Login at:${NC} ${GREEN}https://your-frontend-domain/admin${NC}"
echo -e "  Email:    ${BOLD}${ADMIN_EMAIL}${NC}"
echo -e "  Password: ${DIM}(the one you just entered)${NC}"
echo ""
warn "Keep your admin password safe. Do not store it in any config file."
echo ""