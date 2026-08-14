#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — Interactive QA Test Runner
#
# Usage:
#   bash qa-tests/run.sh                 # interactive menu
#   bash qa-tests/run.sh --all           # run everything non-interactively
#   bash qa-tests/run.sh --smoke
#   bash qa-tests/run.sh --backend-unit
#   bash qa-tests/run.sh --backend-int
#   bash qa-tests/run.sh --frontend-unit
#   bash qa-tests/run.sh --e2e
#   bash qa-tests/run.sh --load
#
# Environment variables:
#   API_URL       — backend base URL (default: http://localhost:8000)
#   FRONTEND_URL  — frontend base URL (default: http://localhost:3000)
#   LOAD_USERS    — concurrent users for load test (default: 50)
#   LOAD_DURATION — load test duration in seconds (default: 30)
# =============================================================================

set -euo pipefail

API_URL="${API_URL:-http://localhost:8000}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
LOAD_USERS="${LOAD_USERS:-50}"
LOAD_DURATION="${LOAD_DURATION:-30}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA_DIR="$ROOT_DIR/qa-tests"
OUTCOMES_DIR="$QA_DIR/outcomes"
mkdir -p "$OUTCOMES_DIR"

BOLD="\033[1m"; GREEN="\033[0;32m"; RED="\033[0;31m"
YELLOW="\033[1;33m"; CYAN="\033[0;36m"; NC="\033[0m"

PASS=0; FAIL=0
SUITE_RESULTS=()

# ─── Helpers ──────────────────────────────────────────────────────────────────

header() { echo ""; echo -e "${BOLD}${CYAN}══ $1 ══${NC}"; }
ok()     { echo -e "  ${GREEN}✓${NC}  $1"; }
fail()   { echo -e "  ${RED}✗${NC}  $1"; }
info()   { echo -e "  ${YELLOW}ℹ${NC}  $1"; }

run_suite() {
  local NAME="$1"; shift
  header "$NAME"
  if "$@"; then
    ok "$NAME passed"
    SUITE_RESULTS+=("PASS|$NAME")
    ((PASS++)) || true
  else
    fail "$NAME FAILED"
    SUITE_RESULTS+=("FAIL|$NAME")
    ((FAIL++)) || true
  fi
}

# ─── Individual suites ────────────────────────────────────────────────────────

do_smoke() {
  info "API: $API_URL  Frontend: $FRONTEND_URL"
  bash "$QA_DIR/smoke/smoke.sh" "$API_URL" "$FRONTEND_URL"
}

do_backend_unit() {
  info "pytest — backend unit tests (no server needed)"
  cd "$ROOT_DIR/backend"
  python -m pytest "$QA_DIR/app/backend/unit/" \
    -v --tb=short --color=yes -p no:warnings \
    2>&1 | tee "$OUTCOMES_DIR/backend_unit_$(date +%Y%m%d_%H%M%S).txt"
  local RC=${PIPESTATUS[0]}
  cd "$ROOT_DIR"
  return $RC
}

do_backend_int() {
  info "pytest — backend integration tests (needs API at $API_URL)"
  cd "$ROOT_DIR/backend"
  python -m pytest "$QA_DIR/app/backend/integration/" \
    -v --tb=short --color=yes -p no:warnings \
    2>&1 | tee "$OUTCOMES_DIR/backend_int_$(date +%Y%m%d_%H%M%S).txt"
  local RC=${PIPESTATUS[0]}
  cd "$ROOT_DIR"
  return $RC
}

do_frontend_unit() {
  info "vitest — frontend unit tests"
  cd "$ROOT_DIR/frontend"
  npx vitest run --reporter=verbose --config vitest.config.ts \
    2>&1 | tee "$OUTCOMES_DIR/frontend_unit_$(date +%Y%m%d_%H%M%S).txt"
  local RC=${PIPESTATUS[0]}
  cd "$ROOT_DIR"
  return $RC
}

do_e2e() {
  info "Playwright E2E (needs app at $FRONTEND_URL)"
  cd "$ROOT_DIR/frontend"
  npx playwright test --reporter=list \
    2>&1 | tee "$OUTCOMES_DIR/e2e_$(date +%Y%m%d_%H%M%S).txt"
  local RC=${PIPESTATUS[0]}
  cd "$ROOT_DIR"
  return $RC
}

do_load() {
  info "Load test: $LOAD_USERS users x ${LOAD_DURATION}s against $API_URL"
  python "$QA_DIR/load/load_test.py" \
    --url "$API_URL" --users "$LOAD_USERS" --duration "$LOAD_DURATION"
}

# ─── Summary ──────────────────────────────────────────────────────────────────

print_summary() {
  echo ""
  echo -e "${BOLD}══ QA Summary ══${NC}"
  for r in "${SUITE_RESULTS[@]}"; do
    IFS='|' read -r STATUS NAME <<< "$r"
    if [ "$STATUS" = "PASS" ]; then
      echo -e "  ${GREEN}✓${NC}  $NAME"
    else
      echo -e "  ${RED}✗${NC}  $NAME"
    fi
  done
  echo ""
  echo -e "  ${GREEN}Passed: $PASS${NC}   ${RED}Failed: $FAIL${NC}"

  TS=$(date +"%Y%m%d_%H%M%S")
  OUT="$OUTCOMES_DIR/summary_${TS}.txt"
  {
    echo "Chhath Radio QA Summary — $(date)"
    echo "API: $API_URL  Frontend: $FRONTEND_URL"
    for r in "${SUITE_RESULTS[@]}"; do echo "$r"; done
    echo "Passed: $PASS  Failed: $FAIL"
  } > "$OUT"
  echo -e "  Results saved: ${YELLOW}$OUT${NC}"
  echo ""
  [ "$FAIL" -eq 0 ]
}

# ─── Non-interactive flag handling ────────────────────────────────────────────

if [ $# -gt 0 ]; then
  case "$1" in
    --smoke)         run_suite "Smoke"               do_smoke ;;
    --backend-unit)  run_suite "Backend Unit"        do_backend_unit ;;
    --backend-int)   run_suite "Backend Integration" do_backend_int ;;
    --frontend-unit) run_suite "Frontend Unit"       do_frontend_unit ;;
    --e2e)           run_suite "E2E"                 do_e2e ;;
    --load)          run_suite "Load Test"           do_load ;;
    --all)
      run_suite "Smoke"                do_smoke
      run_suite "Backend Unit"         do_backend_unit
      run_suite "Backend Integration"  do_backend_int
      run_suite "Frontend Unit"        do_frontend_unit
      run_suite "E2E"                  do_e2e
      run_suite "Load Test"            do_load
      ;;
    *)
      echo "Unknown flag: $1"
      echo "Usage: bash qa-tests/run.sh [--smoke|--backend-unit|--backend-int|--frontend-unit|--e2e|--load|--all]"
      exit 1
      ;;
  esac
  print_summary
  exit $?
fi

# ─── Interactive menu ─────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}🪔  Chhath Radio — QA Test Runner${NC}"
echo -e "    API:      $API_URL"
echo -e "    Frontend: $FRONTEND_URL"
echo ""
echo -e "  Select tests to run (enter number, space-separated numbers, or 'a' for all):"
echo ""
echo -e "    ${CYAN}1${NC}  Smoke tests         (fast API sanity, ~30s)"
echo -e "    ${CYAN}2${NC}  Backend unit        (pytest, no server needed)"
echo -e "    ${CYAN}3${NC}  Backend integration (pytest, needs running API)"
echo -e "    ${CYAN}4${NC}  Frontend unit       (vitest)"
echo -e "    ${CYAN}5${NC}  Frontend E2E        (Playwright, needs running app)"
echo -e "    ${CYAN}6${NC}  Load / stress test  ($LOAD_USERS users x ${LOAD_DURATION}s)"
echo -e "    ${CYAN}a${NC}  ALL of the above"
echo -e "    ${CYAN}q${NC}  Quit"
echo ""
read -rp "  Your choice: " CHOICE

run_by_number() {
  case "$1" in
    1) run_suite "Smoke"               do_smoke ;;
    2) run_suite "Backend Unit"        do_backend_unit ;;
    3) run_suite "Backend Integration" do_backend_int ;;
    4) run_suite "Frontend Unit"       do_frontend_unit ;;
    5) run_suite "E2E"                 do_e2e ;;
    6) run_suite "Load Test"           do_load ;;
    *) echo -e "  ${YELLOW}Unknown option: $1 — skipping${NC}" ;;
  esac
}

case "$CHOICE" in
  a|A)
    run_suite "Smoke"                do_smoke
    run_suite "Backend Unit"         do_backend_unit
    run_suite "Backend Integration"  do_backend_int
    run_suite "Frontend Unit"        do_frontend_unit
    run_suite "E2E"                  do_e2e
    run_suite "Load Test"            do_load
    ;;
  q|Q)
    echo "Bye!"
    exit 0
    ;;
  *)
    for N in $CHOICE; do
      run_by_number "$N"
    done
    ;;
esac

print_summary
