"use client";

/**
 * ListenerCount — animated LIVE badge with heartbeat glow.
 *
 * Below HOT_THRESHOLD  → modern gradient SVG user icon with heartbeat pulse + 3D count + "online"
 * Above HOT_THRESHOLD  → red heartbeat-glow badge, Hindi copy
 *
 * Sends a heartbeat every 15 s to keep the Redis session alive.
 * Polls the listener count every 30 s.
 */

import { useEffect, useRef, useState } from "react";
import { fetchListenerCount, sendHeartbeat } from "@/lib/api";

const HEARTBEAT_INTERVAL_MS = 15_000;
const POLL_INTERVAL_MS = 30_000;
const HOT_THRESHOLD = 50; // above this → red heartbeat mode

function getOrCreateSessionId(): string {
  const key = "chhath_radio_session_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

/** Modern gradient user avatar SVG — purple→red→orange gradient background */
function UserAvatarIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="lcBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8A2387" />
          <stop offset="50%" stopColor="#E94057" />
          <stop offset="100%" stopColor="#F27121" />
        </linearGradient>
        <linearGradient id="lcUserGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.75" />
        </linearGradient>
      </defs>
      {/* Rounded square background */}
      <rect x="8" y="8" width="112" height="112" rx="32" fill="url(#lcBgGrad)" />
      {/* User head */}
      <circle cx="64" cy="48" r="20" fill="url(#lcUserGrad)" />
      {/* User body / shoulders */}
      <path d="M28 102 C28 82, 44 76, 64 76 C84 76, 100 82, 100 102 Z" fill="url(#lcUserGrad)" />
    </svg>
  );
}

export default function ListenerCount() {
  const [count, setCount] = useState<number | null>(null);
  const [prevCount, setPrevCount] = useState<number | null>(null);
  const sessionId = useRef<string>("");

  useEffect(() => {
    sessionId.current = getOrCreateSessionId();

    sendHeartbeat(sessionId.current).catch(() => {});
    fetchListenerCount()
      .then((c) => { setCount(c); setPrevCount(c); })
      .catch(() => {});

    const heartbeatTimer = setInterval(() => {
      sendHeartbeat(sessionId.current).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    const pollTimer = setInterval(() => {
      fetchListenerCount()
        .then((c) => {
          setPrevCount((prev) => prev);
          setCount(c);
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(pollTimer);
    };
  }, []);

  if (count === null) return null;

  const isHot = count >= HOT_THRESHOLD;
  const formatted = formatCount(count);

  if (isHot) {
    return (
      <div
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-600/90 text-white font-semibold text-sm"
        aria-live="polite"
        aria-label={`${formatted} listeners right now`}
        style={{ animation: "heartbeat 1.4s ease-in-out infinite" }}
      >
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-200" />
        </span>
        <span>
          🔴 LIVE —{" "}
          <span className="font-bold tabular-nums">{formatted}</span>{" "}
          log sun rahe hain
        </span>
      </div>
    );
  }

  // Default: modern SVG icon with heartbeat pulse + 3D count + "online"
  return (
    <>
      <style>{`
        @keyframes listener-heartbeat {
          0%   { transform: scale(1);    }
          14%  { transform: scale(1.25); }
          28%  { transform: scale(1);    }
          42%  { transform: scale(1.18); }
          70%  { transform: scale(1);    }
          100% { transform: scale(1);    }
        }
        .listener-icon {
          display: inline-flex;
          animation: listener-heartbeat 1.6s ease-in-out infinite;
          transform-origin: center;
        }
        .listener-count-3d {
          background: linear-gradient(180deg, #fb923c 0%, #f97316 45%, #ea580c 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          filter: drop-shadow(0 1px 0 rgba(120,40,0,0.55)) drop-shadow(0 2px 4px rgba(0,0,0,0.35));
          font-weight: 800;
          letter-spacing: 0.02em;
        }
        .listener-online-label {
          background: linear-gradient(180deg, #fb923c 0%, #f97316 45%, #ea580c 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          filter: drop-shadow(0 1px 0 rgba(120,40,0,0.4));
          font-weight: 600;
          letter-spacing: 0.03em;
          opacity: 0.85;
        }
      `}</style>
      <div
        className="flex items-center gap-1.5"
        aria-live="polite"
        aria-label={`${formatted} listener${count !== 1 ? "s" : ""} online`}
      >
        <span className="listener-icon">
          <UserAvatarIcon size={22} />
        </span>
        <span className="listener-count-3d tabular-nums" style={{ fontSize: "0.85rem" }}>
          {formatted}
        </span>
        <span className="listener-online-label" style={{ fontSize: "0.72rem" }}>
          online
        </span>
      </div>
    </>
  );
}