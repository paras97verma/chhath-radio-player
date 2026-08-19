#!/usr/bin/env bash
# =============================================================================
# Chhath Radio — Backend Entrypoint
#
# Runs Alembic migrations then starts the API server.
# Uses Gunicorn + Uvicorn workers in BOTH local and production.
# This ensures local behaviour is identical to production.
#
# Environment variables:
#   WEB_CONCURRENCY   — number of Gunicorn workers (default: 2*CPU+1)
#   GUNICORN_PORT     — bind port (default: 8000)
#   LOG_LEVEL         — uvicorn log level (default: info)
# =============================================================================

set -euo pipefail

echo "🪔  Chhath Radio API starting..."
echo "    Python: $(python --version)"
echo "    Workers: ${WEB_CONCURRENCY:-auto}"

# ── Run Alembic migrations (conditional — default: false) ─────────────────────
if [ "${RUN_MIGRATIONS:-false}" = "true" ] || [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  echo ""
  echo "  Running database migrations..."
  alembic upgrade head
  echo "  ✓ Migrations complete."
  echo ""
else
  echo ""
  echo "  ℹ RUN_MIGRATIONS is off — skipping automatic database migrations on startup."
  echo ""
fi

# ── Seed admin user (conditional — default: false) ────────────────────────────
if [ "${SEED_ADMIN:-false}" = "true" ] || [ "${SEED_ADMIN:-0}" = "1" ]; then
  if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
    echo "  Seeding admin user..."
    python seed_admin.py && echo "  ✓ Admin seed complete." || echo "  ⚠ Admin seed failed (non-fatal)."
    echo ""
  else
    echo "  ⚠ SEED_ADMIN is true but ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed."
    echo ""
  fi
else
  echo "  ℹ SEED_ADMIN is off — skipping automatic admin seed on startup."
  echo ""
fi

# ── Start Gunicorn + Uvicorn workers ─────────────────────────────────────────
# Same command in local and production — no surprises.
echo "  Starting Gunicorn (Uvicorn workers)..."
exec gunicorn \
    --config /app/gunicorn.conf.py \
    app.main:app