"use client";

/**
 * ChhathCountdown — Fetches Chhath Puja dates exclusively from the backend API.
 * No local fallback calculation. Shows a loading state until the API responds.
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
  date_ist: string;   // ISO-8601 with IST offset, e.g. "2026-10-28T17:45:00+05:30"
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

// ─── Color palette (saffron/orange — no yellow tint) ─────────────────────────

const C = {
  accent:       "#f97316",               // orange-500
  accentBright: "#fb923c",               // orange-400
  accentMuted:  "rgba(249,115,22,0.85)",
  accentFaint:  "rgba(249,115,22,0.55)",
  accentGhost:  "rgba(249,115,22,0.25)",
  accentBorder: "rgba(249,115,22,0.35)",
  white:        "#ffffff",
  white85:      "rgba(255,255,255,0.9)",
  white35:      "rgba(255,255,255,0.55)",
  completed:    "#ea580c",               // orange-600
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChhathCountdown() {
  const [data, setData] = useState<ChhathDatesResponse | null>(null);
  const [error, setError] = useState(false);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [tick, setTick] = useState(0);

  // Fetch dates from backend API only — no local fallback.
  useEffect(() => {
    const CACHE_KEY = "chhath_dates_cache_v3";

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

    // Check localStorage cache first (only use API-sourced cache)
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached: ChhathDatesResponse = JSON.parse(raw);
        if (cacheValid(cached)) {
          applyData(cached);
          // Still re-fetch in background to keep fresh
        } else {
          localStorage.removeItem(CACHE_KEY);
        }
      }
    } catch { /* localStorage unavailable */ }

    // Always fetch from backend
    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    fetch(`${API_BASE}/api/chhath-dates`)
      .then((r) => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json() as Promise<ChhathDatesResponse>;
      })
      .then((json) => {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(json)); } catch { /* ignore */ }
        applyData(json);
        setError(false);
      })
      .catch(() => {
        // Only show error if we have no cached data at all
        setData((prev) => {
          if (!prev) setError(true);
          return prev;
        });
      });
  }, []);

  // Tick every second for countdown
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Loading state
  if (!data && !error) {
    return (
      <div style={{ minWidth: 140, textAlign: "center" }}>
        <p style={{ color: C.accentFaint, fontSize: "11px", letterSpacing: "0.1em" }}>
          Loading…
        </p>
      </div>
    );
  }

  // Error state (API unreachable, no cache)
  if (error || !data) {
    return (
      <div style={{ minWidth: 140, textAlign: "center" }}>
        <p style={{ color: C.accentFaint, fontSize: "11px" }}>
          🪔 Chhath dates unavailable
        </p>
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
      className="flex flex-col items-center gap-2 text-center select-none"
      style={{ minWidth: 160 }}
    >
      {/* Header */}
      <p
        className="text-xs font-bold tracking-widest uppercase"
        style={{ color: C.accentMuted, letterSpacing: "0.15em" }}
      >
        Chhath {data.year}
      </p>

      {/* Day name pill — click to cycle */}
      <button
        onClick={() => setActiveDayIndex((activeDayIndex + 1) % days.length)}
        title={`Click to see next day — ${days[(activeDayIndex + 1) % days.length]?.name}`}
        style={{
          background: C.accentGhost,
          border: `1px solid ${C.accentBorder}`,
          borderRadius: "18px",
          padding: "6px 14px",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "3px",
          transition: "all 0.2s ease",
        }}
        aria-label={`${selectedDay.name} — click to switch day`}
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: "20px", lineHeight: 1 }}>{selectedDay.emoji}</span>
          <span
            className="font-semibold text-sm"
            style={{ color: C.white }}
          >
            {selectedDay.name}
          </span>
        </div>
        <span
          className="text-xs"
          style={{
            color: C.accentBright,
            fontWeight: 700,
            fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif",
          }}
        >
          {selectedDay.name_hindi}
        </span>
        <span
          className="text-[11px]"
          style={{ color: C.white35 }}
        >
          {selectedDay.time_label}
        </span>
        {/* Day indicator dots */}
        <div className="flex gap-1 mt-1">
          {days.map((_, i) => (
            <span
              key={i}
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: i === activeDayIndex ? C.accent : "rgba(255,255,255,0.25)",
                display: "inline-block",
                transition: "background 0.2s",
              }}
            />
          ))}
        </div>
      </button>

      {/* Countdown or Completed */}
      {isPast ? (
        <p className="text-xs font-semibold" style={{ color: C.completed }}>
          ✓ Completed
        </p>
      ) : (
        <div
          className="flex items-center gap-1 font-mono"
          style={{ color: isImminent ? C.accentBright : C.white85 }}
          aria-live="off"
        >
          {countdown.days > 0 && (
            <>
              <div className="flex flex-col items-center">
                <span className="text-xl font-bold tabular-nums leading-none">
                  {countdown.days}
                </span>
                <span
                  className="text-[9px] uppercase tracking-wider mt-0.5"
                  style={{ color: C.accentFaint }}
                >
                  din
                </span>
              </div>
              <span className="text-lg mb-3" style={{ color: C.accentGhost }}>:</span>
            </>
          )}
          <div className="flex flex-col items-center">
            <span className="text-xl font-bold tabular-nums leading-none">
              {pad(countdown.hours)}
            </span>
            <span
              className="text-[9px] uppercase tracking-wider mt-0.5"
              style={{ color: C.accentFaint }}
            >
              hr
            </span>
          </div>
          <span className="text-lg mb-3" style={{ color: C.accentGhost }}>:</span>
          <div className="flex flex-col items-center">
            <span className="text-xl font-bold tabular-nums leading-none">
              {pad(countdown.minutes)}
            </span>
            <span
              className="text-[9px] uppercase tracking-wider mt-0.5"
              style={{ color: C.accentFaint }}
            >
              min
            </span>
          </div>
          <span className="text-lg mb-3" style={{ color: C.accentGhost }}>:</span>
          <div className="flex flex-col items-center">
            <span
              className={`text-xl font-bold tabular-nums leading-none${
                isImminent ? " animate-pulse" : ""
              }`}
            >
              {pad(countdown.seconds)}
            </span>
            <span
              className="text-[9px] uppercase tracking-wider mt-0.5"
              style={{ color: C.accentFaint }}
            >
              sec
            </span>
          </div>
        </div>
      )}

      {isToday && (
        <p
          className="text-xs font-semibold animate-pulse"
          style={{ color: C.accentBright }}
        >
          🪔 Aaj hai!
        </p>
      )}

      {/* suppress unused tick warning */}
      <span style={{ display: "none" }}>{tick}</span>
    </div>
  );
}