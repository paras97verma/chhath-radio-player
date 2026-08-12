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

# ── Start Gunicorn + Uvicorn workers ─────────────────────────────────────────
# Same command in local and production — no surprises.
echo "  Starting Gunicorn (Uvicorn workers)..."
exec gunicorn \
    --config /app/gunicorn.conf.py \
    app.main:app