# =============================================================================
# Chhath Radio — Backend Production Dockerfile
#
# Multi-stage build for a lean, production-grade FastAPI image.
# Stage 1 (deps):   install Python dependencies
# Stage 2 (runner): copy app, expose port, run migrations + Gunicorn
#
# No local dev fallbacks. No curl. No extra apt packages.
# Health checks are handled by Render's platform.
#
# Build:
#   docker build -t chhath-backend ./backend
#
# Run (requires env vars — never hardcode secrets):
#   docker run -p 8000:8000 --env-file .env chhath-backend
# =============================================================================

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM python:3.12-slim AS deps

# libpq-dev is required by psycopg2 (PostgreSQL driver)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Stage 2: Production runner ────────────────────────────────────────────────
FROM python:3.12-slim AS runner

# Runtime libpq only (no dev headers)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed packages from deps stage
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy application source
COPY . .

# Ensure entrypoint is executable
RUN chmod +x run_server.sh

EXPOSE 8000

# run_server.sh: runs Alembic migrations then starts Gunicorn + Uvicorn workers
CMD ["./run_server.sh"]