"""
GET /api/chhath-dates?year=YYYY

Returns the 4 Chhath Puja days for the given year.

Data source: Calendarific API (free tier — 1000 req/month).
  https://calendarific.com/api/v2/holidays?api_key=KEY&country=IN&year=YYYY&type=religious

Requires CALENDARIFIC_API_KEY environment variable to be set.

Cache: results are cached in-process for the lifetime of the server process
(one set of 4 dates per year). The cache is invalidated when all 4 days
have passed (i.e., Usha Arghya is in the past), so the next request
automatically fetches the following year.
"""

import datetime
import json
import logging
import os
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.redis import get_redis_client as _get_redis

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["chhath"])

IST = ZoneInfo("Asia/Kolkata")
CALENDARIFIC_URL = "https://calendarific.com/api/v2/holidays"

# ─── Pydantic models ──────────────────────────────────────────────────────────

class ChhathDayOut(BaseModel):
    day: int
    name: str
    name_hindi: str
    emoji: str
    date_ist: str          # ISO-8601 with IST offset
    time_label: str
    is_past: bool


class ChhathDatesOut(BaseModel):
    year: int
    days: list[ChhathDayOut]
    source: str            # always "calendarific"


# ─── In-process + Redis cache ──────────────────────────────────────────────────

_cache: dict[int, ChhathDatesOut] = {}


def _cache_valid(result: ChhathDatesOut) -> bool:
    """Cache is valid as long as at least one day has NOT yet passed."""
    now = datetime.datetime.now(tz=IST)
    return any(
        datetime.datetime.fromisoformat(d.date_ist) > now
        for d in result.days
    )


def _redis_cache_get(year: int) -> Optional[ChhathDatesOut]:
    """Retrieve cached ChhathDatesOut from Redis across deployments."""
    try:
        client = _get_redis()
        if client is None:
            return None
        raw = client.get(f"chhath:dates:{year}")
        if raw:
            data = json.loads(raw)
            result = ChhathDatesOut.model_validate(data)
            if _cache_valid(result):
                return result
    except Exception as exc:
        logger.warning("Redis GET chhath:dates failed: %s", exc)
    return None


def _redis_cache_set(result: ChhathDatesOut) -> None:
    """Store ChhathDatesOut in Redis with TTL until 24 hours after Usha Arghya."""
    try:
        client = _get_redis()
        if client is None:
            return

        now = datetime.datetime.now(tz=IST)
        last_day_dt = max(datetime.datetime.fromisoformat(d.date_ist) for d in result.days)
        expire_dt = last_day_dt + datetime.timedelta(days=1)
        ttl = int((expire_dt - now).total_seconds())

        if ttl > 0:
            client.setex(
                f"chhath:dates:{result.year}",
                ttl,
                result.model_dump_json(),
            )
            logger.info("Persisted Chhath dates for %d to Redis with TTL=%d seconds", result.year, ttl)
    except Exception as exc:
        logger.warning("Redis SET chhath:dates failed: %s", exc)


# ─── Calendarific API ─────────────────────────────────────────────────────────

CHHATH_KEYWORDS = {"chhath", "chhat", "surya shashthi", "shashthi"}

# Keywords that identify which specific Chhath day Calendarific returned.
# Calendarific may return any of the 4 days; we normalise to Sandhya Arghya
# (Day 3) as the anchor and compute the other 3 relative to it.
_DAY_OFFSETS: list[tuple[set[str], int]] = [
    # (keywords_in_name, offset_to_sandhya_arghya)
    ({"nahay", "naha"},          +2),   # Day 1 → Sandhya Arghya is 2 days later
    ({"kharna"},                  +1),   # Day 2 → Sandhya Arghya is 1 day later
    ({"usha", "ushya", "arghya"}, -1),   # Day 4 → Sandhya Arghya is 1 day earlier
    # Day 3 / generic "Chhath Puja" → offset 0 (default)
]


def _sandhya_arghya_date(matched_name: str, matched_date: datetime.date) -> datetime.date:
    """Given the holiday name and date returned by Calendarific, return the
    date of Sandhya Arghya (Day 3), which is the anchor for all 4 days."""
    name_lower = matched_name.lower()
    for keywords, offset in _DAY_OFFSETS:
        if any(kw in name_lower for kw in keywords):
            logger.info(
                "Calendarific: matched '%s' as day-offset %+d → Sandhya Arghya = %s",
                matched_name, offset, matched_date + datetime.timedelta(days=offset),
            )
            return matched_date + datetime.timedelta(days=offset)
    # Default: assume the matched entry IS Sandhya Arghya (Day 3)
    logger.info("Calendarific: matched '%s' as Day 3 (Sandhya Arghya) = %s", matched_name, matched_date)
    return matched_date


async def _fetch_calendarific(year: int) -> list[ChhathDayOut]:
    """Fetch Chhath dates from Calendarific API. Raises HTTPException on failure."""
    api_key = os.getenv("CALENDARIFIC_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="CALENDARIFIC_API_KEY is not configured. Please set it in your environment.",
        )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(CALENDARIFIC_URL, params={
                "api_key": api_key,
                "country": "IN",
                "year": year,
                "type": "religious",
            })
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as exc:
        logger.error("Calendarific API HTTP error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Calendarific API error: {exc.response.status_code}")
    except Exception as exc:
        logger.error("Calendarific API request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to reach Calendarific API")

    holidays = data.get("response", {}).get("holidays", [])
    logger.info("Calendarific: received %d holidays for year %d", len(holidays), year)

    # Find Chhath Puja entry — collect ALL matching entries and pick the best
    matched_name: str = ""
    chhath_date: datetime.date | None = None
    for h in holidays:
        name_lower = h.get("name", "").lower()
        if any(kw in name_lower for kw in CHHATH_KEYWORDS):
            try:
                iso = h["date"]["iso"]
                candidate = datetime.date.fromisoformat(iso[:10])
                logger.info("Calendarific: candidate holiday '%s' on %s", h.get("name"), candidate)
                # Prefer entries explicitly named "Chhath Puja" (Day 3) over
                # sub-day entries; but accept the first match as fallback.
                if chhath_date is None:
                    chhath_date = candidate
                    matched_name = h.get("name", "")
                if "chhath puja" in name_lower or "surya shashthi" in name_lower:
                    chhath_date = candidate
                    matched_name = h.get("name", "")
                    break
            except Exception:
                continue

    if chhath_date is None:
        logger.error("Calendarific: Chhath Puja not found in %d response", year)
        raise HTTPException(
            status_code=404,
            detail=f"Chhath Puja dates not found in Calendarific response for year {year}",
        )

    # Normalise to Sandhya Arghya (Day 3) regardless of which day was returned
    sandhya_date = _sandhya_arghya_date(matched_name, chhath_date)

    # Build all 4 days relative to Sandhya Arghya
    months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    now = datetime.datetime.now(tz=IST)

    def make_ist(d: datetime.date, h: int, m: int) -> datetime.datetime:
        return datetime.datetime(d.year, d.month, d.day, h, m, tzinfo=IST)

    def fmt(dt: datetime.datetime) -> str:
        ampm = "AM" if dt.hour < 12 else "PM"
        h12 = dt.hour % 12 or 12
        return f"{dt.day} {months[dt.month - 1]}, {h12}:{dt.minute:02d} {ampm}"

    specs = [
        (1, "Nahay Khay",     "नहाय खाय",     "🛁", sandhya_date - datetime.timedelta(days=2), 6,  0),
        (2, "Kharna",         "खरना",          "🌙", sandhya_date - datetime.timedelta(days=1), 18, 0),
        (3, "Sandhya Arghya", "संध्या अर्घ्य", "🌇", sandhya_date,                              17, 45),
        (4, "Usha Arghya",    "उषा अर्घ्य",   "🌅", sandhya_date + datetime.timedelta(days=1), 6,  15),
    ]

    return [
        ChhathDayOut(
            day=day_num, name=name, name_hindi=name_hindi, emoji=emoji,
            date_ist=make_ist(d, h, m).isoformat(),
            time_label=fmt(make_ist(d, h, m)),
            is_past=make_ist(d, h, m) < now,
        )
        for day_num, name, name_hindi, emoji, d, h, m in specs
    ]


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@router.get(
    "/chhath-dates",
    response_model=ChhathDatesOut,
    summary="Chhath Puja dates for a given year",
    description=(
        "Returns the 4 Chhath Puja days from the Calendarific API. "
        "Requires CALENDARIFIC_API_KEY environment variable. "
        "Results are cached in-process until all 4 days have passed."
    ),
)
async def get_chhath_dates(
    year: int | None = Query(None, description="Gregorian year (default: auto)"),
) -> ChhathDatesOut:
    now = datetime.datetime.now(tz=IST)
    target_year = year or now.year

    # 1. Check in-process cache
    if target_year in _cache and _cache_valid(_cache[target_year]):
        return _cache[target_year]

    # 2. Check Redis cache (persisted across container restarts/deployments)
    redis_cached = _redis_cache_get(target_year)
    if redis_cached:
        _cache[target_year] = redis_cached
        return redis_cached

    # 3. Fetch from Calendarific API
    days = await _fetch_calendarific(target_year)

    # If no year specified and all days are past, advance to next year
    if year is None and all(d.is_past for d in days):
        target_year += 1
        redis_cached_next = _redis_cache_get(target_year)
        if redis_cached_next:
            _cache[target_year] = redis_cached_next
            return redis_cached_next
        days = await _fetch_calendarific(target_year)

    result = ChhathDatesOut(year=target_year, days=days, source="calendarific")
    _cache[target_year] = result
    _redis_cache_set(result)
    return result
