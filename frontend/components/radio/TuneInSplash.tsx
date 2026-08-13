"use client";

/**
 * TuneInSplash — Full-screen branded splash shown on first page load.
 *
 * The user must click "Tune In" to start the radio. This click registers
 * as a browser user gesture, which lifts autoplay restrictions so the
 * YouTube player can start with full unmuted audio immediately.
 *
 * On click: fades out (300ms CSS transition) → calls onTuneIn() → unmounts.
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
    // onTuneIn is called after the fade-out transition completes
  };

  const handleTransitionEnd = () => {
    if (fading) {
      onTuneIn();
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Chhath Radio — click to start"
      aria-modal="true"
      onClick={handleClick}
      onTransitionEnd={handleTransitionEnd}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2rem",
        background: "rgba(8, 2, 2, 0.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        opacity: fading ? 0 : 1,
        transition: "opacity 300ms ease-out",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {/* Diya icon */}
      <div
        style={{
          fontSize: "5rem",
          lineHeight: 1,
          filter: "drop-shadow(0 0 32px rgba(249,115,22,0.7))",
          animation: "diyaPulse 2.5s ease-in-out infinite",
        }}
        aria-hidden="true"
      >
        🪔
      </div>

      {/* Title */}
      <div style={{ textAlign: "center" }}>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: "0.04em",
            margin: 0,
            textShadow: "0 2px 16px rgba(249,115,22,0.4)",
          }}
        >
          Chhath Radio
        </h1>
        <p
          style={{
            fontSize: "1rem",
            color: "rgba(249,115,22,0.75)",
            margin: "0.4rem 0 0",
            fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif",
            fontWeight: 600,
            letterSpacing: "0.03em",
          }}
        >
          छठ के गीत, बिना रुके
        </p>
      </div>

      {/* Tune In button */}
      <button
        autoFocus
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
        aria-label="Start Chhath Radio"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          padding: "0.85rem 2.4rem",
          borderRadius: "100px",
          border: "none",
          background: "linear-gradient(135deg, #fb923c, #ea580c)",
          color: "#fff",
          fontSize: "1.1rem",
          fontWeight: 700,
          letterSpacing: "0.04em",
          cursor: "pointer",
          boxShadow: "0 0 32px rgba(249,115,22,0.5), 0 4px 16px rgba(0,0,0,0.4)",
          transition: "transform 120ms ease, box-shadow 120ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.05)";
          e.currentTarget.style.boxShadow =
            "0 0 48px rgba(249,115,22,0.7), 0 6px 20px rgba(0,0,0,0.5)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow =
            "0 0 32px rgba(249,115,22,0.5), 0 4px 16px rgba(0,0,0,0.4)";
        }}
      >
        <span aria-hidden="true">🎵</span>
        Tune In
      </button>

      {/* Subtle hint */}
      <p
        style={{
          fontSize: "0.75rem",
          color: "rgba(255,255,255,0.25)",
          margin: 0,
          letterSpacing: "0.05em",
        }}
      >
        Click anywhere to start
      </p>

      {/* Keyframe for diya pulse */}
      <style>{`
        @keyframes diyaPulse {
          0%, 100% { transform: scale(1);    filter: drop-shadow(0 0 24px rgba(249,115,22,0.6)); }
          50%       { transform: scale(1.08); filter: drop-shadow(0 0 48px rgba(249,115,22,0.9)); }
        }
      `}</style>
    </div>
  );
}