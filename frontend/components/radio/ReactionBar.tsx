"use client";

/**
 * ReactionBar — Neumorphic FAB with radial emoji picker.
 *
 * - Single 🪔 FAB (neumorphic raised)
 * - On hover: 5 emoji buttons arc out upward (JS trig — inline styles required)
 * - On click: calls onReact(emoji) → parent renders full-screen splash
 * - Reaction counts stored in sessionStorage (resets on tab/browser close)
 */

import { useState, useCallback, useRef, useEffect } from "react";

const REACTIONS = [
  { emoji: "🪔", label: "Diya" },
  { emoji: "🙏", label: "Pranam" },
  { emoji: "🌸", label: "Pushp" },
  { emoji: "🍃", label: "Arghya" },
  { emoji: "☀️", label: "Surya" },
];

const STORAGE_KEY = "chhath_reactions_session_v1";
const THROTTLE_MS = 800;

const NM_FAB = "5px 5px 14px rgba(0,0,0,0.70), -3px -3px 8px rgba(60,30,10,0.28)";
const NM_FAB_ACTIVE = "inset 3px 3px 8px rgba(0,0,0,0.60), inset -1px -1px 4px rgba(60,30,10,0.20)";
const NM_ARC_BTN = "4px 4px 10px rgba(0,0,0,0.65), -2px -2px 6px rgba(60,30,10,0.25)";
const NM_ARC_HOVER = "5px 5px 14px rgba(0,0,0,0.70), -3px -3px 8px rgba(60,30,10,0.28), 0 0 12px rgba(249,115,22,0.35)";

function loadSessionReactions(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch { return {}; }
}

function saveSessionReactions(counts: Record<string, number>) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(counts)); } catch { /* ignore */ }
}

interface Props {
  onReact?: (emoji: string) => void;
}

export default function ReactionBar({ onReact }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const lastTap = useRef<Record<string, number>>({});
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setCounts(loadSessionReactions()); }, []);

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
      saveSessionReactions(next);
      return next;
    });
    setExpanded(false);
    onReact?.(emoji);
  }, [onReact]);

  const totalReactions = Object.values(counts).reduce((a, b) => a + b, 0);

  // Arc: 5 emojis fan UP and to the RIGHT (away from player pill on the left)
  // Standard math: 270°=up, 360°=right. Range 250°–350° fans upper-right.
  const arcAngles = [250, 275, 300, 325, 350];
  const arcRadius = 110;

  return (
    <>
      <style>{`
        @keyframes nmFabPulse {
          0%, 100% { box-shadow: ${NM_FAB}, 0 0 0 0 rgba(249,115,22,0.5); }
          50%       { box-shadow: ${NM_FAB}, 0 0 0 10px rgba(249,115,22,0); }
        }
      `}</style>

      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="relative w-12 h-12"
      >
        {/* Invisible hover extension upward (covers arc area) */}
        {expanded && (
          <div
            style={{
              position: "absolute",
              bottom: "50%",
              left: "50%",
              width: arcRadius * 2 + 48,
              height: arcRadius + 48,
              transform: "translate(-50%, 24px)",
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
          title={totalReactions > 0 ? `${totalReactions.toLocaleString()} reactions today` : "Send a reaction 🪔"}
          className="relative z-[2] w-12 h-12 rounded-full flex items-center justify-center
                     text-[22px] cursor-pointer border-none transition-all duration-200"
          style={{
            background: expanded
              ? "linear-gradient(135deg, #fb923c, #ea580c)"
              : "rgba(15,8,4,0.92)",
            boxShadow: expanded
              ? `${NM_FAB_ACTIVE}, 0 0 20px rgba(249,115,22,0.5)`
              : NM_FAB,
            animation: !expanded ? "nmFabPulse 3s ease-in-out infinite" : "none",
          }}
        >
          🪔
          {/* Count badge */}
          {totalReactions > 0 && !expanded && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full
                         bg-orange-500 text-white text-[9px] font-bold
                         flex items-center justify-center px-1 leading-none"
              style={{ boxShadow: "2px 2px 6px rgba(0,0,0,0.6)" }}
            >
              {totalReactions > 99 ? "99+" : totalReactions}
            </span>
          )}
        </button>

        {/* Radial arc emoji buttons — JS trig positions (inline styles required) */}
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
              className="absolute top-1/2 left-1/2 w-10 h-10 rounded-full
                         flex items-center justify-center text-[18px]
                         cursor-pointer border-none z-[3]"
              style={{
                background: "rgba(15,8,4,0.92)",
                boxShadow: NM_ARC_BTN,
                transform: expanded
                  ? `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(1)`
                  : "translate(-50%, -50%) scale(0.3)",
                opacity: expanded ? 1 : 0,
                pointerEvents: expanded ? "auto" : "none",
                transition: `transform 0.28s cubic-bezier(0.34,1.56,0.64,1) ${delay}ms, opacity 0.2s ease ${delay}ms`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(1.25)`;
                e.currentTarget.style.boxShadow = NM_ARC_HOVER;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(1)`;
                e.currentTarget.style.boxShadow = NM_ARC_BTN;
              }}
            >
              {emoji}
              {/* Per-emoji count badge */}
              {(counts[emoji] ?? 0) > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 rounded-full
                             bg-orange-500/90 text-white text-[8px] font-bold
                             flex items-center justify-center px-0.5 leading-none"
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