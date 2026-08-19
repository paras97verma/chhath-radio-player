"use client";

/**
 * ReactionSplash — Balanced full-screen emoji splash animation.
 *
 * Evenly distributes floating reaction particles across 6 screen zones
 * (left, mid-left, center, mid-right, right) so both left and right sides
 * are equally rich and visually balanced on all screen sizes.
 */

import { useEffect, useRef, useState } from "react";

interface Particle {
  id: number;
  x: number;       // vw % (5% to 95%)
  y: number;       // vh % (8% to 88%)
  size: number;    // px
  delay: number;   // ms
  duration: number;// ms
  rotate: number;  // deg
  vx: number;      // horizontal drift px
  vy: number;      // vertical drift px
  displayEmoji: string; // primary emoji or golden sparkle accent
}

interface Props {
  emoji: string | null;
  onDone: () => void;
}

let pid = 0;

/**
 * Generates particles uniformly distributed across 6 horizontal zones
 * to guarantee that left, center, and right sides of the screen are
 * equally filled with floating elements.
 */
function generateBalancedParticles(mainEmoji: string, totalParticles = 36): Particle[] {
  const ZONES = 6;
  const perZone = Math.floor(totalParticles / ZONES);
  const particles: Particle[] = [];

  for (let z = 0; z < ZONES; z++) {
    const zoneMinX = 5 + (z * 90) / ZONES;
    const zoneMaxX = 5 + ((z + 1) * 90) / ZONES;

    for (let i = 0; i < perZone; i++) {
      // Mix main emoji with occasional golden sparkles/diyas (1 in 5)
      const isAccent = (z + i) % 5 === 0;
      const displayEmoji = isAccent ? (i % 2 === 0 ? "🪔" : "✨") : mainEmoji;

      // Uniform vertical distribution with random jitter
      const yNorm = (i + Math.random() * 0.8) / perZone;
      const y = 10 + yNorm * 76; // 10% to 86% vh

      // Natural upward & outward drift
      const vx = (Math.random() - 0.5) * 80;
      const vy = -(35 + Math.random() * 85);

      particles.push({
        id: ++pid,
        x: zoneMinX + Math.random() * (zoneMaxX - zoneMinX),
        y,
        size: 26 + Math.random() * 48,
        delay: Math.random() * 450,
        duration: 1050 + Math.random() * 650,
        rotate: (Math.random() - 0.5) * 90,
        vx,
        vy,
        displayEmoji,
      });
    }
  }

  return particles;
}

export default function ReactionSplash({ emoji, onDone }: Props) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!emoji) return;
    // Generate a fresh, perfectly zone-balanced set of particles on every click
    setParticles(generateBalancedParticles(emoji, 36));

    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(onDone, 1800);
    return () => { if (doneTimer.current) clearTimeout(doneTimer.current); };
  }, [emoji, onDone]);

  if (!emoji) return null;

  return (
    <>
      <style>{`
        @keyframes splashParticle {
          0%   { opacity: 0; transform: translate(0, 0) rotate(0deg) scale(0.35); }
          20%  { opacity: 1; }
          75%  { opacity: 0.85; }
          100% { opacity: 0;
                 transform: translate(var(--vx), var(--vy)) rotate(var(--rot)) scale(1.1); }
        }
        @keyframes splashCenter {
          0%   { transform: translate(-50%, -50%) scale(0); opacity: 0; }
          30%  { transform: translate(-50%, -50%) scale(1.45); opacity: 1; }
          65%  { transform: translate(-50%, -50%) scale(1.15); opacity: 0.95; }
          100% { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
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
        {/* Radial ambient glow */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at center, rgba(249,115,22,0.18) 0%, transparent 70%)",
            animation: "splashGlow 1.8s ease-out forwards",
          }}
        />

        {/* Hero center emoji */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            fontSize: 110,
            lineHeight: 1,
            animation: "splashCenter 1.6s cubic-bezier(0.34,1.56,0.64,1) forwards",
            filter: "drop-shadow(0 0 32px rgba(249,115,22,0.6))",
          }}
        >
          {emoji}
        </div>

        {/* Zone-balanced scattered floating particles */}
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
              filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.5))",
            } as React.CSSProperties}
          >
            {p.displayEmoji}
          </span>
        ))}
      </div>
    </>
  );
}