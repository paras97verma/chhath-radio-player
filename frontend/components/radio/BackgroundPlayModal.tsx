"use client";

import { useState, useEffect } from "react";
import {
  isWakeLockSupported,
  isWakeLockActive,
  isWakeLockEnabled,
  setWakeLockEnabled,
  subscribeWakeLock,
} from "@/lib/wake-lock";

interface BackgroundPlayModalProps {
  onClose: () => void;
}

export default function BackgroundPlayModal({ onClose }: BackgroundPlayModalProps) {
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [wakeLockEnabled, setEnabledState] = useState(true);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">("default");
  const [activeTab, setActiveTab] = useState<"android" | "ios" | "windows">("android");

  useEffect(() => {
    setEnabledState(isWakeLockEnabled());
    const unsub = subscribeWakeLock((active) => {
      setWakeLockActive(active);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPermission(Notification.permission);
    } else {
      setNotifPermission("unsupported");
    }

    // Auto-detect OS for default tab
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent.toLowerCase();
      if (/iphone|ipad|ipod/.test(ua)) {
        setActiveTab("ios");
      } else if (/android/.test(ua)) {
        setActiveTab("android");
      } else if (/win/.test(ua)) {
        setActiveTab("windows");
      }
    }
  }, []);

  const handleToggleWakeLock = () => {
    const next = !wakeLockEnabled;
    setEnabledState(next);
    setWakeLockEnabled(next);
  };

  const handleRequestNotification = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
      if (perm === "granted") {
        new Notification("Chhath Radio 🪔", {
          body: "Background Play active — enjoy non-stop Chhath geet!",
          icon: "/icons/icon-192.png",
        });
      }
    } catch (err) {
      console.warn("[BackgroundPlayModal] Notification permission error:", err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none"
      style={{
        background: "rgba(5, 2, 1, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
      onClick={onClose}
      role="dialog"
      aria-label="Background Play Settings"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md rounded-3xl p-5 sm:p-6 border overflow-hidden text-white"
        style={{
          background: "linear-gradient(165deg, rgba(28, 14, 8, 0.98) 0%, rgba(15, 8, 4, 0.96) 100%)",
          borderColor: "rgba(255, 138, 80, 0.35)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.9), 0 0 30px rgba(255, 107, 53, 0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-orange-500/20">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl" aria-hidden="true">📱</span>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-orange-400">
                Background Play Settings
              </h2>
              <p className="text-[11px] text-amber-200/60 font-medium">
                Screen off hone par bhi bina ruke sunein
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Feature Toggles */}
        <div className="mt-4 space-y-3">
          {/* Wake Lock Screen On Toggle */}
          <div
            className="flex items-center justify-between p-3 rounded-2xl border"
            style={{
              background: "rgba(255,255,255,0.03)",
              borderColor: "rgba(255, 138, 80, 0.18)",
            }}
          >
            <div className="pr-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white/90">Keep Screen Awake</span>
                {wakeLockActive ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30">
                    Active 🟢
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300/80 font-medium">
                    Standby 🟡
                  </span>
                )}
              </div>
              <p className="text-[11px] text-white/50 mt-0.5 leading-snug">
                Gaana chalte waqt phone screen auto-off nahi hogi.
              </p>
            </div>

            {isWakeLockSupported() ? (
              <button
                onClick={handleToggleWakeLock}
                role="switch"
                aria-checked={wakeLockEnabled}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                  wakeLockEnabled ? "bg-orange-500" : "bg-white/20"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    wakeLockEnabled ? "translate-x-6" : "translate-x-0"
                  }`}
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
                />
              </button>
            ) : (
              <span className="text-[11px] text-white/40 italic shrink-0">Not supported</span>
            )}
          </div>

          {/* Media Session & Lock Screen Integration Status */}
          <div
            className="flex items-center justify-between p-3 rounded-2xl border"
            style={{
              background: "rgba(255,255,255,0.03)",
              borderColor: "rgba(255, 138, 80, 0.18)",
            }}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white/90">Lock Screen Controls</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30">
                  Ready 🪔
                </span>
              </div>
              <p className="text-[11px] text-white/50 mt-0.5 leading-snug">
                Lock Screen, Control Center aur Bluetooth se Play/Pause/Next control karein.
              </p>
            </div>
          </div>

          {/* Notifications Permission */}
          <div
            className="flex items-center justify-between p-3 rounded-2xl border"
            style={{
              background: "rgba(255,255,255,0.03)",
              borderColor: "rgba(255, 138, 80, 0.18)",
            }}
          >
            <div className="pr-2">
              <span className="text-sm font-semibold text-white/90">Lock Screen Notification</span>
              <p className="text-[11px] text-white/50 mt-0.5 leading-snug">
                Media notification aur Puja updates paane ke liye permission dein.
              </p>
            </div>
            {notifPermission === "granted" ? (
              <span className="text-[11px] text-emerald-400 font-semibold px-2 py-1 bg-emerald-500/10 rounded-lg shrink-0">
                Granted ✓
              </span>
            ) : notifPermission === "denied" ? (
              <span className="text-[11px] text-red-400 font-medium shrink-0">Blocked in browser</span>
            ) : notifPermission === "default" ? (
              <button
                onClick={handleRequestNotification}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors shrink-0"
                style={{ boxShadow: "0 2px 8px rgba(249, 115, 22, 0.4)" }}
              >
                Allow 🔔
              </button>
            ) : (
              <span className="text-[11px] text-white/40 shrink-0">Unsupported</span>
            )}
          </div>
        </div>

        {/* Operating System Instructions Tabs */}
        <div className="mt-4 pt-3 border-t border-orange-500/20">
          <p className="text-xs font-semibold text-orange-400/90 mb-2">
            💡 Screen Off hone par audio chalane ka tarika:
          </p>

          <div className="flex gap-1.5 p-1 rounded-xl bg-black/40 mb-3">
            <button
              onClick={() => setActiveTab("android")}
              className={`flex-1 py-1 text-xs rounded-lg font-medium transition-all ${
                activeTab === "android"
                  ? "bg-orange-500/30 text-orange-300 border border-orange-500/40"
                  : "text-white/50 hover:text-white"
              }`}
            >
              🤖 Android
            </button>
            <button
              onClick={() => setActiveTab("ios")}
              className={`flex-1 py-1 text-xs rounded-lg font-medium transition-all ${
                activeTab === "ios"
                  ? "bg-orange-500/30 text-orange-300 border border-orange-500/40"
                  : "text-white/50 hover:text-white"
              }`}
            >
              🍎 iPhone / iOS
            </button>
            <button
              onClick={() => setActiveTab("windows")}
              className={`flex-1 py-1 text-xs rounded-lg font-medium transition-all ${
                activeTab === "windows"
                  ? "bg-orange-500/30 text-orange-300 border border-orange-500/40"
                  : "text-white/50 hover:text-white"
              }`}
            >
              💻 Windows / Mac
            </button>
          </div>

          <div className="bg-black/30 rounded-2xl p-3 text-[11px] leading-relaxed text-amber-100/80 border border-orange-500/10">
            {activeTab === "android" && (
              <ol className="list-decimal list-inside space-y-1.5 text-white/70">
                <li>
                  <strong className="text-orange-300">Lock Screen:</strong> Phone lock hone par agar audio ruke, to notification shade mein <strong className="text-white">Play ▶</strong> button dabayein.
                </li>
                <li>
                  <strong className="text-orange-300">Battery Setting:</strong> Android settings &gt; Apps &gt; Chrome &gt; Battery mein jaakar <strong className="text-white">Unrestricted</strong> chunein taaki background band na ho.
                </li>
                <li>
                  <strong className="text-orange-300">Keep Screen Awake:</strong> Upar diye toggle ko On rakhein taaki screen apne aap off na ho.
                </li>
              </ol>
            )}

            {activeTab === "ios" && (
              <ol className="list-decimal list-inside space-y-1.5 text-white/70">
                <li>
                  <strong className="text-orange-300">Lock Screen:</strong> iPhone lock hone ke baad Lock Screen ya Control Center par <strong className="text-white">Play ▶</strong> button dabayein.
                </li>
                <li>
                  <strong className="text-orange-300">Silent Loop Active:</strong> WebKit audio session active hai, background playback AirPods aur earphones par bhi chalta rahega.
                </li>
                <li>
                  <strong className="text-orange-300">Add to Home Screen:</strong> Safari share icon dabakar "Add to Home Screen" karein for best performance.
                </li>
              </ol>
            )}

            {activeTab === "windows" && (
              <ul className="list-disc list-inside space-y-1.5 text-white/70">
                <li>
                  <strong className="text-orange-300">Keyboard Media Keys:</strong> Keyboard ke Play/Pause, Next aur Prev buttons se control karein.
                </li>
                <li>
                  <strong className="text-orange-300">Windows Volume Overlay:</strong> Taskbar aur volume flyout par current Chhath geet ka naam aur controls dikhenge.
                </li>
                <li>
                  <strong className="text-orange-300">Background Tab:</strong> Doosre tab ya window par kaam karte waqt bhi audio chalti rahegi.
                </li>
              </ul>
            )}
          </div>
        </div>

        {/* Done Button */}
        <div className="mt-5">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-full font-semibold text-sm bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white transition-all shadow-md active:scale-98"
          >
            Theek Hai / Samajh Gaya ✓
          </button>
        </div>
      </div>
    </div>
  );
}
