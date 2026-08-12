"use client";

import { useEffect, useState } from "react";

/**
 * LiveClock
 *
 * Displays the current local time and date synced to the user's device timezone.
 * - Time format toggles between 24-hour and 12-hour (AM/PM) on click.
 * - Updates every second via requestAnimationFrame for accuracy.
 * - Renders nothing on the server to avoid SSR hydration mismatch.
 */

const DATE_LOCALE = "en-IN"; // BCP-47 tag; change if needed

// ─── Exported helpers (also used in tests) ───────────────────────────────────

export function formatTime(d: Date, hour12: boolean): string {
  const raw = d.toLocaleTimeString(DATE_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12,
  });
  // Normalise AM/PM to uppercase (some locales render "am"/"pm" in lowercase)
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

export default function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  const [hour12, setHour12] = useState(false); // default: 24-hour

  useEffect(() => {
    setNow(new Date());

    let rafId: number;
    let lastSec = -1;

    function tick() {
      const d = new Date();
      const sec = d.getSeconds();
      if (sec !== lastSec) {
        lastSec = sec;
        setNow(new Date(d));
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Render nothing on the server / before hydration
  if (!now) return null;

  const timeStr = formatTime(now, hour12);
  const dateStr = formatDate(now);
  const modeLabel = hour12 ? "12h" : "24h";
  const nextModeLabel = hour12 ? "24h" : "12h";

  return (
    <>
      <style>{`
        .clock-time-3d {
          background: linear-gradient(180deg, #fb923c 0%, #f97316 45%, #ea580c 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          filter: drop-shadow(0 1px 0 rgba(120,40,0,0.6)) drop-shadow(0 2px 6px rgba(0,0,0,0.4));
          font-weight: 700;
          letter-spacing: 0.12em;
        }
        .clock-time-3d:hover {
          filter: drop-shadow(0 1px 0 rgba(120,40,0,0.6)) drop-shadow(0 3px 8px rgba(249,115,22,0.35));
        }
        .clock-date-3d {
          background: linear-gradient(180deg, #fb923c 0%, #f97316 55%, #ea580c 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          filter: drop-shadow(0 1px 0 rgba(120,40,0,0.45));
          opacity: 0.65;
          font-weight: 600;
          letter-spacing: 0.06em;
        }
      `}</style>
      <div
        data-testid="live-clock"
        className="text-center tabular-nums select-none"
        aria-live="off"
        aria-label={`Current time: ${timeStr}, date: ${dateStr}`}
      >
        {/* Time — click to toggle 12/24h */}
        <button
          data-testid="clock-time"
          onClick={() => setHour12((v) => !v)}
          title={`Switch to ${nextModeLabel} format`}
          aria-label={`Time: ${timeStr}. Click to switch to ${nextModeLabel} format`}
          className="clock-time-3d text-2xl font-mono cursor-pointer bg-transparent border-none p-0 transition-[filter]"
        >
          {timeStr}
        </button>

        {/* Format badge */}
        <span
          data-testid="clock-format-badge"
          className="ml-2 text-orange-200/30 text-xs font-mono align-middle"
          aria-hidden="true"
        >
          {modeLabel}
        </span>

        {/* Date */}
        <p
          data-testid="clock-date"
          className="clock-date-3d text-xs font-mono mt-0.5"
        >
          {dateStr}
        </p>
      </div>
    </>
  );
}