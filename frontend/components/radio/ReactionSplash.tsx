"use client";

/**
 * ReactionSplash — Full-screen emoji splash animation.
 *
 * Rendered at the root level (in PageClient) so it's truly full-screen
 * with position: fixed, unaffected by any parent overflow: hidden.
 *
 * Usage:
 *   <ReactionSplash emoji="🪔" onDone={() => setEmoji(null)} />
 */

import { useEffect, useRef, useState } from "react";

interface Particle {
  id: number;
  x: number;   // vw %
  y: number;   // vh %
  size: number; // px
  delay: number; // ms
  duration: number; // ms
  rotate: number; // deg
  vx: number;  // horizontal drift px
  vy: number;  // vertical drift px
}

interface Props {
  emoji: string | null;
  onDone: () => void;
}

let pid = 0;

function makeParticles(n: number): Particle[] {
  return Array.from({ length: n }, () => ({
    id: ++pid,
    x: 5 + Math.random() * 90,
    y: 5 + Math.random() * 90,
    size: 22 + Math.random() * 56,
    delay: Math.random() * 500,
    duration: 900 + Math.random() * 700,
    rotate: (Math.random() - 0.5) * 80,
    vx: (Math.random() - 0.5) * 60,
    vy: -(20 + Math.random() * 80),
  }));
}

export default function ReactionSplash({ emoji, onDone }: Props) {
  const [particles] = useState(() => makeParticles(28));
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!emoji) return;
    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(onDone, 1700);
    return () => { if (doneTimer.current) clearTimeout(doneTimer.current); };
  }, [emoji, onDone]);

  if (!emoji) return null;

  return (
    <>
      <style>{`
        @keyframes splashParticle {
          0%   { opacity: 0; transform: translate(0, 0) rotate(0deg) scale(0.4); }
          20%  { opacity: 1; }
          80%  { opacity: 0.7; }
          100% { opacity: 0;
                 transform: translate(var(--vx), var(--vy)) rotate(var(--rot)) scale(1.05); }
        }
        @keyframes splashCenter {
          0%   { transform: translate(-50%, -50%) scale(0); opacity: 0; }
          35%  { transform: translate(-50%, -50%) scale(1.5); opacity: 1; }
          65%  { transform: translate(-50%, -50%) scale(1.15); opacity: 0.95; }
          100% { transform: translate(-50%, -50%) scale(0.7); opacity: 0; }
        }
        @keyframes splashGlow {
          0%   { opacity: 0; }
          20%  { opacity: 1; }
          80%  { opacity: 0.6; }
          100% { opacity: 0; }
        }
      `}</style>

      {/* Full-screen fixed overlay */}
      <div
        aria-live="assertive"
        aria-label={`${emoji} reaction`}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 70,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        {/* Radial glow */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at center, rgba(249,115,22,0.15) 0%, transparent 65%)",
            animation: "splashGlow 1.7s ease-out forwards",
          }}
        />

        {/* Big center emoji */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            fontSize: 110,
            lineHeight: 1,
            animation: "splashCenter 1.5s cubic-bezier(0.34,1.56,0.64,1) forwards",
          }}
        >
          {emoji}
        </div>

        {/* Scattered particles */}
        {particles.map((p) => (
          <span
            key={p.id}
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${p.x}%`,
              top: `${p.y}%`,
              fontSize: p.size,
              lineHeight: 1,
              animation: `splashParticle ${p.duration}ms ease-out ${p.delay}ms both`,
              "--vx": `${p.vx}px`,
              "--vy": `${p.vy}px`,
              "--rot": `${p.rotate}deg`,
            } as React.CSSProperties}
          >
            {emoji}
          </span>
        ))}
      </div>
    </>
  );
}