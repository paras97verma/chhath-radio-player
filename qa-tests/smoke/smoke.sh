#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — Smoke Tests
#
# Fast sanity checks that run in < 30 seconds.
# Verifies that all critical API endpoints are reachable and return expected
# status codes and response shapes.
#
# Usage:
#   bash qa-tests/smoke/smoke.sh [BASE_URL]
#   BASE_URL defaults to http://localhost:8000
#
# Exit codes:
#   0 — all smoke tests passed
#   1 — one or more tests failed
# =============================================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
FRONTEND_URL="${2:-http://localhost:3000}"
PASS=0
FAIL=0
RESULTS=()

# ─── Colours ──────────────────────────────────────────────────────────────────
GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[1;33m"
BOLD="\033[1m"; NC="\033[0m"

# ─── Helpers ──────────────────────────────────────────────────────────────────

check() {
  local NAME="$1"
  local EXPECTED_STATUS="$2"
  local URL="$3"
  local EXTRA_ARGS="${4:-}"

  HTTP_CODE=$(curl -s -o /tmp/qa_body.txt -w "%{http_code}" \
    --max-time 10 $EXTRA_ARGS "$URL" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "$EXPECTED_STATUS" ]; then
    echo -e "  ${GREEN}✓${NC}  $NAME (HTTP $HTTP_CODE)"
    RESULTS+=("PASS|$NAME")
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗${NC}  $NAME — expected HTTP $EXPECTED_STATUS, got $HTTP_CODE"
    RESULTS+=("FAIL|$NAME|expected=$EXPECTED_STATUS got=$HTTP_CODE")
    ((FAIL++)) || true
  fi
}

check_json_field() {
  local NAME="$1"
  local URL="$2"
  local FIELD="$3"

  BODY=$(curl -s --max-time 10 "$URL" 2>/dev/null || echo "{}")
  VALUE=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$FIELD','__MISSING__'))" 2>/dev/null || echo "__ERROR__")

  if [ "$VALUE" != "__MISSING__" ] && [ "$VALUE" != "__ERROR__" ] && [ -n "$VALUE" ]; then
    echo -e "  ${GREEN}✓${NC}  $NAME (.${FIELD}=${VALUE})"
    RESULTS+=("PASS|$NAME")
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗${NC}  $NAME — field '$FIELD' missing or empty in response"
    RESULTS+=("FAIL|$NAME|field=$FIELD missing")
    ((FAIL++)) || true
  fi
}

# ─── Tests ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}🪔  Chhath Radio — Smoke Tests${NC}"
echo -e "    Backend:  $BASE_URL"
echo -e "    Frontend: $FRONTEND_URL"
echo ""
echo -e "${BOLD}  Backend API${NC}"

check "Health check"              "200" "$BASE_URL/health"
check "OpenAPI docs"              "200" "$BASE_URL/docs"
check "Songs list"                "200" "$BASE_URL/api/songs"
check "Radio queue"               "200" "$BASE_URL/api/radio/queue"
check "Presence count"            "200" "$BASE_URL/api/presence/count"
check "Facts list"                "200" "$BASE_URL/api/facts"
check "Admin auth (no token)"     "401" "$BASE_URL/api/admin/songs"
check "SSE events (no session)"   "422" "$BASE_URL/api/events"

echo ""
echo -e "${BOLD}  Response shape checks${NC}"

check_json_field "Health status field"  "$BASE_URL/health"              "status"
check_json_field "Presence count field" "$BASE_URL/api/presence/count"  "count"

echo ""
echo -e "${BOLD}  Frontend${NC}"

check "Frontend homepage"         "200" "$FRONTEND_URL/"
check "Share page (no params)"    "200" "$FRONTEND_URL/share"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "  ─────────────────────────────────────"
echo -e "  ${GREEN}✓  Passed: $PASS${NC}"
echo -e "  ${RED}✗  Failed: $FAIL${NC}"
echo "  ─────────────────────────────────────"

# Write outcome to file
OUTCOME_DIR="qa-tests/outcomes"
mkdir -p "$OUTCOME_DIR"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTCOME_FILE="$OUTCOME_DIR/smoke_${TIMESTAMP}.txt"

{
  echo "Chhath Radio — Smoke Test Results"
  echo "Timestamp: $(date)"
  echo "Base URL: $BASE_URL"
  echo "Frontend URL: $FRONTEND_URL"
  echo "Passed: $PASS"
  echo "Failed: $FAIL"
  echo ""
  for r in "${RESULTS[@]}"; do
    echo "$r"
  done
} > "$OUTCOME_FILE"

echo ""
echo -e "  Results saved to: ${YELLOW}$OUTCOME_FILE${NC}"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1