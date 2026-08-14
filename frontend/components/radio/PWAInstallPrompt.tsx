"use client";

/**
 * PWAInstallPrompt — Custom "Add to Home Screen" install banner.
 *
 * Chrome/Edge/Samsung Browser fire the `beforeinstallprompt` event when the
 * PWA is installable. We capture it, suppress the default mini-infobar, and
 * show our own branded prompt after the user has been listening for 30 seconds.
 *
 * Criteria for Chrome to fire `beforeinstallprompt`:
 *   ✓ Valid manifest.json with name, short_name, start_url, display: standalone
 *   ✓ At least one icon ≥ 192×192 that loads (HTTP 200)
 *   ✓ Service worker registered with a fetch handler
 *   ✓ Served over HTTPS (or localhost)
 *   ✓ Not already installed
 *
 * Safari (iOS): does not fire `beforeinstallprompt`. We show a manual
 * "tap Share → Add to Home Screen" hint instead.
 *
 * Dismissal is stored in localStorage — won't re-appear for 7 days.
 */

import { useEffect, useState, useRef } from "react";

const DISMISSED_KEY = "chhath_pwa_install_dismissed_v1";
const SHOW_AFTER_MS = 30_000; // 30 seconds of listening
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isDismissed(): boolean {
  try {
    const val = localStorage.getItem(DISMISSED_KEY);
    if (!val) return false;
    const ts = parseInt(val, 10);
    return Date.now() - ts < DISMISS_DURATION_MS;
  } catch {
    return false;
  }
}

function setDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

export default function PWAInstallPrompt() {
  const [show, setShow] = useState(false);
  const [isIOSHint, setIsIOSHint] = useState(false);
  const [installing, setInstalling] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Don't show if already installed or dismissed
    if (isInStandaloneMode()) return;
    if (isDismissed()) return;

    const ios = isIOS();

    if (ios) {
      // iOS Safari: no beforeinstallprompt — show manual hint after delay
      const timer = setTimeout(() => {
        setIsIOSHint(true);
        setShow(true);
      }, SHOW_AFTER_MS);
      return () => clearTimeout(timer);
    }

    // Chrome/Edge/Samsung: capture beforeinstallprompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault(); // suppress mini-infobar
      deferredPrompt.current = e as BeforeInstallPromptEvent;

      // Show our prompt after the user has been on the page a while
      const timer = setTimeout(() => {
        setIsIOSHint(false);
        setShow(true);
      }, SHOW_AFTER_MS);

      // Clean up timer if component unmounts before it fires
      return () => clearTimeout(timer);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    // If already installed (appinstalled fires), hide the prompt
    const handleInstalled = () => {
      setShow(false);
      deferredPrompt.current = null;
    };
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt.current) return;
    setInstalling(true);
    try {
      await deferredPrompt.current.prompt();
      const { outcome } = await deferredPrompt.current.userChoice;
      if (outcome === "accepted") {
        setShow(false);
        deferredPrompt.current = null;
      } else {
        setInstalling(false);
      }
      setDismissed();
    } catch {
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    setDismissed();
    setShow(false);
  };

  if (!show) return null;

  return (
    <>
      <style>{`
        @keyframes pwaSlideUp {
          0%   { transform: translateX(-50%) translateY(20px); opacity: 0; }
          100% { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `}</style>

      <div
        role="dialog"
        aria-label="Install Chhath Radio app"
        style={{
          position: "fixed",
          bottom: 100,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 60,
          width: "min(92vw, 360px)",
          background: "rgba(10,4,2,0.97)",
          border: "1px solid rgba(249,115,22,0.4)",
          borderRadius: 20,
          padding: "14px 16px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(249,115,22,0.1)",
          animation: "pwaSlideUp 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* App icon */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-192.png"
          alt="Chhath Radio"
          width={44}
          height={44}
          style={{ borderRadius: 10, flexShrink: 0 }}
        />

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: "#fb923c", fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
            Install Chhath Radio 🪔
          </p>
          {isIOSHint ? (
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, lineHeight: 1.4 }}>
              Tap <strong style={{ color: "rgba(255,255,255,0.65)" }}>Share</strong> →{" "}
              <strong style={{ color: "rgba(255,255,255,0.65)" }}>Add to Home Screen</strong>
            </p>
          ) : (
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
              Listen offline, no browser needed
            </p>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
          {!isIOSHint && (
            <button
              onClick={handleInstall}
              disabled={installing}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                background: installing
                  ? "rgba(249,115,22,0.4)"
                  : "linear-gradient(135deg, #fb923c, #ea580c)",
                border: "none",
                color: "#fff",
                fontWeight: 700,
                fontSize: 12,
                cursor: installing ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {installing ? "…" : "Install"}
            </button>
          )}
          <button
            onClick={handleDismiss}
            style={{
              padding: "4px 10px",
              borderRadius: 20,
              background: "transparent",
              border: "none",
              color: "rgba(255,255,255,0.3)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {isIOSHint ? "Got it" : "Not now"}
          </button>
        </div>
      </div>
    </>
  );
}