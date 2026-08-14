"use client";

/**
 * ChhathFacts — Rotates Chhath Puja facts with typewriter animation.
 *
 * - Instant display on load (built-in fallback facts, no API wait)
 * - Typewriter animation on entry (18ms/char)
 * - Fact shown for 10 seconds total, then instant swap
 * - Transparent background — gradient text with glow only
 * - Rotating Chhath-themed emoji per fact
 *
 * CSS classes defined in globals.css: .fact-gradient-text, .fact-cursor
 */

import { useEffect, useState, useRef } from "react";
import { fetchFacts } from "@/lib/api";

const CHAR_SPEED_MS = 18;
const HOLD_TOTAL_MS = 10_000;

const CHHATH_EMOJIS = [
  "🪔", "🌅", "🌊", "🙏", "🌸", "☀️", "🌙", "🪷", "🌺", "🎋",
  "🌾", "🍚", "🥭", "🍌", "🌿", "🔔", "🪘", "🌄", "🕯️", "🌻",
];

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
      if (i < text.length) timerRef.current = setTimeout(type, CHAR_SPEED_MS);
    }
    timerRef.current = setTimeout(type, CHAR_SPEED_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return displayed;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChhathFacts() {
  const [facts, setFacts] = useState<string[]>(
    [...FALLBACK_FACTS].sort(() => Math.random() - 0.5)
  );
  const [index, setIndex] = useState(0);

  const currentFact = facts[index] ?? "";
  const displayed = useTypewriter(currentFact, index);
  const isTyping = displayed.length < currentFact.length;

  useEffect(() => {
    fetchFacts()
      .then((data) => {
        if (data.length > 0) {
          setFacts([...data].sort(() => Math.random() - 0.5).map((f) => f.fact));
          setIndex(0);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (facts.length === 0) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % facts.length), HOLD_TOTAL_MS);
    return () => clearInterval(t);
  }, [facts.length]);

  const emoji = CHHATH_EMOJIS[index % CHHATH_EMOJIS.length];

  return (
    <div
      className="w-full max-w-[min(92vw,520px)] px-3.5 py-1.5
                 flex items-baseline justify-center gap-1.5
                 overflow-hidden text-center"
      aria-live="polite"
      aria-label="Chhath Puja fact"
    >
      {/* Rotating emoji */}
      <span
        className="text-[13px] shrink-0 leading-[1.55]"
        style={{ filter: "drop-shadow(0 0 5px rgba(251,146,60,0.7))" }}
        aria-hidden="true"
      >
        {emoji}
      </span>

      {/* Typewriter text */}
      <span className="fact-gradient-text text-[13px] sm:text-sm font-bold tracking-[0.01em] leading-[1.55] whitespace-normal break-words">
        {displayed}
        {isTyping && <span className="fact-cursor" aria-hidden="true" />}
      </span>
    </div>
  );
}