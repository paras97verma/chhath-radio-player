"use client";

/**
 * PageClient — Client Component containing all interactive UI for the main page.
 *
 * Layers (back → front):
 *   z-0  : GhatSceneLoader (Three.js canvas — immersive 3D Chhath Puja ghat)
 *   z-1  : Dark gradient overlay
 *   z-10 : Bottom gradient for player readability
 *   z-20 : HUD elements (listener count top-left, countdown top-center, clock top-right)
 *   z-20 : Bottom pill music player
 *   z-20 : Footer bar
 *   z-30 : ShareFloatingButton
 *   z-100: TuneInSplash (until user clicks)
 */

import { useState, useRef } from "react";
import RadioPlayer from "@/components/radio/RadioPlayer";
import TuneInSplash from "@/components/radio/TuneInSplash";
import ListenerCount from "@/components/radio/ListenerCount";
import LiveClock from "@/components/radio/LiveClock";
import ChhathCountdown from "@/components/radio/ChhathCountdown";
import ChhathFacts from "@/components/radio/ChhathFacts";
import ShareFloatingButton from "@/components/radio/ShareFloatingButton";
import GhatSceneLoader from "@/components/ghat/GhatSceneLoader";

import { UpiDonateModal } from "@/components/radio/Footer";

const LINKEDIN_URL = "https://linkedin.com/in/paras0397";
const INSTAGRAM_URL = "https://instagram.com/peivee";

// ─── Saffron/orange palette — no yellow tint ─────────────────────────────────
const C = {
  accent:       "#f97316",                    // orange-500
  accentBright: "#fb923c",                    // orange-400
  accentMuted:  "rgba(249,115,22,0.75)",
  accentFaint:  "rgba(249,115,22,0.45)",
  accentBorder: "rgba(249,115,22,0.25)",
  accentBorderHover: "rgba(249,115,22,0.5)",
  footerBg:     "rgba(8,2,2,0.90)",
  footerBorder: "rgba(249,115,22,0.12)",
};

// ─── Social Icons ─────────────────────────────────────────────────────────────

function IconInstagram() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

function IconLinkedIn() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

// ─── PageClient ───────────────────────────────────────────────────────────────

export default function PageClient() {
  const [showDonate, setShowDonate] = useState(false);
  const [hasTunedIn, setHasTunedIn] = useState(false);
  const audioNodeRef = useRef<AudioNode | null>(null);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#0d0505]">
      {/* Layer 0: Immersive 3D Chhath Puja Ghat (Three.js / React Three Fiber) */}
      <GhatSceneLoader audioNode={audioNodeRef.current} />

      {/* Layer 1: Dark gradient overlay for readability */}
      <div
        className="absolute inset-0 z-[1]"
        style={{
          background: "linear-gradient(to bottom, rgba(8,2,2,0.45) 0%, rgba(8,2,2,0.15) 40%, rgba(8,2,2,0.55) 100%)",
        }}
        aria-hidden="true"
      />

      {/* Layer 10: Bottom gradient for player readability */}
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        style={{
          background:
            "linear-gradient(to top, rgba(8,2,2,0.85) 0%, rgba(8,2,2,0.3) 35%, transparent 65%)",
        }}
        aria-hidden="true"
      />

      {/* Layer 20: Top-left — listener count */}
      <div className="absolute top-4 left-4 z-20">
        <ListenerCount />
      </div>

      {/* Layer 20: Top-center — Chhath countdown */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20">
        <ChhathCountdown />
      </div>

      {/* Layer 20: Top-right — live clock */}
      <div className="absolute top-4 right-4 z-20">
        <LiveClock />
      </div>

      {/* Layer 20: Center-bottom — Chhath facts ticker (above player) */}
      <div className="absolute bottom-[210px] left-0 right-0 z-20 flex justify-center px-4 pointer-events-none">
        <ChhathFacts />
      </div>

      {/* Layer 20: Bottom — pill music player (raised above footer) */}
      <div className="absolute bottom-[72px] left-0 right-0 z-20 flex justify-center px-4">
        <RadioPlayer hasTunedIn={hasTunedIn} />
      </div>

      {/* Layer 100: Tune In splash — shown until user clicks to start */}
      {!hasTunedIn && (
        <TuneInSplash onTuneIn={() => setHasTunedIn(true)} />
      )}

      {/* Layer 20: Footer bar */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20"
        style={{
          background: C.footerBg,
          borderTop: `1px solid ${C.footerBorder}`,
          backdropFilter: "blur(16px)",
        }}
      >
        <div className="flex items-center justify-between px-5 py-3 gap-3">

          {/* Left: छठ के गीत, बिना रुके */}
          <span
            className="text-xs shrink-0 hidden sm:block"
            style={{
              color: C.accentFaint,
              fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif",
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            छठ के गीत, बिना रुके
          </span>

          {/* Center: Made with 🪔 for Chhathi Maiya — by peivee */}
          <span
            className="text-xs text-center flex-1"
            style={{ color: C.accentFaint }}
          >
            Made with 🪔 for Chhathi Maiya — by{" "}
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold transition-colors"
              style={{ color: C.accentMuted }}
              onMouseEnter={(e) => (e.currentTarget.style.color = C.accentBright)}
              onMouseLeave={(e) => (e.currentTarget.style.color = C.accentMuted)}
            >
              peivee
            </a>
          </span>

          {/* Right: Social icons + Donate */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Instagram */}
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="w-7 h-7 flex items-center justify-center rounded-full transition-all"
              style={{ color: C.accentFaint }}
              onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.color = C.accentFaint)}
            >
              <IconInstagram />
            </a>

            {/* LinkedIn */}
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              className="w-7 h-7 flex items-center justify-center rounded-full transition-all"
              style={{ color: C.accentFaint }}
              onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.color = C.accentFaint)}
            >
              <IconLinkedIn />
            </a>

            {/* Divider */}
            <span style={{ color: C.accentBorder }}>·</span>

            {/* Donate button */}
            <button
              onClick={() => setShowDonate(true)}
              aria-label="Donate"
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all"
              style={{
                background: "rgba(249,115,22,0.1)",
                border: `1px solid ${C.accentBorder}`,
                color: C.accentMuted,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(249,115,22,0.2)";
                e.currentTarget.style.color = C.accent;
                e.currentTarget.style.borderColor = C.accentBorderHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(249,115,22,0.1)";
                e.currentTarget.style.color = C.accentMuted;
                e.currentTarget.style.borderColor = C.accentBorder;
              }}
            >
              <IconHeart />
              Donate
            </button>
          </div>
        </div>
      </div>

      {/* Layer 30: Fixed 3D share button — right-center edge, independent of radio player */}
      <ShareFloatingButton />

      {/* UPI Donate Modal */}
      {showDonate && <UpiDonateModal onClose={() => setShowDonate(false)} />}
    </main>
  );
}
