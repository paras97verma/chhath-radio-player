"use client";

/**
 * DedicationTicker — Shows live song dedications in a scrolling ticker.
 *
 * Receives dedications via the `dedications` prop (managed by parent).
 * Cycles through them every 6 seconds with a fade transition.
 * Shows the most recent dedication first.
 */

import { useState, useEffect, useRef } from "react";
import type { Dedication } from "./DedicationForm";

interface Props {
  dedications: Dedication[];
}

export default function DedicationTicker({ dedications }: Props) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (dedications.length === 0) return;
    // Reset to newest when new dedication arrives
    setIdx(0);
    setVisible(true);
  }, [dedications.length]);

  useEffect(() => {
    if (dedications.length <= 1) return;

    const cycle = () => {
      // Fade out
      setVisible(false);
      timerRef.current = setTimeout(() => {
        setIdx((prev) => (prev + 1) % dedications.length);
        setVisible(true);
      }, 500);
    };

    const interval = setInterval(cycle, 6000);
    return () => {
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dedications.length]);

  if (dedications.length === 0) return null;

  const d = dedications[idx];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.45s ease",
        pointerEvents: "none",
      }}
      aria-live="polite"
      aria-label="Song dedication"
    >
      <span style={{ fontSize: "0.82rem", flexShrink: 0, lineHeight: 1.55 }} aria-hidden="true">
        🪔
      </span>
      <span
        style={{
          fontSize: "0.8rem",
          fontWeight: 700,
          letterSpacing: "0.01em",
          lineHeight: 1.55,
          whiteSpace: "normal",
          wordBreak: "break-word",
          background: "linear-gradient(90deg, #fb923c 0%, #fde68a 50%, #fb923c 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          textShadow: "none",
          filter: "drop-shadow(0 0 8px rgba(251,146,60,0.5))",
          textAlign: "center",
        }}
      >
        Dedicated to <strong>{d.to}</strong>
        {d.message ? ` — "${d.message}"` : ""}
        {" "}
        <span style={{ opacity: 0.6, fontWeight: 400 }}>
          · {d.songTitle.length > 30 ? d.songTitle.slice(0, 30) + "…" : d.songTitle}
        </span>
      </span>
    </div>
  );
}