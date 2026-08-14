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

# ── Run Alembic migrations ────────────────────────────────────────────────────
echo ""
echo "  Running database migrations..."
alembic upgrade head
echo "  ✓ Migrations complete."
echo ""

# ── Seed admin user (idempotent — skips if already exists) ───────────────────
# ADMIN_EMAIL and ADMIN_PASSWORD must be set as environment variables.
# seed_admin.py is safe to run on every startup — it checks for existing admin.
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "  Seeding admin user..."
  python seed_admin.py && echo "  ✓ Admin seed complete." || echo "  ⚠ Admin seed failed (non-fatal)."
  echo ""
else
  echo "  ⚠ ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed."
  echo "    Set these env vars and redeploy, or run: python seed_admin.py manually."
  echo ""
fi

# ── Start Gunicorn + Uvicorn workers ─────────────────────────────────────────
# Same command in local and production — no surprises.
echo "  Starting Gunicorn (Uvicorn workers)..."
exec gunicorn \
    --config /app/gunicorn.conf.py \
    app.main:app