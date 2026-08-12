# ── Backend Dockerfile ──────────────────────────────────────────────────────
# Multi-stage build: keeps the final image lean.
# Stage 1: install dependencies
# Stage 2: copy app + run migrations + start uvicorn
# ────────────────────────────────────────────────────────────────────────────

FROM python:3.12-slim AS base

# System deps needed by psycopg2 (libpq) and general tooling
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Dependency layer (cached unless requirements.txt changes) ────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Application code ─────────────────────────────────────────────────────────
COPY . .

# ── Entrypoint ───────────────────────────────────────────────────────────────
# run_server.sh: applies Alembic migrations then starts uvicorn
COPY run_server.sh /run_server.sh
RUN chmod +x /run_server.sh

EXPOSE 8000

CMD ["/run_server.sh"]