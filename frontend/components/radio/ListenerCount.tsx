"use client";

/**
 * ListenerCount — audio visualizer spectrogram with green online dot.
 *
 * Shows an animated spectrogram (6 bars), a green pulsing online dot,
 * the listener count, and the text "listening".
 *
 * Above HOT_THRESHOLD → red badge variant with same spectrogram.
 *
 * Sends a heartbeat every 15 s to keep the Redis session alive.
 * Uses SSE for real-time updates + polling fallback every 5 s.
 *
 * Race condition fix: sseConnected ref suppresses poll updates while SSE
 * is live, preventing stale poll results from overwriting fresh SSE data.
 * On SSE error, a heartbeat is sent immediately to keep the session alive
 * during the 3 s reconnect gap, so the count doesn't flicker down.
 */

import { useEffect, useRef, useState } from "react";
import { fetchListenerCount, sendHeartbeat } from "@/lib/api";

const HEARTBEAT_INTERVAL_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;
const SSE_RETRY_DELAY_MS = 3_000;
const HOT_THRESHOLD = 50;

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

/** Animated spectrogram — 6 bars with independent CSS keyframe animations */
function Spectrogram({ muted = false }: { muted?: boolean }) {
  const bars = [
    { height: 14, duration: "0.7s", delay: "0s" },
    { height: 20, duration: "0.9s", delay: "0.15s" },
    { height: 10, duration: "0.6s", delay: "0.05s" },
    { height: 18, duration: "1.1s", delay: "0.3s" },
    { height: 12, duration: "0.8s", delay: "0.2s" },
    { height: 16, duration: "0.75s", delay: "0.1s" },
  ];

  return (
    <>
      <style>{`
        @keyframes spec-bar {
          0%   { transform: scaleY(0.2); }
          50%  { transform: scaleY(1);   }
          100% { transform: scaleY(0.2); }
        }
        .spec-bar {
          transform-origin: bottom;
          border-radius: 1.5px;
          width: 3px;
        }
        .spec-bar-animated {
          animation: spec-bar var(--dur) ease-in-out var(--delay) infinite;
        }
      `}</style>
      <svg
        width="22"
        height="20"
        viewBox="0 0 22 20"
        aria-hidden="true"
        style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
      >
        {bars.map((bar, i) => (
          <rect
            key={i}
            className={`spec-bar ${muted ? "" : "spec-bar-animated"}`}
            x={i * 4}
            y={20 - bar.height}
            width={3}
            height={bar.height}
            rx={1.5}
            fill={muted ? "rgba(249,115,22,0.25)" : "#fb923c"}
            style={
              muted
                ? {}
                : ({
                    "--dur": bar.duration,
                    "--delay": bar.delay,
                  } as React.CSSProperties)
            }
          />
        ))}
      </svg>
    </>
  );
}

/** Green pulsing online dot */
function OnlineDot({ muted = false }: { muted?: boolean }) {
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden="true">
      {!muted && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex rounded-full h-2 w-2 ${
          muted ? "bg-green-900/40" : "bg-green-400"
        }`}
      />
    </span>
  );
}

interface ListenerCountProps {
  onCountChange?: (count: number) => void;
}

export default function ListenerCount({ onCountChange }: ListenerCountProps = {}) {
  const [count, setCount] = useState<number | null>(null);
  const sessionId = useRef<string>("");

  const updateCount = (c: number) => {
    setCount(c);
    onCountChange?.(c);
  };

  useEffect(() => {
    sessionId.current = getOrCreateSessionId();

    // Initial heartbeat + count fetch
    sendHeartbeat(sessionId.current).catch(() => {});
    fetchListenerCount()
      .then((c) => updateCount(c))
      .catch(() => updateCount(1));

    // Heartbeat timer — keeps the Redis session alive
    const heartbeatTimer = setInterval(() => {
      sendHeartbeat(sessionId.current).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    // SSE for real-time listener count updates
    let sse: EventSource | null = null;
    let sseRetryTimer: ReturnType<typeof setTimeout> | null = null;

    // sseConnected: true while SSE is live and delivering events.
    // The poll fallback checks this ref and discards its result while SSE
    // is connected, preventing stale poll data from overwriting fresh SSE data.
    const sseConnected = { current: false };

    function connectSSE() {
      try {
        sse = new EventSource(`/api/events?session_id=${sessionId.current}`);

        sse.addEventListener("listener_count", (e: MessageEvent) => {
          sseConnected.current = true;
          try {
            const data = JSON.parse(e.data);
            const c = typeof data.count === "number" ? data.count : data;
            updateCount(c);
          } catch { /* ignore parse errors */ }
        });

        sse.onerror = () => {
          sseConnected.current = false;
          sse?.close();
          sse = null;
          // Send a heartbeat immediately to keep the Redis session alive
          // during the reconnect gap — prevents the count from flickering down.
          sendHeartbeat(sessionId.current).catch(() => {});
          sseRetryTimer = setTimeout(connectSSE, SSE_RETRY_DELAY_MS);
        };
      } catch {
        // SSE not supported or blocked — fall back to polling only
        sseConnected.current = false;
      }
    }

    connectSSE();

    // Polling fallback — only updates count when SSE is not connected.
    // This prevents the race condition where a poll fires during the SSE
    // reconnect gap and overwrites the last good SSE count with a stale value.
    const pollTimer = setInterval(() => {
      if (sseConnected.current) return; // SSE is live — discard poll result
      fetchListenerCount()
        .then((c) => updateCount(c))
        .catch(() => {});
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(pollTimer);
      if (sseRetryTimer) clearTimeout(sseRetryTimer);
      sseConnected.current = false;
      sse?.close();
    };
  }, []);

  // Loading skeleton
  if (count === null) {
    return (
      <div
        className="flex items-center gap-1.5"
        aria-hidden="true"
        style={{
          background: "rgba(0,0,0,0.50)",
          border: "1px solid rgba(249,115,22,0.18)",
          borderRadius: "100px",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          padding: "4px 10px",
          opacity: 0.5,
        }}
      >
        <OnlineDot muted />
        <Spectrogram muted />
        <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.35)" }}>
          —
        </span>
        <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.3)" }}>
          listening
        </span>
      </div>
    );
  }

  const isHot = count >= HOT_THRESHOLD;
  const formatted = formatCount(count);

  if (isHot) {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-full text-white font-semibold text-sm"
        aria-live="polite"
        aria-label={`${formatted} people listening right now`}
        style={{
          background: "rgba(185,28,28,0.88)",
          border: "1px solid rgba(239,68,68,0.45)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          padding: "4px 12px",
        }}
      >
        <OnlineDot />
        <Spectrogram />
        <span className="tabular-nums font-bold">{formatted}</span>
        <span className="font-normal opacity-90">listening</span>
      </div>
    );
  }

  // Default: backdrop pill + green dot + spectrogram + count + "listening"
  return (
    <div
      className="inline-flex items-center gap-1.5"
      aria-live="polite"
      aria-label={`${formatted} ${count !== 1 ? "people" : "person"} listening`}
      style={{
        background: "rgba(0,0,0,0.52)",
        border: "1px solid rgba(249,115,22,0.22)",
        borderRadius: "100px",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        padding: "4px 10px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.45)",
      }}
    >
      <OnlineDot />
      <Spectrogram />
      <span
        className="tabular-nums"
        style={{
          fontSize: "0.85rem",
          fontWeight: 800,
          color: "#ffffff",
          textShadow: "0 1px 4px rgba(0,0,0,0.7)",
          letterSpacing: "0.02em",
        }}
      >
        {formatted}
      </span>
      <span
        style={{
          fontSize: "0.72rem",
          fontWeight: 500,
          color: "rgba(255,255,255,0.72)",
          letterSpacing: "0.03em",
        }}
      >
        listening
      </span>
    </div>
  );
}