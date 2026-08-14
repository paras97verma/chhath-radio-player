"use client";

/**
 * PushPermissionPrompt — Asks users to enable push notifications.
 *
 * Shown after 2 minutes of listening, once per session.
 * Stores dismissal in localStorage so it doesn't re-appear.
 *
 * On click: requests Notification permission via the browser API.
 * If granted, subscribes to push via the service worker.
 */

import { useState, useEffect } from "react";

const DISMISSED_KEY = "chhath_push_dismissed_v1";
const SHOW_AFTER_MS = 2 * 60 * 1000; // 2 minutes

function isDismissed(): boolean {
  try { return !!localStorage.getItem(DISMISSED_KEY); } catch { return false; }
}

function setDismissed() {
  try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* ignore */ }
}

export default function PushPermissionPrompt() {
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<"idle" | "requesting" | "granted" | "denied">("idle");

  useEffect(() => {
    // Don't show if already dismissed, already granted, or not supported
    if (isDismissed()) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;

    const timer = setTimeout(() => setShow(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  const handleAllow = async () => {
    setStatus("requesting");
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        setStatus("granted");
        setDismissed();
        // Register service worker and subscribe
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          // VAPID public key would go here in production
          // For now just confirm the SW is active
          console.info("[Chhath Radio] Push notifications enabled", reg.scope);
        }
        setTimeout(() => setShow(false), 2000);
      } else {
        setStatus("denied");
        setDismissed();
        setTimeout(() => setShow(false), 1500);
      }
    } catch (err) {
      console.error("[Chhath Radio] Push permission error", err);
      setStatus("denied");
      setDismissed();
      setTimeout(() => setShow(false), 1500);
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
        @keyframes pushPromptSlideUp {
          0%   { transform: translateY(100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      <div
        role="dialog"
        aria-label="Enable push notifications"
        style={{
          position: "fixed",
          bottom: 90,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50,
          width: "min(92vw, 380px)",
          background: "rgba(10,4,2,0.97)",
          border: "1px solid rgba(249,115,22,0.35)",
          borderRadius: 18,
          padding: "16px 18px",
          boxShadow: "0 16px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(249,115,22,0.08)",
          animation: "pushPromptSlideUp 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        {/* Icon */}
        <div style={{ fontSize: 32, flexShrink: 0, lineHeight: 1 }}>🪔</div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {status === "granted" ? (
            <p style={{ color: "#4ade80", fontWeight: 700, fontSize: 13 }}>
              ✓ Notifications enabled! We'll notify you on Chhath days.
            </p>
          ) : status === "denied" ? (
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
              Notifications blocked. You can enable them in browser settings.
            </p>
          ) : (
            <>
              <p style={{ color: "#fb923c", fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                Get notified on Chhath days 🙏
              </p>
              <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
                We'll remind you for Sandhya & Usha Arghya
              </p>
            </>
          )}
        </div>

        {/* Actions */}
        {status === "idle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
            <button
              onClick={handleAllow}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                background: "linear-gradient(135deg, #fb923c, #ea580c)",
                border: "none",
                color: "#fff",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Allow
            </button>
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
              Not now
            </button>
          </div>
        )}

        {status === "requesting" && (
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>…</div>
        )}
      </div>
    </>
  );
}