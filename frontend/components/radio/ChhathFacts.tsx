"use client";

/**
 * ChhathFacts — Rotates Chhath Puja facts with:
 *   - Instant display on load (built-in fallback facts, no API wait)
 *   - Typewriter animation on entry (18ms/char)
 *   - Fact shown for 10 seconds total, then instant swap
 *   - Single-line display — long facts scroll via marquee
 *   - Fully transparent background — gradient text with glow only
 *   - Rotating Chhath-themed emoji per fact
 */

import { useEffect, useState, useRef } from "react";
import { fetchFacts } from "@/lib/api";

const CHAR_SPEED_MS = 18;
const HOLD_TOTAL_MS = 10_000;

// Chhath-themed emojis that rotate with each fact
const CHHATH_EMOJIS = [
  "🪔", "🌅", "🌊", "🙏", "🌸", "☀️", "🌙", "🪷", "🌺", "🎋",
  "🌾", "🍚", "🥭", "🍌", "🌿", "🔔", "🪘", "🌄", "🕯️", "🌻",
];

// Built-in fallback facts — shown instantly, replaced by API facts when loaded
const FALLBACK_FACTS = [
  "Chhath Puja is one of the oldest Vedic festivals, dedicated to Surya Dev and Chhathi Maiya.",
  "Devotees fast for 36 hours without water during Chhath — one of the most rigorous fasts in Hinduism.",
  "Chhath is the only Vedic festival where the setting sun (Sandhya Arghya) is worshipped.",
  "The festival spans four days: Nahay Khay, Kharna, Sandhya Arghya, and Usha Arghya.",
  "Thekua — a sweet made of wheat flour, jaggery, and ghee — is the most sacred prasad of Chhath.",
  "Chhath Puja is celebrated on the sixth day (Chhath) of Kartik month in the Hindu calendar.",
  "The Ganga, Yamuna, and other rivers become sacred gathering places during Chhath Arghya.",
  "Chhath is celebrated with equal devotion in Bihar, Jharkhand, UP, and the Nepali Terai.",
  "The folk songs of Chhath, called Chhath geet, are passed down through generations orally.",
  "Surya Dev is worshipped as the source of all life and energy during Chhath Puja.",
];

// ─── Typewriter hook ──────────────────────────────────────────────────────────

function useTypewriter(text: string, key: number): string {
  const [displayed, setDisplayed] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDisplayed("");
    let i = 0;
    function type() {
      i++;
      setDisplayed(text.slice(0, i));
      if (i < text.length) {
        timerRef.current = setTimeout(type, CHAR_SPEED_MS);
      }
    }
    timerRef.current = setTimeout(type, CHAR_SPEED_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return displayed;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChhathFacts() {
  // Start with fallback facts immediately — no loading delay
  const [facts, setFacts] = useState<string[]>(
    [...FALLBACK_FACTS].sort(() => Math.random() - 0.5)
  );
  const [index, setIndex] = useState(0);

  const currentFact = facts[index] ?? "";
  const displayed = useTypewriter(currentFact, index);
  const isTyping = displayed.length < currentFact.length;

  // Fetch API facts in background — swap in when ready
  useEffect(() => {
    fetchFacts()
      .then((data) => {
        if (data.length > 0) {
          setFacts([...data].sort(() => Math.random() - 0.5).map((f) => f.fact));
          setIndex(0);
        }
      })
      .catch(() => {}); // keep fallback facts on error
  }, []);

  // Advance to next fact every HOLD_TOTAL_MS
  useEffect(() => {
    if (facts.length === 0) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % facts.length);
    }, HOLD_TOTAL_MS);
    return () => clearInterval(t);
  }, [facts.length]);

  const emoji = CHHATH_EMOJIS[index % CHHATH_EMOJIS.length];

  return (
    <>
      <style>{`
        @keyframes factCursorBlink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes factGlow {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(251,146,60,0.45)); }
          50%       { filter: drop-shadow(0 0 10px rgba(251,146,60,0.75)); }
        }
        .fact-gradient-text {
          background: linear-gradient(
            90deg,
            #fff7ed 0%,
            #fdba74 25%,
            #fb923c 55%,
            #fde68a 85%,
            #fff7ed 100%
          );
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: factGlow 3s ease-in-out infinite;
        }
      `}</style>

      <div
        style={{
          maxWidth: "min(92vw, 520px)",
          width: "100%",
          padding: "6px 14px 7px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          overflow: "hidden",
          textAlign: "center",
          /* No background — fully transparent, just the glowing text */
        }}
        aria-live="polite"
        aria-label="Chhath Puja fact"
      >
        {/* Rotating Chhath emoji */}
        <span
          style={{
            fontSize: "0.85rem",
            flexShrink: 0,
            filter: "drop-shadow(0 0 5px rgba(251,146,60,0.7))",
            alignSelf: "center",
          }}
          aria-hidden="true"
        >
          {emoji}
        </span>

        {/* Text — wraps freely, no truncation */}
        <span
          className="fact-gradient-text"
          style={{
            fontSize: "0.8rem",
            fontWeight: 700,
            letterSpacing: "0.01em",
            lineHeight: 1.55,
            whiteSpace: "normal",
            wordBreak: "break-word",
            flex: 1,
          }}
        >
          {displayed}
          {isTyping && (
            <span
              style={{
                display: "inline-block",
                width: "2px",
                height: "0.85em",
                background: "rgba(251,146,60,0.9)",
                marginLeft: "2px",
                verticalAlign: "text-bottom",
                animation: "factCursorBlink 0.6s step-end infinite",
              }}
              aria-hidden="true"
            />
          )}
        </span>
      </div>
    </>
  );
}