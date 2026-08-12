"""
Public API route to serve Chhath Puja facts from the bundled JSON file.
No authentication required.
"""
import json
import random
from pathlib import Path
from functools import lru_cache

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["facts"])

_DATA_FILE = Path(__file__).parent.parent / "data" / "chhath_facts.json"


@lru_cache(maxsize=1)
def _load_facts() -> list[dict]:
    """Load and cache the facts list from disk (loaded once at startup)."""
    with _DATA_FILE.open(encoding="utf-8") as f:
        data = json.load(f)
    return data["facts"]


@router.get("/facts", summary="Get all Chhath Puja facts")
def get_facts() -> list[dict]:
    """
    GET /api/facts
    Returns the full list of Chhath Puja facts.
    The frontend rotates through these to display one at a time.
    """
    return _load_facts()


@router.get("/facts/random", summary="Get a single random Chhath Puja fact")
def get_random_fact() -> dict:
    """
    GET /api/facts/random
    Returns a single randomly selected fact.
    """
    facts = _load_facts()
    return random.choice(facts)