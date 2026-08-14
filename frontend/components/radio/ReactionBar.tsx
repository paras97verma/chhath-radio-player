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
  /** "right" (default) arcs up-right; "left" arcs up-left for right-edge placement */
  arcDirection?: "right" | "left";
}

export default function ReactionBar({ onReact, arcDirection = "right" }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const lastTap = useRef<Record<string, number>>({});
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setCounts(loadSessionReactions()); }, []);

  const handleMouseEnter = () => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setExpanded(true);
  };

  const handleMouseLeave = () => {
    // Instant collapse — no delay so hover-out feels responsive
    leaveTimer.current = setTimeout(() => setExpanded(false), 80);
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

  // Arc angles: "right" fans up-right (desktop, right of pill); "left" fans left (mobile, right edge)
  const arcAngles = arcDirection === "left"
    ? [135, 157, 180, 203, 225]   // left arc: 90° spread centered on pure-left (180°), radius 105px keeps buttons non-overlapping
    : [280, 300, 320, 340, 360];  // right arc: up-right quarter-circle
  const arcRadius = arcDirection === "left" ? 105 : 130;

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
        {/* Invisible hover extension — covers arc area in the direction of expansion */}
        {expanded && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              ...(arcDirection === "left"
                ? { right: "50%", left: "auto" }
                : { left: "50%", right: "auto" }),
              width: arcRadius + 60,
              height: arcRadius * 2 + 48,
              transform: "translateY(-50%)",
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
          // Expand: stagger outward (first button first)
          // Collapse: reverse stagger (last button first) for a smooth retract
          const expandDelay = i * 35;
          const collapseDelay = (REACTIONS.length - 1 - i) * 25;
          const delay = expanded ? expandDelay : collapseDelay;

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
                transition: expanded
                  ? `transform 0.38s cubic-bezier(0.34,1.4,0.64,1) ${delay}ms, opacity 0.25s ease ${delay}ms, box-shadow 0.2s ease`
                  : `transform 0.22s cubic-bezier(0.4,0,1,1) ${delay}ms, opacity 0.18s ease ${delay}ms, box-shadow 0.2s ease`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transition = `transform 0.18s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.18s ease`;
                e.currentTarget.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(1.28)`;
                e.currentTarget.style.boxShadow = NM_ARC_HOVER;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transition = `transform 0.2s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.2s ease`;
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