"use client";

/**
 * PwaInstallBanner — Shows a subtle bottom banner after 30 seconds
 * prompting the user to install Chhath Radio as a PWA.
 *
 * - On Android/Chrome: uses the native `beforeinstallprompt` event
 * - On iOS Safari: shows manual "Share → Add to Home Screen" instructions
 * - Dismissed state is persisted in localStorage (never re-shown)
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "chhath_pwa_dismissed_v1";
const SHOW_DELAY_MS = 30_000; // 30 seconds

type BannerMode = "android" | "ios" | null;

// Detect iOS Safari (no beforeinstallprompt support)
function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua);
}

// Detect if already running as installed PWA
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// Only show PWA install prompt on desktop (≥ 1024px)
function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth >= 1024;
}

export default function PwaInstallBanner() {
  const [mode, setMode] = useState<BannerMode>(null);
  const [visible, setVisible] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Don't show if already installed, previously dismissed, or on mobile
    if (isStandalone()) return;
    if (!isDesktop()) return;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch { /* ignore */ }

    let timer: ReturnType<typeof setTimeout>;

    // Android/Chrome: listen for the install prompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      timer = setTimeout(() => {
        setMode("android");
        setVisible(true);
      }, SHOW_DELAY_MS);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    // iOS Safari: show manual instructions after delay
    if (isIosSafari()) {
      timer = setTimeout(() => {
        setMode("ios");
        setVisible(true);
      }, SHOW_DELAY_MS);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      dismiss();
    }
    setDeferredPrompt(null);
  };

  if (!visible || !mode) return null;

  return (
    <>
      <style>{`
        @keyframes pwaSlideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
      <div
        role="banner"
        aria-label="Install Chhath Radio app"
        style={{
          position: "fixed",
          bottom: 80, // above footer
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 40,
          width: "min(92vw, 420px)",
          background: "rgba(10,4,2,0.97)",
          border: "1px solid rgba(249,115,22,0.35)",
          borderRadius: 18,
          padding: "14px 16px",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(249,115,22,0.08)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          animation: "pwaSlideUp 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
        }}
      >
        {/* Diya icon */}
        <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>🪔</span>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", margin: 0, lineHeight: 1.3 }}>
            Add Chhath Radio to Home Screen
          </p>
          {mode === "android" ? (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: "4px 0 0", lineHeight: 1.4 }}>
              Install for instant access — no app store needed 🙏
            </p>
          ) : (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: "4px 0 0", lineHeight: 1.4 }}>
              Tap <strong style={{ color: "rgba(249,115,22,0.85)" }}>Share</strong> →{" "}
              <strong style={{ color: "rgba(249,115,22,0.85)" }}>Add to Home Screen</strong> for instant access 🙏
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          {mode === "android" && (
            <button
              onClick={handleInstall}
              style={{
                padding: "7px 14px",
                borderRadius: 10,
                background: "linear-gradient(135deg, #f97316, #ea580c)",
                border: "none",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                boxShadow: "0 4px 12px rgba(249,115,22,0.35)",
              }}
            >
              Install
            </button>
          )}
          <button
            onClick={dismiss}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.4)",
              fontSize: 11,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {mode === "android" ? "Not now" : "Got it"}
          </button>
        </div>
      </div>
    </>
  );
}