"""
Gunicorn configuration for Chhath Radio backend.

Designed for production scale: multiple Uvicorn workers behind Gunicorn
for true multi-process concurrency.

Usage:
    gunicorn -c gunicorn.conf.py backend.app.main:app

Or via the Makefile:
    make start-prod-backend

Environment variables (override defaults):
    WEB_CONCURRENCY   — number of worker processes (default: 2*CPU+1)
    GUNICORN_TIMEOUT  — worker timeout in seconds (default: 120)
    GUNICORN_PORT     — bind port (default: 8000)
    GUNICORN_HOST     — bind host (default: 0.0.0.0)
"""

import multiprocessing
import os

# ─── Workers ──────────────────────────────────────────────────────────────────

# Uvicorn workers behind Gunicorn for async FastAPI support
worker_class = "uvicorn.workers.UvicornWorker"

# 2 × CPU + 1 is the standard recommendation for I/O-bound async apps.
# Override with WEB_CONCURRENCY env var for containers (e.g. set to 1 in dev).
workers = int(os.environ.get("WEB_CONCURRENCY", multiprocessing.cpu_count() * 2 + 1))

# Thread count per worker (Uvicorn workers are async, so 1 thread is fine)
threads = 1

# ─── Binding ──────────────────────────────────────────────────────────────────

host = os.environ.get("GUNICORN_HOST", "0.0.0.0")
port = os.environ.get("GUNICORN_PORT", "8000")
bind = f"{host}:{port}"

# ─── Timeouts ─────────────────────────────────────────────────────────────────

# Worker timeout — kill and restart a worker if it doesn't respond within N seconds.
# Set higher for SSE endpoints that hold long-lived connections.
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "120"))

# Keep-alive timeout for idle connections
keepalive = 5

# Graceful shutdown timeout
graceful_timeout = 30

# ─── Request limits ───────────────────────────────────────────────────────────

# Restart workers after N requests to prevent memory leaks
max_requests = 1000
max_requests_jitter = 100  # randomise to avoid thundering herd

# ─── Performance ──────────────────────────────────────────────────────────────

# Preload the app before forking workers — saves memory via copy-on-write
preload_app = True

# ─── Logging ──────────────────────────────────────────────────────────────────

# Log to stdout/stderr for Docker / systemd log collection
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info")

# Access log format: timestamp, method, path, status, response time
access_log_format = '%(t)s "%(r)s" %(s)s %(b)s %(D)sµs'

# ─── Process naming ───────────────────────────────────────────────────────────

proc_name = "chhath-radio-api"

# ─── Hooks ────────────────────────────────────────────────────────────────────

def on_starting(server):
    server.log.info(
        f"🪔 Chhath Radio API starting — {workers} workers on {bind}"
    )

def worker_exit(server, worker):
    server.log.info(f"Worker {worker.pid} exited")

def on_exit(server):
    server.log.info("🪔 Chhath Radio API stopped")