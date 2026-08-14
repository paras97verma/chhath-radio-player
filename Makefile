# =============================================================================
# Chhath Radio — Root Makefile
#
# Usage:
#   make                  # show this help
#   make start            # start all services (Docker)
#   make test             # interactive QA test runner
#   make qa               # alias for make test
#
# All targets are documented below.
# =============================================================================

.DEFAULT_GOAL := help
.PHONY: help start stop restart logs logs-backend logs-frontend \
        shell-backend shell-frontend \
        migrate migrate-auto migrate-local migrate-auto-local \
        seed seed-songs seed-songs-clear seed-songs-fast \
        test smoke \
        test-backend test-backend-unit test-backend-int \
        test-frontend test-frontend-unit test-e2e \
        test-load test-all \
        lint lint-backend lint-frontend \
        build clean clean-volumes \
        download-sounds import-songs \
        prod-backend

# ─── Test suite selector ──────────────────────────────────────────────────────
# Usage:
#   make test              → runs all suites (backend + frontend unit + E2E)
#   make test SUITE=backend
#   make test SUITE=frontend
#   make test SUITE=frontend-unit
#   make test SUITE=e2e
SUITE ?=

# ─── Compose file helpers ──────────────────────────────────────────────────────
# Local stack uses local/docker-compose.local.yml; prod stack uses docker-compose.yml
LOCAL_COMPOSE := docker compose -f local/docker-compose.local.yml
PROD_COMPOSE  := docker compose

# ─── Colours ──────────────────────────────────────────────────────────────────

CYAN  := \033[0;36m
BOLD  := \033[1m
NC    := \033[0m

# ─── Config ───────────────────────────────────────────────────────────────────

API_URL       ?= http://localhost:8000
FRONTEND_URL  ?= http://localhost:3000
LOAD_USERS    ?= 50
LOAD_DURATION ?= 30

# ─── Help ─────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "$(BOLD)🪔  Chhath Radio — Makefile$(NC)"
	@echo ""
	@echo "$(CYAN)  Infrastructure$(NC)"
	@echo "    make start              Start all services (Docker Compose)"
	@echo "    make stop               Stop all services"
	@echo "    make restart            Restart all services"
	@echo "    make logs               Tail all logs"
	@echo "    make logs-backend       Backend logs only"
	@echo "    make logs-frontend      Frontend logs only"
	@echo "    make shell-backend      Shell into backend container"
	@echo "    make shell-frontend     Shell into frontend container"
	@echo "    make migrate            Run Alembic migrations (prod compose)"
	@echo "    make migrate-local      Run Alembic migrations (local compose)"
	@echo "    make migrate-auto MSG=  Auto-generate migration from schema diff (prod)"
	@echo "    make migrate-auto-local MSG=  Auto-generate migration (local compose)"
	@echo "    make seed               Seed admin user"
	@echo "    make build              Rebuild Docker images"
	@echo "    make clean              Remove containers (keep volumes)"
	@echo "    make clean-volumes      Remove containers AND volumes"
	@echo ""
	@echo "$(CYAN)  QA / Testing$(NC)"
	@echo "    make test               Run all test suites (backend + frontend unit + E2E)"
	@echo "    make test SUITE=backend Run backend tests only"
	@echo "    make test SUITE=frontend Run frontend unit + E2E tests"
	@echo "    make test SUITE=frontend-unit Run frontend unit tests only"
	@echo "    make test SUITE=e2e     Run E2E tests only"
	@echo "    make smoke              Smoke tests only (~30s)"
	@echo "    make test-backend       Backend unit + integration tests"
	@echo "    make test-backend-unit  Backend unit tests only (no server needed)"
	@echo "    make test-backend-int   Backend integration tests (needs running API)"
	@echo "    make test-frontend      Frontend unit tests (vitest)"
	@echo "    make test-e2e           Frontend E2E tests (Playwright)"
	@echo "    make test-load          Load / stress test"
	@echo "    make test-all           Run ALL test suites"
	@echo ""
	@echo "$(CYAN)  Content$(NC)"
	@echo "    make download-sounds    Download ambient sound files"
	@echo "    make import-songs       Bulk-import songs from YouTube"
	@echo "                            Usage: make import-songs FILE=urls.txt TOKEN=<jwt>"
	@echo ""
	@echo "$(CYAN)  Production$(NC)"
	@echo "    make prod-backend       Start backend with Gunicorn (prod mode)"
	@echo ""

# ─── Infrastructure ───────────────────────────────────────────────────────────

start:
	docker compose up -d
	@echo ""
	@echo "  ✓  Services started"
	@echo "     Backend:  http://localhost:8000"
	@echo "     Frontend: http://localhost:3000 (if frontend profile active)"
	@echo "     API docs: http://localhost:8000/docs"
	@echo ""

stop:
	docker compose down

restart:
	docker compose down
	docker compose up -d

logs:
	docker compose logs -f

logs-backend:
	docker compose logs -f backend

logs-frontend:
	docker compose logs -f frontend

shell-backend:
	docker compose exec backend bash

shell-frontend:
	docker compose exec frontend sh

migrate:
	$(PROD_COMPOSE) exec backend alembic upgrade head

migrate-local:
	$(LOCAL_COMPOSE) exec backend alembic upgrade head

# Auto-generate a migration from SQLAlchemy model diff (prod compose)
# Usage: make migrate-auto MSG="add_user_table"
migrate-auto:
	$(PROD_COMPOSE) exec backend alembic revision --autogenerate -m "$(MSG)"

# Auto-generate a migration from SQLAlchemy model diff (local compose)
# Usage: make migrate-auto-local MSG="add_user_table"
migrate-auto-local:
	$(LOCAL_COMPOSE) exec backend alembic upgrade head
	$(LOCAL_COMPOSE) exec backend alembic revision --autogenerate -m "$(MSG)"

seed:
	$(LOCAL_COMPOSE) exec backend python seed_admin.py

# Seed songs from scripts/songs.txt — fetches real YouTube metadata via oEmbed
# Usage: make seed-songs
#        make seed-songs-clear   (wipe existing songs first)
#        make seed-songs-fast    (skip metadata fetch, use placeholders)
seed-songs:
	$(LOCAL_COMPOSE) exec backend python seed_songs.py --file /scripts/songs.txt

seed-songs-clear:
	$(LOCAL_COMPOSE) exec backend python seed_songs.py --file /scripts/songs.txt --clear

seed-songs-fast:
	$(LOCAL_COMPOSE) exec backend python seed_songs.py --file /scripts/songs.txt --no-fetch

build:
	docker compose build

clean:
	docker compose down --remove-orphans

clean-volumes:
	docker compose down --remove-orphans --volumes

# ─── QA / Testing ─────────────────────────────────────────────────────────────

# Run test suites via scripts/test.sh
# Usage:
#   make test              → all suites (backend + frontend unit + E2E)
#   make test SUITE=backend
#   make test SUITE=frontend
#   make test SUITE=frontend-unit
#   make test SUITE=e2e
test:
	@bash scripts/test.sh $(SUITE)

# Smoke tests — fast API sanity checks (legacy qa-tests runner)
smoke:
	@API_URL=$(API_URL) FRONTEND_URL=$(FRONTEND_URL) \
	  bash qa-tests/run.sh --smoke

# Backend tests (unit + integration via pytest)
test-backend:
	@bash scripts/test.sh backend

# Backend unit tests only (alias)
test-backend-unit:
	@bash scripts/test.sh backend

# Backend integration tests (needs running API — alias)
test-backend-int:
	@bash scripts/test.sh backend

# Frontend unit tests (Vitest)
test-frontend test-frontend-unit:
	@bash scripts/test.sh frontend-unit

# Frontend E2E (Playwright)
# Run headless (default):  make test-e2e
# Run headed (visible):    make test-e2e HEADED=1
test-e2e:
	@HEADED=$(HEADED) bash scripts/test.sh e2e

# Load / stress test (legacy qa-tests runner)
test-load:
	@API_URL=$(API_URL) LOAD_USERS=$(LOAD_USERS) LOAD_DURATION=$(LOAD_DURATION) \
	  bash qa-tests/run.sh --load

# Run ALL test suites
test-all:
	@bash scripts/test.sh

# ─── Linting ──────────────────────────────────────────────────────────────────

lint: lint-backend lint-frontend

lint-backend:
	cd backend && python -m ruff check . || true
	cd backend && python -m mypy app/ --ignore-missing-imports || true

lint-frontend:
	cd frontend && npx eslint . --ext .ts,.tsx || true

# ─── Content ──────────────────────────────────────────────────────────────────

download-sounds:
	bash scripts/download-sounds.sh

import-songs:
	@if [ -z "$(FILE)" ]; then \
	  echo "Usage: make import-songs FILE=urls.txt TOKEN=<admin-jwt>"; \
	  exit 1; \
	fi
	python scripts/import_songs.py \
	  --file "$(FILE)" \
	  $(if $(TOKEN),--token "$(TOKEN)",) \
	  $(if $(API_URL),--api-url "$(API_URL)",)

import-songs-dry:
	@if [ -z "$(FILE)" ]; then \
	  echo "Usage: make import-songs-dry FILE=urls.txt"; \
	  exit 1; \
	fi
	python scripts/import_songs.py --file "$(FILE)" --dry-run

# ─── Production ───────────────────────────────────────────────────────────────

prod-backend:
	cd backend && gunicorn --config gunicorn.conf.py app.main:app
