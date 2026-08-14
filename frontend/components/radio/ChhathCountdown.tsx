"use client";

/**
 * ChhathCountdown — Fetches Chhath Puja dates from the backend API.
 * Neumorphic card design. No local fallback — shows loading until API responds.
 *
 * API: GET /api/chhath-dates  →  { year, days: [...] }
 */

import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChhathDay {
  day: number;
  name: string;
  name_hindi: string;
  emoji: string;
  date_ist: string;
  time_label: string;
  is_past: boolean;
}

interface ChhathDatesResponse {
  year: number;
  days: ChhathDay[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }

function computeCountdown(dateIso: string) {
  const target = new Date(dateIso);
  const diff = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
  return {
    days: Math.floor(diff / 86400),
    hours: Math.floor((diff % 86400) / 3600),
    minutes: Math.floor((diff % 3600) / 60),
    seconds: diff % 60,
    totalSeconds: diff,
  };
}

// ─── Neumorphic shadow constant ───────────────────────────────────────────────

const NM_CARD = "6px 6px 16px rgba(0,0,0,0.72), -3px -3px 10px rgba(60,30,10,0.32), inset 0 1px 0 rgba(255,255,255,0.04)";
const NM_BTN  = "4px 4px 10px rgba(0,0,0,0.65), -2px -2px 6px rgba(60,30,10,0.28)";
const NM_BTN_PRESSED = "inset 3px 3px 8px rgba(0,0,0,0.60), inset -1px -1px 4px rgba(60,30,10,0.20)";

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChhathCountdown() {
  const [data, setData] = useState<ChhathDatesResponse | null>(null);
  const [error, setError] = useState(false);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const CACHE_KEY = "chhath_dates_cache_v4";

    function applyData(json: ChhathDatesResponse) {
      const now = new Date();
      const refreshed: ChhathDatesResponse = {
        ...json,
        days: json.days.map((d) => ({ ...d, is_past: new Date(d.date_ist) <= now })),
      };
      setData(refreshed);
      const firstUpcoming = refreshed.days.findIndex((d) => !d.is_past);
      setActiveDayIndex(firstUpcoming >= 0 ? firstUpcoming : 0);
    }

    function cacheValid(json: ChhathDatesResponse): boolean {
      return json.days.some((d) => new Date(d.date_ist) > new Date());
    }

    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached: ChhathDatesResponse = JSON.parse(raw);
        if (cacheValid(cached)) applyData(cached);
        else localStorage.removeItem(CACHE_KEY);
      }
    } catch { /* localStorage unavailable */ }

    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    fetch(`${API_BASE}/api/chhath-dates`)
      .then((r) => { if (!r.ok) throw new Error(`API ${r.status}`); return r.json() as Promise<ChhathDatesResponse>; })
      .then((json) => {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(json)); } catch { /* ignore */ }
        applyData(json);
        setError(false);
      })
      .catch(() => { setData((prev) => { if (!prev) setError(true); return prev; }); });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Loading
  if (!data && !error) {
    return (
      <div className="min-w-[140px] text-center rounded-2xl px-3 py-2"
           style={{ background: "rgba(15,8,4,0.88)", boxShadow: NM_CARD }}>
        <p className="text-[11px] tracking-[0.1em] text-orange-500/55">Loading…</p>
      </div>
    );
  }

  // Error
  if (error || !data) {
    return (
      <div className="min-w-[140px] text-center rounded-2xl px-3 py-2"
           style={{ background: "rgba(15,8,4,0.88)", boxShadow: NM_CARD }}>
        <p className="text-[11px] text-orange-500/55">🪔 Unavailable</p>
      </div>
    );
  }

  const days = data.days;
  const selectedDay = days[activeDayIndex];
  if (!selectedDay) return null;

  const isPast = new Date(selectedDay.date_ist) <= new Date();
  const countdown = computeCountdown(selectedDay.date_ist);
  const isImminent = countdown.totalSeconds < 3600;
  const isToday = countdown.days === 0 && !isPast;

  return (
    <div
      className="flex flex-col items-center gap-2 text-center select-none w-[200px] rounded-2xl px-4 py-2.5"
      style={{ background: "rgba(15,8,4,0.88)", boxShadow: NM_CARD }}
    >
      {/* Header */}
      <p className="text-xs font-bold tracking-[0.15em] uppercase text-orange-500/85">
        Chhath {data.year}
      </p>

      {/* Day pill — click to cycle */}
      <button
        onClick={() => setActiveDayIndex((activeDayIndex + 1) % days.length)}
        title={`Click to see next day — ${days[(activeDayIndex + 1) % days.length]?.name}`}
        className="flex flex-col items-center gap-0.5 rounded-[18px] px-3.5 py-1.5 cursor-pointer
                   transition-all duration-200 w-full"
        style={{ background: "rgba(15,8,4,0.88)", boxShadow: NM_BTN }}
        onMouseDown={(e) => { e.currentTarget.style.boxShadow = NM_BTN_PRESSED; }}
        onMouseUp={(e) => { e.currentTarget.style.boxShadow = NM_BTN; }}
        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = NM_BTN; }}
        aria-label={`${selectedDay.name} — click to switch day`}
      >
        <div className="flex items-center gap-2 justify-center">
          <span className="text-xl leading-none shrink-0">{selectedDay.emoji}</span>
          <span className="font-semibold text-sm text-white whitespace-nowrap">{selectedDay.name}</span>
        </div>
        <span
          className="text-xs font-bold text-orange-400"
          style={{ fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif" }}
        >
          {selectedDay.name_hindi}
        </span>
        <span className="text-[11px] text-white/55">{selectedDay.time_label}</span>

        {/* Day indicator dots */}
        <div className="flex gap-1 mt-1">
          {days.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full inline-block transition-colors duration-200 ${
                i === activeDayIndex ? "bg-orange-500" : "bg-white/20"
              }`}
            />
          ))}
        </div>
      </button>

      {/* Countdown or Completed */}
      {isPast ? (
        <p className="text-xs font-semibold text-orange-600">✓ Completed</p>
      ) : (
        <div
          className={`flex items-center gap-1 font-mono ${isImminent ? "text-orange-400" : "text-white/90"}`}
          aria-live="off"
        >
          {countdown.days > 0 && (
            <>
              <div className="flex flex-col items-center">
                <span className="text-xl font-bold tabular-nums leading-none">{countdown.days}</span>
                <span className="text-[9px] uppercase tracking-wider mt-0.5 text-orange-500/55">din</span>
              </div>
              <span className="text-lg mb-3 text-orange-500/25">:</span>
            </>
          )}
          <div className="flex flex-col items-center">
            <span className="text-xl font-bold tabular-nums leading-none">{pad(countdown.hours)}</span>
            <span className="text-[9px] uppercase tracking-wider mt-0.5 text-orange-500/55">hr</span>
          </div>
          <span className="text-lg mb-3 text-orange-500/25">:</span>
          <div className="flex flex-col items-center">
            <span className="text-xl font-bold tabular-nums leading-none">{pad(countdown.minutes)}</span>
            <span className="text-[9px] uppercase tracking-wider mt-0.5 text-orange-500/55">min</span>
          </div>
          <span className="text-lg mb-3 text-orange-500/25">:</span>
          <div className="flex flex-col items-center">
            <span className={`text-xl font-bold tabular-nums leading-none${isImminent ? " animate-pulse" : ""}`}>
              {pad(countdown.seconds)}
            </span>
            <span className="text-[9px] uppercase tracking-wider mt-0.5 text-orange-500/55">sec</span>
          </div>
        </div>
      )}

      {isToday && (
        <p className="text-xs font-semibold animate-pulse text-orange-400">🪔 Aaj hai!</p>
      )}

      <span className="hidden">{tick}</span>
    </div>
  );
}