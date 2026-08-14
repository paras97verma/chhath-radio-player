#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — Interactive Production Deployment Setup
#
# Run this script once to set up all production services and deploy.
# Re-run anytime to update credentials or trigger a new deployment.
#
# What this script does:
#   1. Checks prerequisites (git, docker, curl, gh CLI)
#   2. Guides you through creating accounts on Supabase, Upstash, Render, Vercel
#   3. Collects all required credentials interactively (with inline help)
#   4. Writes backend/.env and frontend/.env.local for local dev
#   5. Sets GitHub Actions secrets via gh CLI (or prints manual instructions)
#   6. Sets Render environment variables via Render API
#   7. Sets Vercel environment variables via Vercel CLI
#   8. Triggers first production deployment
#   9. Polls backend health endpoint until healthy
#  10. Prints a summary of all URLs and next steps
#
# Usage:
#   chmod +x scripts/deploy-setup.sh
#   ./scripts/deploy-setup.sh
# =============================================================================

set -euo pipefail

# ── Resolve project root ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
MAGENTA='\033[0;35m'

info()    { echo -e "${CYAN}  ›${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $*"; }
error()   { echo -e "${RED}  ✗ ERROR:${NC} $*" >&2; }
step()    { echo -e "\n${BOLD}${BLUE}══ $* ${NC}"; }
divider() { echo -e "${DIM}────────────────────────────────────────────────────${NC}"; }
link()    { echo -e "  ${MAGENTA}→${NC} $*"; }
box_start() { echo -e "  ${DIM}┌─ $* ─$( printf '─%.0s' $(seq 1 $((48 - ${#1}))) )┐${NC}"; }
box_line()  { echo -e "  ${DIM}│${NC}  $*"; }
box_end()   { echo -e "  ${DIM}└──────────────────────────────────────────────────┘${NC}"; }

# ── Prompt helpers ────────────────────────────────────────────────────────────
prompt() {
  local var_name="$1"
  local prompt_text="$2"
  local default="${3:-}"
  local secret="${4:-false}"

  if [ "$secret" = "true" ]; then
    read -r -s -p "  ${CYAN}?${NC} ${prompt_text}: " value
    echo ""
  else
    if [ -n "$default" ]; then
      read -r -p "  ${CYAN}?${NC} ${prompt_text} [${DIM}${default}${NC}]: " value
      value="${value:-$default}"
    else
      read -r -p "  ${CYAN}?${NC} ${prompt_text}: " value
    fi
  fi

  eval "$var_name='$value'"
}

prompt_yn() {
  local prompt_text="$1"
  local default="${2:-Y}"
  read -r -p "  ${CYAN}?${NC} ${prompt_text} [${default}]: " yn
  yn="${yn:-$default}"
  [[ "$yn" =~ ^[Yy]$ ]]
}

# ── Generate a secure random secret ──────────────────────────────────────────
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64
  fi
}

# ── Banner ────────────────────────────────────────────────────────────────────
print_banner() {
  clear
  echo ""
  echo -e "${BOLD}${YELLOW}"
  echo "  🪔  Chhath Radio — Production Deployment Setup"
  echo -e "${NC}${DIM}  छठ के गीत, बिना रुके${NC}"
  divider
  echo ""
  echo -e "  This script will guide you through deploying Chhath Radio to:"
  echo -e "  ${BOLD}Render${NC} (backend) + ${BOLD}Vercel${NC} (frontend) + ${BOLD}Supabase${NC} (DB) + ${BOLD}Upstash${NC} (Redis)"
  echo ""
  echo -e "  ${DIM}All services are free tier — zero cost.${NC}"
  echo -e "  ${DIM}Re-run this script anytime to update credentials or re-deploy.${NC}"
  echo ""
  divider
  echo ""
  read -r -p "  Press Enter to begin..." _
}

# =============================================================================
# SECTION 1: Prerequisites
# =============================================================================
check_prerequisites() {
  step "SECTION 1: Prerequisites"

  local missing=0

  if command -v git >/dev/null 2>&1; then
    success "git found: $(git --version)"
  else
    error "git is not installed. Install from https://git-scm.com"
    missing=1
  fi

  if command -v docker >/dev/null 2>&1; then
    success "docker found: $(docker --version | head -1)"
  else
    error "docker is not installed. Install from https://docs.docker.com/get-docker/"
    missing=1
  fi

  if command -v curl >/dev/null 2>&1; then
    success "curl found"
  else
    error "curl is not installed."
    missing=1
  fi

  if command -v python3 >/dev/null 2>&1; then
    success "python3 found: $(python3 --version)"
  else
    warn "python3 not found — some features may be limited"
  fi

  if command -v gh >/dev/null 2>&1; then
    success "gh CLI found: $(gh --version | head -1)"
    GH_CLI_AVAILABLE=true
    # Check if authenticated
    if gh auth status >/dev/null 2>&1; then
      success "gh CLI authenticated"
    else
      warn "gh CLI not authenticated. Run: gh auth login"
      warn "GitHub secrets will need to be set manually."
      GH_CLI_AVAILABLE=false
    fi
  else
    warn "gh CLI not found — GitHub secrets must be set manually."
    warn "Install from: https://cli.github.com"
    GH_CLI_AVAILABLE=false
  fi

  if [ "$missing" -eq 1 ]; then
    echo ""
    error "Required tools are missing. Install them and re-run this script."
    exit 1
  fi

  # Detect git remote
  GITHUB_REPO=$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null | sed 's/.*github.com[:/]//' | sed 's/\.git$//' || echo "")
  if [ -n "$GITHUB_REPO" ]; then
    success "GitHub repo: $GITHUB_REPO"
  else
    warn "Could not detect GitHub remote. GitHub secrets must be set manually."
  fi
}

# =============================================================================
# SECTION 2: Supabase (PostgreSQL)
# =============================================================================
collect_supabase() {
  step "SECTION 2: Supabase (PostgreSQL Database)"

  echo ""
  echo -e "  Supabase provides a free PostgreSQL database (500MB, no expiry)."
  echo ""
  box_start "How to get your DATABASE_URL"
  box_line "1. Go to ${CYAN}https://supabase.com${NC} and sign in"
  box_line "2. New Project → choose a name and region (ap-south-1 for India)"
  box_line "3. Wait for the project to be ready (~2 min)"
  box_line "4. Go to: Project Settings → Database → Connection Pooling"
  box_line "5. Copy the ${BOLD}Connection string${NC} (URI format, port 6543)"
  box_line "   It looks like:"
  box_line "   postgresql://postgres.[ref]:[password]@aws-0-..."
  box_line "   .pooler.supabase.com:6543/postgres"
  box_end
  echo ""
  link "Open Supabase: https://supabase.com/dashboard"
  echo ""

  while true; do
    prompt DATABASE_URL "Paste your Supabase DATABASE_URL"
    if [[ "$DATABASE_URL" == postgresql://* ]] || [[ "$DATABASE_URL" == postgres://* ]]; then
      success "DATABASE_URL looks valid"
      break
    else
      warn "URL should start with postgresql:// — please try again"
    fi
  done
}

# =============================================================================
# SECTION 3: Upstash (Redis)
# =============================================================================
collect_upstash() {
  step "SECTION 3: Upstash (Redis)"

  echo ""
  echo -e "  Upstash provides a free Redis instance (10k commands/day)."
  echo -e "  ${DIM}Note: The app falls back to in-memory automatically if the limit is hit.${NC}"
  echo ""
  box_start "How to get your REDIS_URL"
  box_line "1. Go to ${CYAN}https://upstash.com${NC} and sign in"
  box_line "2. Create Database → Redis → choose region: ap-south-1 (Mumbai)"
  box_line "3. Go to: Database → Details → scroll to ${BOLD}Connect${NC}"
  box_line "4. Copy the ${BOLD}UPSTASH_REDIS_URL${NC} value"
  box_line "   It looks like:"
  box_line "   rediss://default:abc123@global-...upstash.io:6379"
  box_end
  echo ""
  link "Open Upstash: https://console.upstash.com"
  echo ""

  while true; do
    prompt REDIS_URL "Paste your Upstash REDIS_URL"
    if [[ "$REDIS_URL" == redis://* ]] || [[ "$REDIS_URL" == rediss://* ]]; then
      success "REDIS_URL looks valid"
      break
    else
      warn "URL should start with redis:// or rediss:// — please try again"
    fi
  done
}

# =============================================================================
# SECTION 4: Secret Key + Admin Credentials
# =============================================================================
collect_secrets() {
  step "SECTION 4: Secret Key + Admin Credentials"

  echo ""
  if prompt_yn "Generate a new SECRET_KEY automatically?"; then
    SECRET_KEY=$(gen_secret)
    success "Generated SECRET_KEY (64 hex chars)"
  else
    prompt SECRET_KEY "Enter your SECRET_KEY (min 32 chars)"
    if [ ${#SECRET_KEY} -lt 32 ]; then
      warn "SECRET_KEY is too short — generating one instead"
      SECRET_KEY=$(gen_secret)
      success "Generated SECRET_KEY"
    fi
  fi

  echo ""
  prompt ADMIN_EMAIL "Admin email for the Chhath Radio dashboard"
  prompt ADMIN_PASSWORD "Admin password (min 12 chars)" "" "true"
  if [ ${#ADMIN_PASSWORD} -lt 12 ]; then
    warn "Password is short — consider using a longer password in production"
  fi
  success "Admin credentials saved"
}

# =============================================================================
# SECTION 5: Render (Backend)
# =============================================================================
collect_render() {
  step "SECTION 5: Render (Backend Hosting)"

  echo ""
  echo -e "  Render hosts your FastAPI backend for free (750 hrs/mo)."
  echo -e "  ${DIM}Note: Free tier spins down after 15 min idle. Cold start ~30s.${NC}"
  echo -e "  ${DIM}During Chhath Puja the app will be continuously active — no cold starts.${NC}"
  echo ""
  box_start "How to create your Render Web Service"
  box_line "1. Go to ${CYAN}https://render.com${NC} and sign in"
  box_line "2. New → Web Service → Connect your GitHub repo"
  box_line "3. Settings:"
  box_line "   • Name: chhath-radio-api"
  box_line "   • Runtime: Docker"
  box_line "   • Root Directory: backend"
  box_line "   • Branch: main"
  box_line "   • Auto-Deploy: ${BOLD}NO${NC} (GitHub Actions controls deploys)"
  box_line "4. Under Advanced → Health Check Path: ${BOLD}/api/health${NC}"
  box_line "   (Render uses this to verify your service is up — must be set!)"
  box_line "5. Click Create Web Service"
  box_end
  echo ""
  link "Open Render: https://dashboard.render.com"
  echo ""
  read -r -p "  Press Enter once your Render service is created..." _

  echo ""
  box_start "How to get your Render Deploy Hook URL"
  box_line "1. Go to your Render service dashboard"
  box_line "2. Settings → Deploy Hook"
  box_line "3. Copy the URL (looks like:"
  box_line "   https://api.render.com/deploy/srv-xxx?key=yyy)"
  box_end
  echo ""

  while true; do
    prompt RENDER_DEPLOY_HOOK_URL "Paste your Render Deploy Hook URL"
    if [[ "$RENDER_DEPLOY_HOOK_URL" == https://api.render.com/deploy/* ]]; then
      success "Render deploy hook URL looks valid"
      break
    else
      warn "URL should start with https://api.render.com/deploy/ — please try again"
    fi
  done

  echo ""
  box_start "How to get your Render API Key + Service ID"
  box_line "API Key:"
  box_line "  1. Go to: https://dashboard.render.com/u/settings"
  box_line "  2. API Keys → Create API Key → copy it"
  box_line "Service ID:"
  box_line "  1. Open your service in Render dashboard"
  box_line "  2. The URL contains: /web/srv-XXXXXXXX"
  box_line "  3. Copy the srv-XXXXXXXX part"
  box_end
  echo ""

  prompt RENDER_API_KEY "Paste your Render API Key (or press Enter to skip auto-config)" "" "true"
  if [ -n "$RENDER_API_KEY" ]; then
    prompt RENDER_SERVICE_ID "Paste your Render Service ID (e.g. srv-abc123)"
    success "Render API credentials saved"
  else
    warn "Skipping Render API config — env vars must be set manually in Render dashboard"
    RENDER_SERVICE_ID=""
  fi

  echo ""
  prompt NEXT_PUBLIC_API_URL "What is your Render backend URL?" "https://chhath-radio-api.onrender.com"
  success "Backend URL: $NEXT_PUBLIC_API_URL"
}

# =============================================================================
# SECTION 6: Vercel (Frontend)
# =============================================================================
collect_vercel() {
  step "SECTION 6: Vercel (Frontend Hosting)"

  echo ""
  echo -e "  Vercel hosts your Next.js frontend for free (global CDN, HTTPS)."
  echo ""
  box_start "How to create your Vercel project"
  box_line "1. Go to ${CYAN}https://vercel.com${NC} and sign in"
  box_line "2. New Project → Import your GitHub repo"
  box_line "3. Settings:"
  box_line "   • Framework: Next.js (auto-detected)"
  box_line "   • Root Directory: frontend"
  box_line "   • Auto-Deploy: ${BOLD}NO${NC} (GitHub Actions controls deploys)"
  box_line "4. Click Deploy (first deploy will use placeholder env vars)"
  box_end
  echo ""
  link "Open Vercel: https://vercel.com/new"
  echo ""
  read -r -p "  Press Enter once your Vercel project is created..." _

  echo ""
  box_start "How to get your Vercel Token + Project IDs"
  box_line "Token:"
  box_line "  1. Go to: https://vercel.com/account/tokens"
  box_line "  2. Create Token → copy it"
  box_line "Org ID + Project ID:"
  box_line "  1. In your project root, run: npx vercel link"
  box_line "  2. This creates .vercel/project.json with orgId + projectId"
  box_line "  3. Or find them in: Vercel dashboard → Project → Settings → General"
  box_end
  echo ""

  prompt VERCEL_TOKEN "Paste your Vercel Token" "" "true"
  prompt VERCEL_ORG_ID "Paste your Vercel Org ID (team_xxx or your user ID)"
  prompt VERCEL_PROJECT_ID "Paste your Vercel Project ID (prj_xxx)"

  echo ""
  prompt NEXT_PUBLIC_SITE_URL "What is your Vercel frontend URL?" "https://chhathradio.vercel.app"
  success "Frontend URL: $NEXT_PUBLIC_SITE_URL"
}

# =============================================================================
# SECTION 7: Write local .env files
# =============================================================================
write_env_files() {
  step "SECTION 7: Writing local .env files"

  # backend/.env
  cat > "$PROJECT_ROOT/backend/.env" <<EOF
# Chhath Radio — Backend Environment Variables
# Generated by scripts/deploy-setup.sh on $(date)
# DO NOT COMMIT THIS FILE

DATABASE_URL=${DATABASE_URL}
REDIS_URL=${REDIS_URL}
SECRET_KEY=${SECRET_KEY}
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
WEB_CONCURRENCY=1
LOG_LEVEL=info
EOF
  success "Written: backend/.env"

  # frontend/.env.local
  cat > "$PROJECT_ROOT/frontend/.env.local" <<EOF
# Chhath Radio — Frontend Environment Variables
# Generated by scripts/deploy-setup.sh on $(date)
# DO NOT COMMIT THIS FILE

NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
EOF
  success "Written: frontend/.env.local"
}

# =============================================================================
# SECTION 8: Set GitHub Actions secrets
# =============================================================================
set_github_secrets() {
  step "SECTION 8: GitHub Actions Secrets"

  if [ "$GH_CLI_AVAILABLE" = "true" ] && [ -n "$GITHUB_REPO" ]; then
    info "Setting GitHub Actions secrets via gh CLI..."
    echo ""

    set_secret() {
      local name="$1"
      local value="$2"
      if [ -n "$value" ]; then
        echo -n "  Setting $name... "
        echo "$value" | gh secret set "$name" --repo "$GITHUB_REPO" 2>/dev/null && \
          echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}⚠ failed${NC}"
      fi
    }

    set_secret "RENDER_DEPLOY_HOOK_URL" "$RENDER_DEPLOY_HOOK_URL"
    set_secret "RENDER_API_KEY" "$RENDER_API_KEY"
    set_secret "RENDER_SERVICE_ID" "$RENDER_SERVICE_ID"
    set_secret "VERCEL_TOKEN" "$VERCEL_TOKEN"
    set_secret "VERCEL_ORG_ID" "$VERCEL_ORG_ID"
    set_secret "VERCEL_PROJECT_ID" "$VERCEL_PROJECT_ID"
    set_secret "DATABASE_URL" "$DATABASE_URL"
    set_secret "REDIS_URL" "$REDIS_URL"
    set_secret "SECRET_KEY" "$SECRET_KEY"
    set_secret "ADMIN_EMAIL" "$ADMIN_EMAIL"
    set_secret "ADMIN_PASSWORD" "$ADMIN_PASSWORD"
    set_secret "NEXT_PUBLIC_API_URL" "$NEXT_PUBLIC_API_URL"
    set_secret "NEXT_PUBLIC_SITE_URL" "$NEXT_PUBLIC_SITE_URL"

    echo ""
    success "All GitHub secrets set"
  else
    echo ""
    warn "gh CLI not available or not authenticated. Set these secrets manually:"
    link "https://github.com/$GITHUB_REPO/settings/secrets/actions"
    echo ""
    echo -e "  ${BOLD}Required secrets:${NC}"
    echo -e "  ${DIM}RENDER_DEPLOY_HOOK_URL${NC}     = $RENDER_DEPLOY_HOOK_URL"
    echo -e "  ${DIM}RENDER_API_KEY${NC}             = (your Render API key)"
    echo -e "  ${DIM}RENDER_SERVICE_ID${NC}          = $RENDER_SERVICE_ID"
    echo -e "  ${DIM}VERCEL_TOKEN${NC}               = (your Vercel token)"
    echo -e "  ${DIM}VERCEL_ORG_ID${NC}              = $VERCEL_ORG_ID"
    echo -e "  ${DIM}VERCEL_PROJECT_ID${NC}          = $VERCEL_PROJECT_ID"
    echo -e "  ${DIM}DATABASE_URL${NC}               = (your Supabase URL)"
    echo -e "  ${DIM}REDIS_URL${NC}                  = (your Upstash URL)"
    echo -e "  ${DIM}SECRET_KEY${NC}                 = (your secret key)"
    echo -e "  ${DIM}ADMIN_EMAIL${NC}                = $ADMIN_EMAIL"
    echo -e "  ${DIM}ADMIN_PASSWORD${NC}             = (your admin password)"
    echo -e "  ${DIM}NEXT_PUBLIC_API_URL${NC}        = $NEXT_PUBLIC_API_URL"
    echo -e "  ${DIM}NEXT_PUBLIC_SITE_URL${NC}       = $NEXT_PUBLIC_SITE_URL"
    echo ""
    read -r -p "  Press Enter once you've set the secrets manually..." _
  fi
}

# =============================================================================
# SECTION 9: Set Render env vars via API
# =============================================================================
set_render_env_vars() {
  step "SECTION 9: Configuring Render Environment Variables"

  if [ -z "$RENDER_API_KEY" ] || [ -z "$RENDER_SERVICE_ID" ]; then
    warn "Render API key or service ID not provided — skipping auto-config"
    warn "Set these env vars manually in your Render service dashboard:"
    link "https://dashboard.render.com"
    echo ""
    echo -e "  ${DIM}DATABASE_URL, REDIS_URL, SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD${NC}"
    echo -e "  ${DIM}ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, WEB_CONCURRENCY, LOG_LEVEL${NC}"
    return
  fi

  info "Updating env vars on Render service $RENDER_SERVICE_ID..."

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT \
    "https://api.render.com/v1/services/$RENDER_SERVICE_ID/env-vars" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    -d "[
      {\"key\":\"DATABASE_URL\",\"value\":\"$DATABASE_URL\"},
      {\"key\":\"REDIS_URL\",\"value\":\"$REDIS_URL\"},
      {\"key\":\"SECRET_KEY\",\"value\":\"$SECRET_KEY\"},
      {\"key\":\"ADMIN_EMAIL\",\"value\":\"$ADMIN_EMAIL\"},
      {\"key\":\"ADMIN_PASSWORD\",\"value\":\"$ADMIN_PASSWORD\"},
      {\"key\":\"ALGORITHM\",\"value\":\"HS256\"},
      {\"key\":\"ACCESS_TOKEN_EXPIRE_MINUTES\",\"value\":\"1440\"},
      {\"key\":\"WEB_CONCURRENCY\",\"value\":\"1\"},
      {\"key\":\"LOG_LEVEL\",\"value\":\"info\"}
    ]")

  if [ "$HTTP_CODE" = "200" ]; then
    success "Render env vars updated (HTTP $HTTP_CODE)"
  else
    warn "Render env vars update returned HTTP $HTTP_CODE — check Render dashboard"
  fi
}

# =============================================================================
# SECTION 10: Set Vercel env vars via CLI
# =============================================================================
set_vercel_env_vars() {
  step "SECTION 10: Configuring Vercel Environment Variables"

  if [ -z "$VERCEL_TOKEN" ]; then
    warn "Vercel token not provided — skipping auto-config"
    return
  fi

  if ! command -v npx >/dev/null 2>&1; then
    warn "npx not found — skipping Vercel env var config"
    warn "Set these env vars manually in your Vercel project settings:"
    link "https://vercel.com/dashboard"
    return
  fi

  info "Setting Vercel environment variables..."

  set_vercel_var() {
    local key="$1"
    local value="$2"
    if [ -n "$value" ]; then
      echo -n "  Setting $key... "
      echo "$value" | npx vercel env add "$key" production --token="$VERCEL_TOKEN" \
        --yes 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}⚠ (may already exist)${NC}"
    fi
  }

  (cd "$PROJECT_ROOT/frontend" && \
    VERCEL_ORG_ID="$VERCEL_ORG_ID" VERCEL_PROJECT_ID="$VERCEL_PROJECT_ID" \
    npx vercel link --yes --token="$VERCEL_TOKEN" 2>/dev/null || true)

  set_vercel_var "NEXT_PUBLIC_API_URL" "$NEXT_PUBLIC_API_URL"
  set_vercel_var "NEXT_PUBLIC_SITE_URL" "$NEXT_PUBLIC_SITE_URL"
  set_vercel_var "BACKEND_URL" "$NEXT_PUBLIC_API_URL"

  success "Vercel env vars configured"
}

# =============================================================================
# SECTION 11: Trigger first deployment
# =============================================================================
trigger_deploy() {
  step "SECTION 11: Trigger First Deployment"

  echo ""
  if ! prompt_yn "Trigger first production deployment now?"; then
    info "Skipping deployment. Push to main branch to deploy via GitHub Actions."
    return
  fi

  echo ""
  info "Triggering backend deploy on Render..."
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$RENDER_DEPLOY_HOOK_URL")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    success "Render deploy triggered (HTTP $HTTP_CODE)"
  else
    warn "Render deploy hook returned HTTP $HTTP_CODE"
  fi

  echo ""
  info "Waiting for backend to become healthy..."
  info "Render may take 2-5 minutes on first deploy (building Docker image)..."
  echo ""

  HEALTH_URL="$NEXT_PUBLIC_API_URL/api/health"
  MAX_ATTEMPTS=20
  ATTEMPT=0
  SPINNER=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')

  while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    SPIN_CHAR="${SPINNER[$((ATTEMPT % 10))]}"
    printf "\r  ${CYAN}›${NC} %s Attempt %d/%d — waiting 15s..." "$SPIN_CHAR" "$ATTEMPT" "$MAX_ATTEMPTS"

    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")
    if [ "$HTTP_STATUS" = "200" ]; then
      echo ""
      success "Backend is healthy! ($HEALTH_URL)"
      return
    fi

    sleep 15
  done

  echo ""
  warn "Backend did not become healthy within $((MAX_ATTEMPTS * 15))s."
  warn "Check your Render dashboard for build logs."
  link "https://dashboard.render.com"
}

# =============================================================================
# SECTION 12: Print summary
# =============================================================================
print_summary() {
  step "SECTION 12: Deployment Summary"

  echo ""
  echo -e "${BOLD}${GREEN}  🎉 Chhath Radio deployment setup complete!${NC}"
  echo ""
  divider
  echo ""
  echo -e "  ${BOLD}URLs${NC}"
  echo -e "  Frontend : ${CYAN}$NEXT_PUBLIC_SITE_URL${NC}"
  echo -e "  Backend  : ${CYAN}$NEXT_PUBLIC_API_URL${NC}"
  echo -e "  Health   : ${CYAN}$NEXT_PUBLIC_API_URL/api/health${NC}"
  echo -e "  Admin    : ${CYAN}$NEXT_PUBLIC_SITE_URL/admin${NC}"
  echo ""
  divider
  echo ""
  echo -e "  ${BOLD}Next steps${NC}"
  echo -e "  1. Push to ${BOLD}main${NC} branch to trigger automatic deploys via GitHub Actions"
  echo -e "  2. Log in to the admin panel and add songs to the queue"
  echo -e "  3. Share ${CYAN}$NEXT_PUBLIC_SITE_URL${NC} with your listeners"
  echo ""
  echo -e "  ${DIM}Local .env files written:${NC}"
  echo -e "  ${DIM}  backend/.env${NC}"
  echo -e "  ${DIM}  frontend/.env.local${NC}"
  echo ""
  divider
  echo ""
  echo -e "  ${DIM}छठ मइया की जय! 🪔${NC}"
  echo ""
}

# =============================================================================
# MAIN
# =============================================================================
main() {
  print_banner
  check_prerequisites
  collect_supabase
  collect_upstash
  collect_secrets
  collect_render
  collect_vercel
  write_env_files
  set_github_secrets
  set_render_env_vars
  set_vercel_env_vars
  trigger_deploy
  print_summary
}

main "$@"