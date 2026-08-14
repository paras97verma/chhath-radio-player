"use client";

/**
 * PageClient — Client Component containing all interactive UI for the main page.
 *
 * Mobile layout (< 640px):
 *   TOP ROW:
 *     ListenerCount   → fixed top-left
 *     ChhathCountdown → fixed top-RIGHT (scaled down, full card)
 *   LEFT SIDE:
 *     ShareFloatingButton → fixed left-0 top-1/2 (tab)
 *   BOTTOM STACK:
 *     Footer          → fixed bottom-0
 *     RadioPlayer     → fixed above footer (full width)
 *     ChhathFacts     → fixed above player
 *   Hidden on mobile: LiveClock, LiveChatDrawer, ReactionBar, KeyboardHelpButton,
 *                     MilestoneCelebration, ReactionSplash
 *
 * Desktop layout (≥ 640px) — full HUD:
 *   TOP ROW:
 *     ListenerCount   → fixed top-3 left-3
 *     ChhathCountdown → fixed top-3 left-1/2 -translate-x-1/2
 *     LiveClock       → fixed top-3 right-3
 *   SIDES:
 *     ShareFloatingButton → fixed left-0 top-1/2 -translate-y-1/2  (z-30)
 *     LiveChatDrawer FAB  → fixed right, vertically centered on player
 *   BOTTOM STACK (from bottom up):
 *     Footer          → fixed bottom-0   h-11 sm:h-12
 *     RadioPlayer     → fixed bottom-12  (above footer)
 *     ChhathFacts     → fixed bottom-28  (above player)
 *     HelpButton "?"  → fixed bottom-14 left-3
 *     ReactionFAB     → absolute right of player pill
 *   OVERLAY:
 *     TuneInSplash    → fixed inset-0 z-[100]  (until user clicks)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useRadioStore } from "@/lib/radio-store";
import RadioPlayer from "@/components/radio/RadioPlayer";
import TuneInSplash from "@/components/radio/TuneInSplash";
import ListenerCount from "@/components/radio/ListenerCount";
import LiveClock from "@/components/radio/LiveClock";
import ChhathCountdown from "@/components/radio/ChhathCountdown";
import ChhathFacts from "@/components/radio/ChhathFacts";
import ShareFloatingButton from "@/components/radio/ShareFloatingButton";
import GhatSceneLoader from "@/components/ghat/GhatSceneLoader";
import ReactionBar from "@/components/radio/ReactionBar";
import ReactionSplash from "@/components/radio/ReactionSplash";
import KeyboardHelpButton from "@/components/radio/KeyboardHelpButton";
import PwaInstallBanner from "@/components/radio/PwaInstallBanner";
import MilestoneCelebration from "@/components/radio/MilestoneCelebration";
import LiveChatDrawer from "@/components/radio/LiveChatDrawer";
import { UpiDonateModal } from "@/components/radio/Footer";

const LINKEDIN_URL = "https://linkedin.com/in/paras0397";
const INSTAGRAM_URL = "https://instagram.com/peivee";

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
  const currentSong = useRadioStore((s) => s.currentSong());
  const [showDonate, setShowDonate] = useState(false);
  const [hasTunedIn, setHasTunedIn] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);
  const [splashEmoji, setSplashEmoji] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [mobileChatUnread, setMobileChatUnread] = useState(0);
  const audioNodeRef = useRef<AudioNode | null>(null);

  useEffect(() => {
    import("@/lib/session").then(({ getOrCreateSessionId }) => {
      setSessionId(getOrCreateSessionId());
    });
  }, []);

  // Track mobile breakpoint for layout switching
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleCountChange = useCallback((c: number) => setListenerCount(c), []);
  const handleReact = useCallback((emoji: string) => setSplashEmoji(emoji), []);
  const handleSplashDone = useCallback(() => setSplashEmoji(null), []);
  const handlePlaylistToggle = useCallback(() => setShowPlaylist((v) => !v), []);

  return (
    <>
    <main className="fixed inset-0 overflow-hidden bg-[#0a0402]">

      {/* ── Layer 0: 3D Chhath Ghat scene ── */}
      <GhatSceneLoader />

      {/* ── Layer 1: Full-canvas dark overlay for wallpaper depth ── */}
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{ background: "rgba(5,2,1,0.38)" }}
        aria-hidden="true"
      />

      {/* ── Layer 2: Top + bottom vignette for HUD readability ── */}
      <div
        className="absolute inset-0 z-[2] pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, rgba(5,2,1,0.55) 0%, rgba(5,2,1,0.10) 30%, transparent 55%, rgba(5,2,1,0.65) 100%)",
        }}
        aria-hidden="true"
      />

      {/* ── Layer 10: Bottom gradient for player readability ── */}
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        style={{
          background: "linear-gradient(to top, rgba(5,2,1,0.90) 0%, rgba(5,2,1,0.40) 30%, transparent 55%)",
        }}
        aria-hidden="true"
      />

      {/* ══════════════════════════════════════════════════════════
          TOP ROW HUD
      ══════════════════════════════════════════════════════════ */}

      {/* Top-left: Listener count — always visible */}
      <div className="fixed z-20" style={{ top: "var(--hud-inset)", left: "var(--hud-inset)" }}>
        <ListenerCount onCountChange={handleCountChange} />
      </div>

      {/* Top-center: Chhath countdown — desktop only, centered */}
      <div
        className="fixed z-20 hidden sm:block"
        style={{ top: "var(--hud-inset)", left: "50%", transform: "translateX(-50%)" }}
      >
        <ChhathCountdown />
      </div>

      {/* Top-right: Chhath countdown — mobile only, top-right, scaled to fit */}
      <div
        className="fixed z-20 sm:hidden"
        style={{
          top: "var(--hud-inset)",
          right: "var(--hud-inset)",
          transformOrigin: "top right",
          transform: "scale(0.72)",
        }}
      >
        <ChhathCountdown />
      </div>

      {/* Top-right: Live clock — desktop only */}
      <div className="fixed z-20 hidden sm:block" style={{ top: "var(--hud-inset)", right: "var(--hud-inset)" }}>
        <LiveClock />
      </div>

      {/* ══════════════════════════════════════════════════════════
          BOTTOM STACK
      ══════════════════════════════════════════════════════════ */}

      {/* Facts ticker — always visible */}
      <div
        className="fixed left-0 right-0 z-20 flex justify-center px-4 pointer-events-none"
        style={{ bottom: "var(--facts-bottom)" }}
      >
        <ChhathFacts />
      </div>

      {/* Player row — always visible, pill centered */}
      <div
        className="fixed left-0 right-0 z-20 flex items-center justify-center px-3 sm:px-4"
        style={{ bottom: "var(--player-bottom)" }}
      >
        {/* Radio player pill */}
        <div className="relative min-w-0 max-w-lg w-full">
          <RadioPlayer
            hasTunedIn={hasTunedIn}
            showPlaylist={showPlaylist}
            onPlaylistToggle={handlePlaylistToggle}
          />

          {/* Desktop only: Reaction FAB — right of pill */}
          <div
            className="absolute top-1/2 -translate-y-1/2 hidden sm:block"
            style={{ left: "calc(100% + 12px)" }}
          >
            <ReactionBar onReact={handleReact} />
          </div>
        </div>

        {/* Desktop only: Chat FAB — far right of viewport */}
        {!isMobile && sessionId && (
          <div
            className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ right: "var(--hud-inset)" }}
          >
            <LiveChatDrawer sessionId={sessionId} listenerCount={listenerCount} />
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════
          MOBILE CHAT FAB — fixed bottom-right, above footer
          Hidden when any other modal is open
      ══════════════════════════════════════════════════════════ */}
      {/* Mobile chat FAB — top-left, below the listener count pill, clear of all other elements */}
      {isMobile && sessionId && !(showPlaylist || showShare || showDonate || showChat) && (
        <div
          className="fixed z-30 sm:hidden"
          style={{ top: "calc(var(--hud-inset) + 2.6rem)", left: "var(--hud-inset)" }}
        >
          <button
            onClick={() => setShowChat((v) => !v)}
            aria-label="Open live chat"
            className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-full cursor-pointer select-none"
            style={{
              background: "rgba(14,7,2,0.92)",
              border: "1px solid rgba(249,115,22,0.40)",
              boxShadow: "4px 4px 10px rgba(0,0,0,0.65), -2px -2px 6px rgba(60,30,10,0.22), 0 0 10px rgba(249,115,22,0.18)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            {/* Chat icon */}
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 shrink-0">
              <path
                d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                fill="rgba(249,115,22,0.18)"
                stroke="rgba(249,115,22,0.80)"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <rect x="7"  y="10" width="1.5" height="4" rx="0.75" fill="#fb923c"/>
              <rect x="10" y="8"  width="1.5" height="6" rx="0.75" fill="#fb923c"/>
              <rect x="13" y="9"  width="1.5" height="5" rx="0.75" fill="#fb923c"/>
              <rect x="16" y="11" width="1.5" height="3" rx="0.75" fill="#fb923c"/>
            </svg>
            {/* Live pulse dot */}
            <span className="relative flex shrink-0 w-1.5 h-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
              <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-green-400" />
            </span>
            {/* Unread badge */}
            {mobileChatUnread > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-0.5 rounded-full
                           bg-red-500 text-white text-[9px] font-bold
                           flex items-center justify-center"
                style={{ boxShadow: "2px 2px 5px rgba(0,0,0,0.6)" }}
              >
                {mobileChatUnread > 9 ? "9+" : mobileChatUnread}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Keyboard help "?" — desktop only */}
      <div
        className="fixed z-30 hidden sm:block"
        style={{ bottom: "var(--player-bottom)", left: "var(--hud-inset)" }}
      >
        <KeyboardHelpButton />
      </div>

      {/* Footer bar — always visible */}
      <div
        className="fixed bottom-0 left-0 right-0 z-20 h-11 sm:h-12"
        style={{
          background: "rgba(8, 3, 1, 0.97)",
          boxShadow: "0 -4px 16px rgba(0,0,0,0.65), 0 -1px 0 rgba(249,115,22,0.18)",
        }}
      >
        <div className="flex items-center justify-between h-full px-4 sm:px-5 gap-3">
          {/* Left: Hindi tagline — desktop only */}
          <span
            className="text-xs shrink-0 hidden sm:block text-orange-400 font-bold tracking-wide"
            style={{ fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif" }}
          >
            छठ के गीत, बिना रुके
          </span>

          {/* Center: attribution */}
          <span className="text-xs text-center flex-1 text-orange-500/70">
            Made with 🪔 for Chhathi Maiya — by{" "}
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-orange-500/90 hover:text-orange-400 transition-colors"
            >
              peivee
            </a>
          </span>

          {/* Right: social + donate */}
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="w-7 h-7 flex items-center justify-center rounded-full text-orange-500/70 hover:text-orange-500 transition-colors"
            >
              <IconInstagram />
            </a>
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              className="w-7 h-7 flex items-center justify-center rounded-full text-orange-500/70 hover:text-orange-500 transition-colors"
            >
              <IconLinkedIn />
            </a>
            <span className="text-orange-500/30">·</span>
            <button
              onClick={() => setShowDonate(true)}
              aria-label="Donate"
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
                         text-orange-500/90 hover:text-orange-400 transition-all duration-150"
              style={{
                background: "rgba(15, 8, 4, 0.88)",
                boxShadow: "3px 3px 8px rgba(0,0,0,0.6), -1px -1px 4px rgba(60,30,10,0.25), inset 0 1px 0 rgba(255,255,255,0.03)",
              }}
            >
              <IconHeart />
              Donate
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          SIDE ELEMENTS
      ══════════════════════════════════════════════════════════ */}

      {/* Left-center: 3D share tab — hidden on mobile when playlist is open */}
      {!(isMobile && showPlaylist) && (
        <ShareFloatingButton onOpenChange={(open) => setShowShare(open)} />
      )}

      {/* Milestone celebration — desktop only */}
      {!isMobile && <MilestoneCelebration count={listenerCount} />}

      {/* Full-screen reaction splash — all devices */}
      <ReactionSplash emoji={splashEmoji} onDone={handleSplashDone} />

      {/* PWA install banner — desktop only (guarded inside component too) */}
      <PwaInstallBanner />

      {/* UPI Donate Modal */}
      {showDonate && <UpiDonateModal onClose={() => setShowDonate(false)} />}
    </main>

    {/* ── TuneInSplash rendered OUTSIDE <main> to avoid overflow-hidden clipping ── */}
    {!hasTunedIn && (
      <TuneInSplash onTuneIn={() => setHasTunedIn(true)} />
    )}

    {/* Mobile only: ReactionBar — OUTSIDE <main> to avoid overflow-hidden clipping.
        Hidden when playlist, share modal, donate modal, or chat is open. right:8px so FAB is fully visible. */}
    {!(isMobile && (showPlaylist || showShare || showDonate || showChat)) && (
      <div
        className="sm:hidden"
        style={{
          position: "fixed",
          right: "8px",
          top: "38%",
          transform: "translateY(-50%)",
          zIndex: 30,
        }}
      >
        <ReactionBar onReact={handleReact} arcDirection="left" />
      </div>
    )}

    {/* Mobile only: LiveChatDrawer bottom-sheet — OUTSIDE <main> to avoid overflow-hidden clipping */}
    {isMobile && sessionId && (
      <LiveChatDrawer
        sessionId={sessionId}
        listenerCount={listenerCount}
        mobileOpen={showChat}
        onMobileClose={() => setShowChat(false)}
        onUnreadChange={(n) => setMobileChatUnread(n)}
      />
    )}
    </>
  );
}
