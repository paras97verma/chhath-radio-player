"""
GET /api/chhath-dates?year=YYYY

Returns the 4 Chhath Puja days for the given year.

Data source: Calendarific API (free tier — 1000 req/month).
  https://calendarific.com/api/v2/holidays?api_key=KEY&country=IN&year=YYYY&type=religious

If CALENDARIFIC_API_KEY is not set or the API call fails, falls back to
a pure-Python astronomical calculation (Meeus algorithm) — no external
dependencies required.

Cache: results are cached in-process for the lifetime of the server process
(one set of 4 dates per year). The cache is invalidated when all 4 days
have passed (i.e., Usha Arghya is in the past), so the next request
automatically fetches the following year.
"""

import datetime
import logging
import math
import os
from functools import lru_cache
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["chhath"])

IST = ZoneInfo("Asia/Kolkata")
SYNODIC_MONTH = 29.530588861  # days
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
    source: str            # "calendarific" | "local"


# ─── In-process cache ─────────────────────────────────────────────────────────

_cache: dict[int, ChhathDatesOut] = {}


def _cache_valid(result: ChhathDatesOut) -> bool:
    """Cache is valid as long as at least one day has NOT yet passed."""
    now = datetime.datetime.now(tz=IST)
    return any(
        datetime.datetime.fromisoformat(d.date_ist) > now
        for d in result.days
    )


# ─── Local astronomical fallback (Meeus algorithm) ───────────────────────────

def _to_rad(deg: float) -> float:
    return deg * math.pi / 180


def _new_moon_jd(k: float) -> float:
    T = k / 1236.85
    T2, T3, T4 = T * T, T ** 3, T ** 4
    JDE = (2451550.09766 + 29.530588861 * k + 0.00015437 * T2
           - 0.00000015 * T3 + 0.00000000073 * T4)
    M   = _to_rad(2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3)
    Mp  = _to_rad(201.5643 + 385.81693528 * k + 0.0107582 * T2
                  + 0.00001238 * T3 - 0.000000058 * T4)
    F   = _to_rad(160.7108 + 390.67050284 * k - 0.0016118 * T2
                  - 0.00000227 * T3 + 0.000000011 * T4)
    Om  = _to_rad(124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3)
    E   = 1 - 0.002516 * T - 0.0000074 * T2

    JDE += (-0.4072 * math.sin(Mp) + 0.17241 * E * math.sin(M)
            + 0.01608 * math.sin(2 * Mp) + 0.01039 * math.sin(2 * F)
            + 0.00739 * E * math.sin(Mp - M) - 0.00514 * E * math.sin(Mp + M)
            + 0.00208 * E * E * math.sin(2 * M) - 0.00111 * math.sin(Mp - 2 * F)
            - 0.00057 * math.sin(Mp + 2 * F) + 0.00056 * E * math.sin(2 * Mp + M)
            - 0.00042 * math.sin(3 * Mp) + 0.00042 * E * math.sin(M + 2 * F)
            + 0.00038 * E * math.sin(M - 2 * F) - 0.00024 * E * math.sin(2 * Mp - M)
            - 0.00017 * math.sin(Om) - 0.00007 * math.sin(Mp + 2 * M)
            + 0.00004 * math.sin(2 * Mp - 2 * F) + 0.00004 * math.sin(3 * M)
            + 0.00003 * math.sin(Mp + M - 2 * F) + 0.00003 * math.sin(2 * Mp + 2 * F)
            - 0.00003 * math.sin(Mp + M + 2 * F) + 0.00003 * math.sin(Mp - M + 2 * F)
            - 0.00002 * math.sin(Mp - M - 2 * F) - 0.00002 * math.sin(3 * Mp + M)
            + 0.00002 * math.sin(4 * Mp))

    A1 = _to_rad(299.77 + 0.107408 * k - 0.009173 * T2)
    JDE += (0.000325 * math.sin(A1)
            + 0.000165 * math.sin(_to_rad(251.88 + 0.016321 * k))
            + 0.000164 * math.sin(_to_rad(251.83 + 26.651886 * k))
            + 0.000126 * math.sin(_to_rad(349.42 + 36.412478 * k))
            + 0.000110 * math.sin(_to_rad(84.66 + 18.206239 * k)))
    return JDE


def _jd_to_datetime_utc(jd: float) -> datetime.datetime:
    z = int(jd + 0.5)
    f = jd + 0.5 - z
    A = z
    if z >= 2299161:
        alpha = int((z - 1867216.25) / 36524.25)
        A = z + 1 + alpha - alpha // 4
    B = A + 1524
    C = int((B - 122.1) / 365.25)
    D = int(365.25 * C)
    E = int((B - D) / 30.6001)
    day_frac = B - D - int(30.6001 * E) + f
    month = E - 1 if E < 14 else E - 13
    year = C - 4716 if month > 2 else C - 4715
    day_int = int(day_frac)
    frac = day_frac - day_int
    ms = int(frac * 86400000)
    return datetime.datetime(year, month, day_int, tzinfo=datetime.timezone.utc) + datetime.timedelta(milliseconds=ms)


def _kartik_amavasya_local(year: int) -> datetime.datetime:
    approx = datetime.datetime(year, 10, 15, tzinfo=datetime.timezone.utc)
    days_since_j2000 = (approx.timestamp() - 946728000) / 86400
    k_base = round(days_since_j2000 / SYNODIC_MONTH)
    best: datetime.datetime | None = None
    for dk in range(-3, 4):
        d = _jd_to_datetime_utc(_new_moon_jd(k_base + dk))
        if d.month in (10, 11):
            if best is None or abs((d - approx).total_seconds()) < abs((best - approx).total_seconds()):
                best = d
    return best or _jd_to_datetime_utc(_new_moon_jd(k_base))


def _build_days_local(year: int) -> list[ChhathDayOut]:
    amavasya = _kartik_amavasya_local(year)
    tithi_s = (SYNODIC_MONTH / 30) * 86400
    shashthi_utc = amavasya + datetime.timedelta(seconds=6 * tithi_s)
    shashthi_ist = shashthi_utc.astimezone(IST)
    base = shashthi_ist.date()

    months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    now = datetime.datetime.now(tz=IST)

    def make_ist(d: datetime.date, h: int, m: int) -> datetime.datetime:
        return datetime.datetime(d.year, d.month, d.day, h, m, tzinfo=IST)

    def fmt(dt: datetime.datetime) -> str:
        ampm = "AM" if dt.hour < 12 else "PM"
        h = dt.hour % 12 or 12
        return f"{dt.day} {months[dt.month - 1]}, {h}:{dt.minute:02d} {ampm}"

    specs = [
        (1, "Nahay Khay",     "नहाय खाय",     "🛁", base - datetime.timedelta(days=2), 6,  0),
        (2, "Kharna",         "खरना",          "🌙", base - datetime.timedelta(days=1), 18, 0),
        (3, "Sandhya Arghya", "संध्या अर्घ्य", "🌇", base,                              17, 45),
        (4, "Usha Arghya",    "उषा अर्घ्य",   "🌅", base + datetime.timedelta(days=1), 6,  15),
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


# ─── Calendarific API ─────────────────────────────────────────────────────────

CHHATH_KEYWORDS = {"chhath", "chhat", "surya shashthi", "shashthi"}

async def _fetch_calendarific(year: int) -> list[ChhathDayOut] | None:
    api_key = os.getenv("CALENDARIFIC_API_KEY", "")
    if not api_key:
        return None

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(CALENDARIFIC_URL, params={
                "api_key": api_key,
                "country": "IN",
                "year": year,
                "type": "religious",
            })
            r.raise_for_status()
            data = r.json()
    except Exception as exc:
        logger.warning("Calendarific API error: %s", exc)
        return None

    holidays = data.get("response", {}).get("holidays", [])
    # Find Chhath Puja entry
    chhath_date: datetime.date | None = None
    for h in holidays:
        name_lower = h.get("name", "").lower()
        if any(kw in name_lower for kw in CHHATH_KEYWORDS):
            try:
                iso = h["date"]["iso"]
                chhath_date = datetime.date.fromisoformat(iso[:10])
                break
            except Exception:
                continue

    if chhath_date is None:
        logger.warning("Calendarific: Chhath Puja not found in %d response", year)
        return None

    # Calendarific returns Sandhya Arghya (Day 3) as "Chhath Puja"
    # Build all 4 days relative to it
    months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    now = datetime.datetime.now(tz=IST)

    def make_ist(d: datetime.date, h: int, m: int) -> datetime.datetime:
        return datetime.datetime(d.year, d.month, d.day, h, m, tzinfo=IST)

    def fmt(dt: datetime.datetime) -> str:
        ampm = "AM" if dt.hour < 12 else "PM"
        h12 = dt.hour % 12 or 12
        return f"{dt.day} {months[dt.month - 1]}, {h12}:{dt.minute:02d} {ampm}"

    specs = [
        (1, "Nahay Khay",     "नहाय खाय",     "🛁", chhath_date - datetime.timedelta(days=2), 6,  0),
        (2, "Kharna",         "खरना",          "🌙", chhath_date - datetime.timedelta(days=1), 18, 0),
        (3, "Sandhya Arghya", "संध्या अर्घ्य", "🌇", chhath_date,                              17, 45),
        (4, "Usha Arghya",    "उषा अर्घ्य",   "🌅", chhath_date + datetime.timedelta(days=1), 6,  15),
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
        "Returns the 4 Chhath Puja days. Uses Calendarific API if "
        "CALENDARIFIC_API_KEY env var is set; otherwise falls back to a "
        "local astronomical calculation. Results are cached in-process "
        "until all 4 days have passed."
    ),
)
async def get_chhath_dates(
    year: int | None = Query(None, description="Gregorian year (default: auto)"),
) -> ChhathDatesOut:
    now = datetime.datetime.now(tz=IST)
    target_year = year or now.year

    # Check in-process cache
    if target_year in _cache and _cache_valid(_cache[target_year]):
        return _cache[target_year]

    # Try Calendarific first
    days = await _fetch_calendarific(target_year)
    source = "calendarific"

    if days is None:
        # Fall back to local calculation
        days = _build_days_local(target_year)
        source = "local"

    # If no year specified and all days are past, advance to next year
    if year is None and all(d.is_past for d in days):
        target_year += 1
        days_next = await _fetch_calendarific(target_year)
        if days_next is None:
            days = _build_days_local(target_year)
            source = "local"
        else:
            days = days_next
            source = "calendarific"

    result = ChhathDatesOut(year=target_year, days=days, source=source)
    _cache[target_year] = result
    return result
