"use client";

/**
 * TuneInSplash — Full-screen branded splash shown on first page load.
 *
 * Covers the entire canvas with a near-opaque dark overlay.
 * Neumorphic card in the center with diya animation + Tune In button.
 *
 * On click: fades out (300ms) → calls onTuneIn() → unmounts.
 * The click registers as a browser user gesture, lifting autoplay restrictions.
 */

import { useState } from "react";

interface TuneInSplashProps {
  onTuneIn: () => void;
}

export default function TuneInSplash({ onTuneIn }: TuneInSplashProps) {
  const [fading, setFading] = useState(false);

  const handleClick = () => {
    if (fading) return;
    setFading(true);
  };

  const handleTransitionEnd = () => {
    if (fading) onTuneIn();
  };

  return (
    <div
      role="dialog"
      aria-label="Chhath Radio — click to start"
      aria-modal="true"
      onClick={handleClick}
      onTransitionEnd={handleTransitionEnd}
      className="fixed inset-0 z-[9999] flex items-center justify-center
                 cursor-pointer select-none transition-opacity duration-300"
      style={{
        background: "#050201",
        opacity: fading ? 0 : 1,
      }}
    >
      {/* Neumorphic center card */}
      <div
        className="flex flex-col items-center gap-6 sm:gap-8 px-8 sm:px-12 py-10 sm:py-12
                   rounded-3xl mx-4"
        style={{
          background: "rgba(15, 8, 4, 0.95)",
          boxShadow:
            "12px 12px 32px rgba(0,0,0,0.85), -6px -6px 20px rgba(60,30,10,0.30), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Diya icon — pulsing */}
        <div
          className="text-7xl sm:text-8xl leading-none"
          style={{ animation: "diyaPulse 2.5s ease-in-out infinite" }}
          aria-hidden="true"
        >
          🪔
        </div>

        {/* Title */}
        <div className="text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-wide"
              style={{ textShadow: "0 2px 16px rgba(249,115,22,0.35)" }}>
            Chhath Radio
          </h1>
          <p
            className="text-base sm:text-lg text-orange-500/80 mt-2 font-semibold tracking-wide"
            style={{ fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif" }}
          >
            छठ के गीत, बिना रुके
          </p>
        </div>

        {/* Tune In button — neumorphic raised */}
        <button
          autoFocus
          onClick={(e) => {
            e.stopPropagation();
            handleClick();
          }}
          aria-label="Start Chhath Radio"
          className="flex items-center gap-2.5 px-8 sm:px-10 py-3 sm:py-3.5 rounded-full
                     text-white text-lg sm:text-xl font-bold tracking-wide
                     active:scale-95 transition-all duration-150 border-none cursor-pointer"
          style={{
            background: "linear-gradient(135deg, #fb923c, #ea580c)",
            boxShadow:
              "5px 5px 16px rgba(0,0,0,0.65), -3px -3px 10px rgba(60,30,10,0.28), 0 0 24px rgba(249,115,22,0.35), inset 0 1px 0 rgba(255,255,255,0.15)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow =
              "6px 6px 20px rgba(0,0,0,0.70), -3px -3px 12px rgba(60,30,10,0.30), 0 0 36px rgba(249,115,22,0.50), inset 0 1px 0 rgba(255,255,255,0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow =
              "5px 5px 16px rgba(0,0,0,0.65), -3px -3px 10px rgba(60,30,10,0.28), 0 0 24px rgba(249,115,22,0.35), inset 0 1px 0 rgba(255,255,255,0.15)";
          }}
        >
          <span aria-hidden="true">🎵</span>
          Tune In
        </button>
      </div>
    </div>
  );
}