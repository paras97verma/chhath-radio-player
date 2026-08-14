#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Chhath Radio — Unified Test Runner
#
# Usage:
#   bash scripts/test.sh                  # run all suites
#   bash scripts/test.sh backend          # backend unit + integration tests
#   bash scripts/test.sh frontend         # frontend unit + E2E tests
#   bash scripts/test.sh frontend-unit    # frontend unit tests only (Vitest)
#   bash scripts/test.sh e2e              # E2E tests only (Playwright)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SUITE="${1:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ─── Colour helpers ───────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Colour

pass() { echo -e "${GREEN}✔ $*${NC}"; }
fail() { echo -e "${RED}✘ $*${NC}"; }
info() { echo -e "${YELLOW}▶ $*${NC}"; }

# ─── Suite runners ────────────────────────────────────────────────────────────

run_backend() {
  info "Running backend tests inside Docker (pytest)…"

  # Prefer the running local-stack container; fall back to a one-off container
  # so tests always run in the exact same environment as production.
  COMPOSE_FILE="${REPO_ROOT}/local/docker-compose.local.yml"
  CONTAINER="chhath_backend"

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER}$"; then
    info "Using running container: ${CONTAINER}"
    if docker exec "${CONTAINER}" \
        python -m pytest tests/ -v --tb=short --color=yes; then
      pass "Backend tests passed"
      return 0
    else
      fail "Backend tests FAILED"
      return 1
    fi
  else
    info "Container not running — starting one-off backend container via Docker Compose…"
    if docker compose -f "${COMPOSE_FILE}" run --rm \
        -e REDIS_URL="redis://redis:6379/0" \
        backend \
        python -m pytest tests/ -v --tb=short --color=yes; then
      pass "Backend tests passed"
      return 0
    else
      fail "Backend tests FAILED"
      return 1
    fi
  fi
}

run_frontend_unit() {
  info "Running frontend unit tests (Vitest)…"
  cd "${REPO_ROOT}/frontend"
  if npx vitest run --reporter=verbose; then
    pass "Frontend unit tests passed"
    return 0
  else
    fail "Frontend unit tests FAILED"
    return 1
  fi
}

run_e2e() {
  info "Running E2E tests (Playwright)…"
  cd "${REPO_ROOT}/frontend"
  if npx playwright test --reporter=list; then
    pass "E2E tests passed"
    return 0
  else
    fail "E2E tests FAILED"
    return 1
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────

BACKEND_RESULT=0
FRONTEND_UNIT_RESULT=0
E2E_RESULT=0

case "${SUITE}" in
  "")
    run_backend          || BACKEND_RESULT=1
    run_frontend_unit    || FRONTEND_UNIT_RESULT=1
    run_e2e              || E2E_RESULT=1
    ;;
  backend)
    run_backend          || BACKEND_RESULT=1
    ;;
  frontend)
    run_frontend_unit    || FRONTEND_UNIT_RESULT=1
    run_e2e              || E2E_RESULT=1
    ;;
  frontend-unit)
    run_frontend_unit    || FRONTEND_UNIT_RESULT=1
    ;;
  e2e)
    run_e2e              || E2E_RESULT=1
    ;;
  *)
    echo "Usage: $0 [backend|frontend|frontend-unit|e2e]"
    exit 1
    ;;
esac

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "─────────────────────────────────────────"
echo "  Test Suite Summary"
echo "─────────────────────────────────────────"

if [[ "${SUITE}" == "" || "${SUITE}" == "backend" ]]; then
  [[ $BACKEND_RESULT -eq 0 ]] && pass "Backend        PASSED" || fail "Backend        FAILED"
fi
if [[ "${SUITE}" == "" || "${SUITE}" == "frontend" || "${SUITE}" == "frontend-unit" ]]; then
  [[ $FRONTEND_UNIT_RESULT -eq 0 ]] && pass "Frontend Unit  PASSED" || fail "Frontend Unit  FAILED"
fi
if [[ "${SUITE}" == "" || "${SUITE}" == "frontend" || "${SUITE}" == "e2e" ]]; then
  [[ $E2E_RESULT -eq 0 ]] && pass "E2E            PASSED" || fail "E2E            FAILED"
fi

echo "─────────────────────────────────────────"

OVERALL=$((BACKEND_RESULT + FRONTEND_UNIT_RESULT + E2E_RESULT))
if [[ $OVERALL -eq 0 ]]; then
  pass "All tests passed!"
  exit 0
else
  fail "One or more test suites failed."
  exit 1
fi