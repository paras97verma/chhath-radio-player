"use client";

/**
 * LiveClock — Displays current local time and date.
 * - Toggles 12h/24h on click
 * - Updates every second via requestAnimationFrame
 * - Neumorphic card design
 * - Renders nothing on server (avoids SSR hydration mismatch)
 */

import { useEffect, useState } from "react";

const DATE_LOCALE = "en-IN";

// ─── Exported helpers (used in tests) ────────────────────────────────────────

export function formatTime(d: Date, hour12: boolean): string {
  const raw = d.toLocaleTimeString(DATE_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12,
  });
  return hour12 ? raw.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase()) : raw;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString(DATE_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

const NM_CARD = "8px 8px 24px rgba(0,0,0,0.85), -4px -4px 12px rgba(90,40,15,0.22), inset 0 1px 0 rgba(254,215,170,0.12)";

export default function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  const [hour12, setHour12] = useState(false);

  useEffect(() => {
    setNow(new Date());
    let rafId: number;
    let lastSec = -1;

    function tick() {
      const d = new Date();
      const sec = d.getSeconds();
      if (sec !== lastSec) { lastSec = sec; setNow(new Date(d)); }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  if (!now) return null;

  const timeStr = formatTime(now, hour12);
  const dateStr = formatDate(now);
  const modeLabel = hour12 ? "12h" : "24h";
  const nextModeLabel = hour12 ? "24h" : "12h";

  return (
    <div
      data-testid="live-clock"
      className="text-center tabular-nums select-none rounded-xl px-3 py-1.5 sm:px-4 sm:py-2 border"
      style={{
        background: "rgba(14,7,4,0.82)",
        borderColor: "rgba(251,146,60,0.16)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.60), inset 0 1px 0 rgba(255,255,255,0.08)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
      aria-live="off"
      aria-label={`Current time: ${timeStr}, date: ${dateStr}`}
    >
      {/* Time — click to toggle 12/24h */}
      <button
        data-testid="clock-time"
        onClick={() => setHour12((v) => !v)}
        title={`Switch to ${nextModeLabel} format`}
        aria-label={`Time: ${timeStr}. Click to switch to ${nextModeLabel} format`}
        className="clock-time-3d text-xl sm:text-2xl font-mono cursor-pointer bg-transparent border-none p-0 transition-[filter]"
      >
        {timeStr}
      </button>

      {/* Format badge */}
      <span
        data-testid="clock-format-badge"
        className="ml-2 text-xs font-mono align-middle text-white/45"
        aria-hidden="true"
      >
        {modeLabel}
      </span>

      {/* Date */}
      <p data-testid="clock-date" className="clock-date-3d text-xs font-mono mt-0.5">
        {dateStr}
      </p>
    </div>
  );
}