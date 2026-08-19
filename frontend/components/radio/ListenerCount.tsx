"use client";

/**
 * ListenerCount — Animated spectrogram + green dot + listener count.
 * Neumorphic pill design.
 *
 * - SSE for real-time updates + polling fallback every 5s
 * - Heartbeat every 15s to keep Redis session alive
 * - HOT_THRESHOLD (50+) → red variant
 */

import { useEffect, useRef, useState } from "react";
import { fetchListenerCount, sendHeartbeat } from "@/lib/api";
import { getOrCreateSessionId } from "@/lib/session";

const HEARTBEAT_INTERVAL_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;
const SSE_RETRY_DELAY_MS = 3_000;
const HOT_THRESHOLD = 50;

const NM_PILL = "6px 6px 18px rgba(0,0,0,0.82), -3px -3px 10px rgba(90,40,15,0.22), inset 0 1px 0 rgba(254,215,170,0.12)";
const NM_HOT  = "6px 6px 18px rgba(0,0,0,0.85), -3px -3px 10px rgba(160,30,20,0.25), inset 0 1px 0 rgba(254,215,170,0.12)";

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

/** Animated spectrogram — 6 bars */
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
          fill={muted ? "rgba(249,115,22,0.20)" : "#fb923c"}
          style={muted ? {} : ({ "--dur": bar.duration, "--delay": bar.delay } as React.CSSProperties)}
        />
      ))}
    </svg>
  );
}

/** Green pulsing online dot */
function OnlineDot({ muted = false }: { muted?: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      {!muted && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${muted ? "bg-green-900/40" : "bg-green-400"}`} />
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

    sendHeartbeat(sessionId.current).catch(() => {});
    fetchListenerCount().then((c) => updateCount(c)).catch(() => updateCount(1));

    const heartbeatTimer = setInterval(() => {
      sendHeartbeat(sessionId.current).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    let sse: EventSource | null = null;
    let sseRetryTimer: ReturnType<typeof setTimeout> | null = null;
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
          } catch { /* ignore */ }
        });
        sse.onerror = () => {
          sseConnected.current = false;
          sse?.close();
          sse = null;
          sendHeartbeat(sessionId.current).catch(() => {});
          sseRetryTimer = setTimeout(connectSSE, SSE_RETRY_DELAY_MS);
        };
      } catch { sseConnected.current = false; }
    }

    connectSSE();

    const pollTimer = setInterval(() => {
      if (sseConnected.current) return;
      fetchListenerCount().then((c) => updateCount(c)).catch(() => {});
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
        className="flex items-center gap-1.5 opacity-50 rounded-full px-2.5 py-1"
        style={{ background: "rgba(15,8,4,0.88)", boxShadow: NM_PILL }}
        aria-hidden="true"
      >
        <OnlineDot muted />
        <Spectrogram muted />
        <span className="text-sm text-white/30">—</span>
        <span className="text-[11px] text-white/25">listening</span>
      </div>
    );
  }

  const isHot = count >= HOT_THRESHOLD;
  const formatted = formatCount(count);

  if (isHot) {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-white font-semibold text-sm"
        style={{ background: "rgba(30,8,8,0.92)", boxShadow: NM_HOT }}
        aria-live="polite"
        aria-label={`${formatted} people listening right now`}
      >
        <OnlineDot />
        <Spectrogram />
        <span className="tabular-nums font-bold">{formatted}</span>
        <span className="font-normal opacity-90">listening</span>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 border"
      style={{
        background: "rgba(14,7,4,0.82)",
        borderColor: "rgba(251,146,60,0.16)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.60), inset 0 1px 0 rgba(255,255,255,0.08)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
      aria-live="polite"
      aria-label={`${formatted} ${count !== 1 ? "people" : "person"} listening`}
    >
      <OnlineDot />
      <Spectrogram />
      <span
        className="tabular-nums text-xs font-bold text-[#fff7ed] tracking-wide"
      >
        {formatted}
      </span>
      <span className="text-[11px] font-medium text-amber-200/60 tracking-wide">listening</span>
    </div>
  );
}