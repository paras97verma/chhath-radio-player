"""
Chhath Radio — FastAPI Application Entry Point.
Registers all routers and configures CORS.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.songs import router as songs_router
from app.api.radio import router as radio_router
from app.api.presence import router as presence_router
from app.api.facts import router as facts_router
from app.api.events import router as events_router
from app.api.chat import router as chat_router
from app.api.ws_chat import router as ws_chat_router
from app.api.admin.auth import router as admin_auth_router
from app.api.admin.songs import router as admin_songs_router
from app.api.chhath_dates import router as chhath_dates_router

app = FastAPI(
    title="Chhath Radio API",
    description="Backend API for Chhath Radio — छठ के गीत, बिना रुके",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# CORS — allow the Next.js frontend to call the API.
# Reads CORS_ORIGINS env var (comma-separated list).
# Local dev default: localhost:3000
# Production: set CORS_ORIGINS=https://chhathradio.vercel.app in Render env vars.
# ---------------------------------------------------------------------------
_raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
_allow_origins: list[str] = (
    ["*"] if _raw_origins.strip() == "*"
    else [o.strip() for o in _raw_origins.split(",") if o.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=_raw_origins.strip() != "*",  # credentials not allowed with wildcard
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Register routers
# ---------------------------------------------------------------------------
app.include_router(songs_router)
app.include_router(radio_router)
app.include_router(presence_router)
app.include_router(facts_router)
app.include_router(events_router)
app.include_router(chat_router)
app.include_router(ws_chat_router)
app.include_router(admin_auth_router)
app.include_router(admin_songs_router)
app.include_router(chhath_dates_router)



@app.get("/api/health", tags=["health"])
def health_check() -> dict:
    """Simple health check endpoint."""
    return {"status": "ok", "service": "chhath-radio-api"}