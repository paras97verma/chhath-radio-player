#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — Interactive Production Deployment Script
# Target: Oracle Cloud Free Tier VPS (or any Linux VPS with Docker)
#
# ─── WHAT THIS SCRIPT DOES ───────────────────────────────────────────────────
#   1. Walks you through required configuration interactively
#   2. Verifies SSH connectivity to the VPS
#   3. Checks that .env.production exists on the VPS (guides you if not)
#   4. Packages the backend source (excluding dev/test/cache files)
#   5. Uploads the package to the VPS via SCP
#   6. Extracts and runs docker compose up --build -d on the VPS
#   7. Optionally seeds the first admin user
#   8. Cleans up local and remote tarballs + dangling Docker images
#   9. Prints live service status and URLs
#
# ─── REQUIREMENTS (LOCAL MACHINE) ────────────────────────────────────────────
#   • ssh, scp, tar  (pre-installed on macOS/Linux)
#   • SSH private key with access to the VPS
#
# ─── REQUIREMENTS (VPS — ONE-TIME SETUP) ─────────────────────────────────────
#   • Ubuntu 22.04 LTS (Oracle Cloud Free Tier: VM.Standard.E2.1.Micro)
#   • Docker Engine + Docker Compose v2
#   • Port 22 (SSH) and 8000 (API) open in OCI Security List + OS firewall
#   • /opt/chhath-radio/.env.production filled in with real values
#
# ─── FREE DOMAIN & TLS (100% FREE) ──────────────────────────────────────────
#   Oracle Cloud does NOT provide a free domain name.
#   Here are your free options:
#
#   Option A — Freenom / afraid.org (free subdomain):
#     • Go to https://freedns.afraid.org and register a free subdomain
#       e.g. chhathradio.mooo.com
#     • Point it to your VPS public IP (A record)
#     • Then use Certbot on the VPS for a free Let's Encrypt TLS cert
#
#   Option B — Cloudflare (recommended, free plan):
#     • Buy a cheap domain (~$1/yr at Namecheap or Porkbun)
#     • Add it to Cloudflare (free plan)
#     • Set an A record pointing to your VPS IP
#     • Enable Cloudflare proxy (orange cloud) for free TLS + DDoS protection
#     • No Certbot needed — Cloudflare handles TLS termination
#
#   Option C — No domain (IP only):
#     • Use http://YOUR_VPS_IP:8000 directly
#     • Set NEXT_PUBLIC_API_URL=http://YOUR_VPS_IP:8000 in Vercel
#     • No TLS — fine for development/testing, not recommended for production
#
#   Option D — Cloudflare Tunnel (zero open ports, free):
#     • Install cloudflared on the VPS
#     • Run: cloudflared tunnel --url http://localhost:8000
#     • Cloudflare gives you a free *.trycloudflare.com URL with HTTPS
#     • No firewall changes needed — outbound only
#
# ─── USAGE ───────────────────────────────────────────────────────────────────
#   chmod +x scripts/deploy.sh
#   ./scripts/deploy.sh
# =============================================================================

set -euo pipefail

# ── Resolve paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()    { echo -e "${CYAN}  ›${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $*"; }
error()   { echo -e "${RED}  ✗ ERROR:${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}══ $* ${NC}"; }
divider() { echo -e "${DIM}────────────────────────────────────────────────────${NC}"; }
ask()     { echo -e "${BOLD}  ?${NC} $*"; }

# ── Banner ────────────────────────────────────────────────────────────────────
print_banner() {
  clear
  echo ""
  echo -e "${BOLD}${YELLOW}"
  echo "  🚀  Chhath Radio — Production Deployment"
  echo -e "${NC}${DIM}  Deploy backend to Oracle Cloud VPS (or any Linux VPS)${NC}"
  divider
  echo ""
  echo -e "  ${DIM}This script will package and deploy the FastAPI backend."
  echo -e "  The Next.js frontend is deployed separately on Vercel.${NC}"
  echo ""
}

# ── Requirements check ────────────────────────────────────────────────────────
check_local_deps() {
  step "Checking local requirements"

  local missing=()
  for cmd in ssh scp tar; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing+=("$cmd")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    error "Missing required tools: ${missing[*]}\nInstall them and try again."
  fi

  success "All required tools are available (ssh, scp, tar)."
}

# ── Domain guidance ───────────────────────────────────────────────────────────
show_domain_guidance() {
  echo ""
  echo -e "  ${BOLD}${YELLOW}ℹ  Free Domain & TLS Options${NC}"
  divider
  echo ""
  echo -e "  Oracle Cloud does ${BOLD}NOT${NC} provide a free domain name."
  echo -e "  Your free options (all 100% free):"
  echo ""
  echo -e "  ${BOLD}A) Cloudflare Tunnel${NC} ${GREEN}(easiest — no domain needed, no open ports)${NC}"
  echo -e "     • Install cloudflared on the VPS"
  echo -e "     • Run: ${CYAN}cloudflared tunnel --url http://localhost:8000${NC}"
  echo -e "     • You get a free *.trycloudflare.com HTTPS URL instantly"
  echo -e "     • Guide: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/"
  echo ""
  echo -e "  ${BOLD}B) FreeDNS subdomain + Let's Encrypt${NC} ${GREEN}(free subdomain)${NC}"
  echo -e "     • Register at https://freedns.afraid.org"
  echo -e "     • Create an A record pointing to your VPS IP"
  echo -e "     • Install Nginx + Certbot on the VPS for free TLS"
  echo -e "     • Guide: https://certbot.eff.org/instructions?ws=nginx&os=ubuntufocal"
  echo ""
  echo -e "  ${BOLD}C) Cloudflare + cheap domain${NC} ${GREEN}(recommended for production)${NC}"
  echo -e "     • Buy a domain (~\$1/yr at Porkbun: https://porkbun.com)"
  echo -e "     • Add to Cloudflare free plan: https://cloudflare.com"
  echo -e "     • Set A record → your VPS IP, enable orange-cloud proxy"
  echo -e "     • Free TLS + DDoS protection, no Certbot needed"
  echo ""
  echo -e "  ${BOLD}D) IP only (no domain, no TLS)${NC} ${DIM}(dev/testing only)${NC}"
  echo -e "     • Use http://YOUR_VPS_IP:8000 directly"
  echo -e "     • Set NEXT_PUBLIC_API_URL=http://YOUR_VPS_IP:8000 in Vercel"
  echo ""
  divider
}

# ── Interactive configuration ─────────────────────────────────────────────────
collect_config() {
  step "Configuration"
  echo ""
  echo -e "  ${DIM}Press Enter to accept the default value shown in [brackets].${NC}"
  echo ""

  ask "VPS IP address or hostname (from Oracle Cloud console):"
  read -r -p "  → " VPS_HOST
  [ -z "$VPS_HOST" ] && error "VPS host is required."

  ask "SSH username [ubuntu]:"
  read -r -p "  → " VPS_USER
  VPS_USER="${VPS_USER:-ubuntu}"

  local default_key="$HOME/.ssh/id_rsa"
  ask "Path to SSH private key [$default_key]:"
  read -r -p "  → " SSH_KEY
  SSH_KEY="${SSH_KEY:-$default_key}"
  [ ! -f "$SSH_KEY" ] && error "SSH key not found at: $SSH_KEY\n  Generate one with: ssh-keygen -t rsa -b 4096"

  ask "Remote app directory [/opt/chhath-radio]:"
  read -r -p "  → " REMOTE_APP_DIR
  REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/chhath-radio}"

  echo ""
  echo ""
  divider
  echo -e "  ${BOLD}Deployment summary:${NC}"
  echo -e "  Host:       ${GREEN}$VPS_HOST${NC}"
  echo -e "  User:       ${GREEN}$VPS_USER${NC}"
  echo -e "  SSH Key:    ${GREEN}$SSH_KEY${NC}"
  echo -e "  Remote dir: ${GREEN}$REMOTE_APP_DIR${NC}"
  divider
  echo ""
  read -r -p "  Proceed with deployment? [Y/n] " confirm
  if [[ "$confirm" =~ ^[Nn]$ ]]; then
    info "Aborted. Run the script again to reconfigure."
    exit 0
  fi
}

# ── SSH helpers ───────────────────────────────────────────────────────────────
SSH_OPTS=""

set_ssh_opts() {
  SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=15"
}

remote_exec() {
  ssh $SSH_OPTS "${VPS_USER}@${VPS_HOST}" "$@"
}

# ── Verify SSH connectivity ───────────────────────────────────────────────────
verify_ssh() {
  step "Verifying SSH connectivity"
  set_ssh_opts
  info "Connecting to ${VPS_USER}@${VPS_HOST}..."

  if ! remote_exec "echo 'SSH OK'" >/dev/null 2>&1; then
    echo ""
    error "Cannot connect to ${VPS_USER}@${VPS_HOST} with key $SSH_KEY\n\n  Troubleshooting:\n  • Check the VPS IP and username\n  • Ensure your SSH public key is in ~/.ssh/authorized_keys on the VPS\n  • In Oracle Cloud: Compute → Instance → Add SSH Key\n  • Check OCI Security List allows TCP port 22 from 0.0.0.0/0\n  • Check OS firewall: sudo ufw allow 22/tcp && sudo ufw enable"
  fi
  success "SSH connection successful."

  info "Checking Docker on VPS..."
  if ! remote_exec "docker compose version" >/dev/null 2>&1; then
    echo ""
    warn "Docker Compose v2 is not installed on the VPS."
    echo ""
    echo -e "  Install Docker on the VPS with:"
    echo -e "  ${CYAN}ssh -i $SSH_KEY ${VPS_USER}@${VPS_HOST}${NC}"
    echo -e "  ${CYAN}curl -fsSL https://get.docker.com | sudo sh${NC}"
    echo -e "  ${CYAN}sudo usermod -aG docker \$USER && newgrp docker${NC}"
    echo ""
    error "Install Docker on the VPS and run this script again."
  fi
  success "Docker Compose is available on the VPS."
}

# ── Check .env.production on VPS ─────────────────────────────────────────────
verify_remote_env() {
  step "Verifying production environment file"

  if ! remote_exec "test -f ${REMOTE_APP_DIR}/.env.production" 2>/dev/null; then
    echo ""
    warn ".env.production not found at ${REMOTE_APP_DIR}/.env.production"
    echo ""
    echo -e "  ${BOLD}You need to create it on the VPS before deploying.${NC}"
    echo -e "  A template is at: ${CYAN}backend/.env.production${NC}"
    echo ""
    echo -e "  ${BOLD}Steps:${NC}"
    echo -e "  ${DIM}1. SSH into the VPS:${NC}"
    echo -e "     ${CYAN}ssh -i $SSH_KEY ${VPS_USER}@${VPS_HOST}${NC}"
    echo -e "  ${DIM}2. Create the directory:${NC}"
    echo -e "     ${CYAN}sudo mkdir -p ${REMOTE_APP_DIR} && sudo chown \$(whoami):\$(whoami) ${REMOTE_APP_DIR}${NC}"
    echo -e "  ${DIM}3. Create the env file:${NC}"
    echo -e "     ${CYAN}nano ${REMOTE_APP_DIR}/.env.production${NC}"
    echo -e "  ${DIM}4. Paste the contents of backend/.env.production and fill in real values${NC}"
    echo -e "  ${DIM}5. Generate a secret key:${NC}"
    echo -e "     ${CYAN}openssl rand -hex 32${NC}"
    echo ""
    read -r -p "  Have you created .env.production on the VPS? [y/N] " ready
    if [[ ! "$ready" =~ ^[Yy]$ ]]; then
      info "Deployment aborted. Create .env.production on the VPS and run again."
      exit 0
    fi

    if ! remote_exec "test -f ${REMOTE_APP_DIR}/.env.production" 2>/dev/null; then
      error ".env.production still not found at ${REMOTE_APP_DIR}/.env.production"
    fi
  fi

  success ".env.production found on VPS."
}

# ── Package backend ───────────────────────────────────────────────────────────
package_backend() {
  step "Packaging backend source"

  TARBALL="/tmp/chhath-backend-$(date +%Y%m%d%H%M%S).tar.gz"

  info "Creating archive (excluding dev/test/cache files)..."
  tar -czf "$TARBALL" \
    -C "$PROJECT_ROOT" \
    --exclude='backend/__pycache__' \
    --exclude='backend/**/__pycache__' \
    --exclude='backend/.venv' \
    --exclude='backend/venv' \
    --exclude='backend/.env' \
    --exclude='backend/.env.production' \
    --exclude='backend/test.db' \
    --exclude='backend/tests' \
    --exclude='backend/.pytest_cache' \
    --exclude='.git' \
    backend/ \
    docker-compose.yml

  local size
  size=$(du -sh "$TARBALL" | cut -f1)
  success "Created archive: $(basename "$TARBALL") ($size)"
}

# ── Upload to VPS ─────────────────────────────────────────────────────────────
upload_package() {
  step "Uploading to VPS"

  local remote_tarball="/tmp/$(basename "$TARBALL")"
  info "Uploading to ${VPS_USER}@${VPS_HOST}:${remote_tarball}..."

  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$TARBALL" \
    "${VPS_USER}@${VPS_HOST}:${remote_tarball}"

  REMOTE_TARBALL="$remote_tarball"
  success "Upload complete."
}

# ── Deploy on VPS ─────────────────────────────────────────────────────────────
deploy_remote() {
  step "Deploying on VPS"
  info "Extracting and starting services on ${VPS_HOST}..."

  remote_exec bash <<REMOTE
set -euo pipefail

echo "  › Creating app directory: ${REMOTE_APP_DIR}"
sudo mkdir -p ${REMOTE_APP_DIR}
sudo chown \$(whoami):\$(whoami) ${REMOTE_APP_DIR}

echo "  › Extracting archive..."
tar -xzf ${REMOTE_TARBALL} -C ${REMOTE_APP_DIR} --strip-components=1

echo "  › Running docker compose up --build -d..."
cd ${REMOTE_APP_DIR}
docker compose --env-file backend/.env.production up --build -d

echo "  › Pruning dangling Docker images..."
docker image prune -f

echo "  › Removing remote archive..."
rm -f ${REMOTE_TARBALL}

echo "  › Service status:"
docker compose ps
REMOTE

  success "Remote deployment complete."
}

# ── Local cleanup ─────────────────────────────────────────────────────────────
cleanup_local() {
  step "Cleaning up"
  rm -f "$TARBALL"
  success "Local archive removed."
}

# ── Print result ──────────────────────────────────────────────────────────────
print_result() {
  echo ""
  divider
  echo -e "  ${BOLD}${GREEN}Deployment successful!${NC}"
  echo ""
  echo -e "  ${BOLD}Backend API:${NC}  ${GREEN}http://${VPS_HOST}:8000${NC}"
  echo -e "  ${BOLD}Health:${NC}       ${GREEN}http://${VPS_HOST}:8000/health${NC}"
  echo -e "  ${BOLD}API Docs:${NC}     ${GREEN}http://${VPS_HOST}:8000/docs${NC}"
  echo ""
  echo -e "  ${BOLD}${YELLOW}Next steps:${NC}"
  echo ""
  echo -e "  ${DIM}1. Seed the first admin user:${NC}"
  echo -e "     ${CYAN}./scripts/seed-admin-prod.sh${NC}"
  echo ""
  echo -e "  ${DIM}2. Configure Vercel frontend:${NC}"
  echo -e "     Set ${BOLD}NEXT_PUBLIC_API_URL=http://${VPS_HOST}:8000${NC} in Vercel project settings"
  echo ""
  echo -e "  ${DIM}3. (Optional) Set up a free domain + TLS — see README.md for options${NC}"
  echo ""
  echo -e "  ${DIM}4. Tail logs on VPS:${NC}"
  echo -e "     ${CYAN}ssh -i $SSH_KEY ${VPS_USER}@${VPS_HOST} 'cd ${REMOTE_APP_DIR} && docker compose logs -f'${NC}"
  echo ""
  echo -e "  ${DIM}5. Re-deploy after code changes:${NC}"
  echo -e "     ${CYAN}./scripts/deploy.sh${NC}"
  divider
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  print_banner
  show_domain_guidance

  read -r -p "  Press Enter to continue to deployment configuration..." _
  echo ""

  check_local_deps
  collect_config
  verify_ssh
  verify_remote_env
  package_backend
  upload_package
  deploy_remote
  cleanup_local
  print_result
}

main "$@"