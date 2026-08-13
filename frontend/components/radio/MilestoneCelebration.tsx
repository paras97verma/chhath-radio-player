"use client";

/**
 * MilestoneCelebration — Shows a brief full-screen celebration when
 * the live listener count hits a round-number milestone (10, 25, 50, 100, 500…).
 *
 * Usage: <MilestoneCelebration count={listenerCount} />
 *
 * - Auto-dismisses after 3.5 seconds
 * - Stores last celebrated milestone in sessionStorage to avoid re-triggering
 * - Floating 🪔 emojis + toast message
 */

import { useEffect, useState, useRef } from "react";

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const SESSION_KEY = "chhath_last_milestone_v1";
const DISPLAY_MS = 3500;

interface Props {
  count: number;
}

interface Particle {
  id: number;
  emoji: string;
  x: number;   // vw %
  delay: number; // ms
  duration: number; // ms
  size: number; // px
}

const PARTY_EMOJIS = ["🪔", "🙏", "🌅", "☀️", "🌸", "🌊", "🪷"];

function makeParticles(n: number): Particle[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    emoji: PARTY_EMOJIS[i % PARTY_EMOJIS.length],
    x: 5 + Math.random() * 90,
    delay: Math.random() * 600,
    duration: 1800 + Math.random() * 1200,
    size: 18 + Math.random() * 18,
  }));
}

export default function MilestoneCelebration({ count }: Props) {
  const [milestone, setMilestone] = useState<number | null>(null);
  const [particles] = useState(() => makeParticles(18));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (count <= 0) return;

    // Find the highest milestone that count has just crossed
    const crossed = MILESTONES.filter((m) => count >= m).pop();
    if (!crossed) return;

    // Check if we already celebrated this milestone this session
    try {
      const last = Number(sessionStorage.getItem(SESSION_KEY) ?? "0");
      if (crossed <= last) return;
    } catch { /* ignore */ }

    // Celebrate!
    setMilestone(crossed);
    try { sessionStorage.setItem(SESSION_KEY, String(crossed)); } catch { /* ignore */ }

    // Auto-dismiss
    timerRef.current = setTimeout(() => setMilestone(null), DISPLAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [count]);

  if (!milestone) return null;

  return (
    <>
      <style>{`
        @keyframes milestoneParticle {
          0%   { transform: translateY(100vh) scale(0.5); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 0.8; }
          100% { transform: translateY(-20vh) scale(1.1); opacity: 0; }
        }
        @keyframes milestoneToastIn {
          0%   { transform: translate(-50%, 40px) scale(0.85); opacity: 0; }
          60%  { transform: translate(-50%, -6px) scale(1.04); opacity: 1; }
          100% { transform: translate(-50%, 0)    scale(1);    opacity: 1; }
        }
        @keyframes milestoneToastOut {
          0%   { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -20px) scale(0.9); }
        }
      `}</style>

      {/* Full-screen overlay — pointer-events none so it doesn't block UI */}
      <div
        aria-live="assertive"
        aria-label={`${milestone} people listening together!`}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 60,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        {/* Floating particles */}
        {particles.map((p) => (
          <span
            key={p.id}
            aria-hidden="true"
            style={{
              position: "absolute",
              bottom: 0,
              left: `${p.x}%`,
              fontSize: p.size,
              lineHeight: 1,
              animation: `milestoneParticle ${p.duration}ms ease-out ${p.delay}ms both`,
              pointerEvents: "none",
            }}
          >
            {p.emoji}
          </span>
        ))}

        {/* Toast message */}
        <div
          style={{
            position: "absolute",
            bottom: "30%",
            left: "50%",
            transform: "translate(-50%, 0)",
            background: "rgba(10,4,2,0.97)",
            border: "1px solid rgba(249,115,22,0.45)",
            borderRadius: 20,
            padding: "16px 28px",
            textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(249,115,22,0.1)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            animation: `milestoneToastIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both,
                        milestoneToastOut 0.4s ease-in ${DISPLAY_MS - 400}ms both`,
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 6 }}>🪔</div>
          <p
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#fff",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {milestone.toLocaleString()} listening together!
          </p>
          <p
            style={{
              fontSize: 13,
              color: "rgba(249,115,22,0.75)",
              margin: "6px 0 0",
              fontWeight: 600,
            }}
          >
            Jai Chhathi Maiya 🙏
          </p>
        </div>
      </div>
    </>
  );
}