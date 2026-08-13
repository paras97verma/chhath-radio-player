"use client";

/**
 * ReactionBar — Left-center FAB with radial "pistol barrel" emoji picker.
 *
 * UX:
 * - Single 🪔 FAB, fixed left-center
 * - On hover: 5 emoji buttons arc out in a semicircle to the RIGHT (pistol barrel)
 * - On click: calls onReact(emoji) so parent can render full-screen splash
 * - Reaction counts stored in localStorage per day
 */

import { useState, useCallback, useRef, useEffect } from "react";

const REACTIONS = [
  { emoji: "🪔", label: "Diya" },
  { emoji: "🙏", label: "Pranam" },
  { emoji: "🌸", label: "Pushp" },
  { emoji: "🍃", label: "Arghya" },
  { emoji: "☀️", label: "Surya" },
];

const STORAGE_KEY = "chhath_reactions_v2";
const THROTTLE_MS = 800;

interface DayReactions {
  date: string;
  counts: Record<string, number>;
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadTodayReactions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data: DayReactions = JSON.parse(raw);
    if (data.date !== getTodayKey()) return {};
    return data.counts;
  } catch { return {}; }
}

function saveTodayReactions(counts: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: getTodayKey(), counts }));
  } catch { /* ignore */ }
}

interface Props {
  /** Called when user taps an emoji — parent renders the full-screen splash */
  onReact?: (emoji: string) => void;
}

export default function ReactionBar({ onReact }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const lastTap = useRef<Record<string, number>>({});
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCounts(loadTodayReactions());
  }, []);

  const handleMouseEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setExpanded(true);
  };

  const handleMouseLeave = () => {
    leaveTimer.current = setTimeout(() => setExpanded(false), 250);
  };

  const handleReaction = useCallback((emoji: string) => {
    const now = Date.now();
    if (now - (lastTap.current[emoji] ?? 0) < THROTTLE_MS) return;
    lastTap.current[emoji] = now;

    setCounts((prev) => {
      const next = { ...prev, [emoji]: (prev[emoji] ?? 0) + 1 };
      saveTodayReactions(next);
      return next;
    });

    setExpanded(false);
    onReact?.(emoji);
  }, [onReact]);

  const totalReactions = Object.values(counts).reduce((a, b) => a + b, 0);

  // Radial arc: 5 emojis spread from -80° to +80° (right-facing semicircle)
  // 0° = right (horizontal), negative = up, positive = down
  // Equal angular spacing of 40° ensures equidistant arc chord lengths
  const arcAngles = [-80, -40, 0, 40, 80]; // degrees from horizontal right
  const arcRadius = 82; // px from FAB center to emoji center

  return (
    <>
      <style>{`
        @keyframes reactionFabPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.5), 0 4px 20px rgba(0,0,0,0.5); }
          50%       { box-shadow: 0 0 0 10px rgba(249,115,22,0), 0 4px 20px rgba(0,0,0,0.5); }
        }
        @keyframes reactionArcIn {
          0%   { transform: translate(var(--tx0), var(--ty0)) scale(0.3); opacity: 0; }
          65%  { transform: translate(var(--tx), var(--ty)) scale(1.15); opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) scale(1); opacity: 1; }
        }
        @keyframes reactionArcOut {
          0%   { transform: translate(var(--tx), var(--ty)) scale(1); opacity: 1; }
          100% { transform: translate(var(--tx0), var(--ty0)) scale(0.3); opacity: 0; }
        }
      `}</style>

      {/* Hover zone — FAB + invisible arc area */}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          position: "relative",
          width: 48,
          height: 48,
          // Extend hover area to cover the arc radius
          padding: 0,
        }}
      >
        {/* Invisible hover extension to the right */}
        {expanded && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: arcRadius + 48,
              height: arcRadius * 2 + 48,
              transform: "translate(-24px, -50%)",
              pointerEvents: "auto",
              zIndex: 0,
            }}
          />
        )}

        {/* Main FAB */}
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Close reactions" : "Send a reaction"}
          aria-expanded={expanded}
          title={totalReactions > 0
            ? `${totalReactions.toLocaleString()} reactions today`
            : "Send a reaction 🪔"}
          style={{
            position: "relative",
            zIndex: 2,
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: expanded
              ? "linear-gradient(135deg, #fb923c, #ea580c)"
              : "rgba(10,4,2,0.88)",
            border: `1.5px solid ${expanded ? "rgba(249,115,22,0.7)" : "rgba(249,115,22,0.4)"}`,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: expanded
              ? "0 0 24px rgba(249,115,22,0.45), 0 4px 20px rgba(0,0,0,0.5)"
              : "0 4px 20px rgba(0,0,0,0.5)",
            animation: !expanded ? "reactionFabPulse 3s ease-in-out infinite" : "none",
            transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s",
          }}
        >
          🪔
          {/* Count badge */}
          {totalReactions > 0 && !expanded && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                background: "#f97316",
                color: "#fff",
                fontSize: 9,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 4px",
                lineHeight: 1,
                border: "1.5px solid rgba(10,4,2,0.9)",
              }}
            >
              {totalReactions > 99 ? "99+" : totalReactions}
            </span>
          )}
        </button>

        {/* Radial arc emoji buttons */}
        {REACTIONS.map(({ emoji, label }, i) => {
          const angleDeg = arcAngles[i];
          const angleRad = (angleDeg * Math.PI) / 180;
          const tx = Math.cos(angleRad) * arcRadius;
          const ty = Math.sin(angleRad) * arcRadius;
          const delay = i * 40;

          return (
            <button
              key={emoji}
              onClick={() => handleReaction(emoji)}
              aria-label={`React with ${label}`}
              title={`${label}${counts[emoji] ? ` · ${counts[emoji]}` : ""}`}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "rgba(10,4,2,0.92)",
                border: "1.5px solid rgba(249,115,22,0.35)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
                zIndex: 3,
                // CSS custom properties for animation
                "--tx": `calc(-50% + ${tx}px)`,
                "--ty": `calc(-50% + ${ty}px)`,
                "--tx0": "-50%",
                "--ty0": "-50%",
                transform: expanded
                  ? `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(1)`
                  : "translate(-50%, -50%) scale(0.3)",
                opacity: expanded ? 1 : 0,
                pointerEvents: expanded ? "auto" : "none",
                transition: `transform 0.28s cubic-bezier(0.34,1.56,0.64,1) ${delay}ms, opacity 0.2s ease ${delay}ms`,
              } as React.CSSProperties}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(1.25)`;
                e.currentTarget.style.background = "rgba(249,115,22,0.22)";
                e.currentTarget.style.borderColor = "rgba(249,115,22,0.65)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(1)`;
                e.currentTarget.style.background = "rgba(10,4,2,0.92)";
                e.currentTarget.style.borderColor = "rgba(249,115,22,0.35)";
              }}
            >
              {emoji}
              {/* Per-emoji count */}
              {(counts[emoji] ?? 0) > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: -3,
                    right: -3,
                    minWidth: 14,
                    height: 14,
                    borderRadius: 7,
                    background: "rgba(249,115,22,0.9)",
                    color: "#fff",
                    fontSize: 8,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px",
                    lineHeight: 1,
                  }}
                >
                  {counts[emoji] > 99 ? "99+" : counts[emoji]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}