"use client";

/**
 * GhatAmbience — Compact icon-only ambient sound toggle.
 *
 * Uses Web Audio API (fetch + AudioContext + decodeAudioData) instead of
 * new Audio() to avoid CSP media-src restrictions. Audio is fetched via
 * connect-src 'self' which is already in the CSP policy.
 *
 * Single button: click to play/pause ghat nature sounds.
 * Shows speaker icon (playing) or muted speaker icon (stopped).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { getTimeOfDay, type TimeOfDay } from "@/lib/time-of-day";

// ─── Sound layer definitions ──────────────────────────────────────────────────

interface SoundLayer {
  src: string;
  volume: number;
}

const SOUND_LAYERS: Record<TimeOfDay, SoundLayer[]> = {
  DAWN: [
    { src: "/sounds/river-flow.mp3",    volume: 0.5 },
    { src: "/sounds/birds-morning.mp3", volume: 0.7 },
    { src: "/sounds/conch-distant.mp3", volume: 0.4 },
    { src: "/sounds/ghanti-bell.mp3",   volume: 0.5 },
    { src: "/sounds/aarti-chant.mp3",   volume: 0.3 },
  ],
  MORNING: [
    { src: "/sounds/river-flow.mp3",    volume: 0.5 },
    { src: "/sounds/birds-morning.mp3", volume: 0.8 },
    { src: "/sounds/crowd-ghat.mp3",    volume: 0.2 },
    { src: "/sounds/ghanti-bell.mp3",   volume: 0.3 },
    { src: "/sounds/water-splash.mp3",  volume: 0.2 },
  ],
  AFTERNOON: [
    { src: "/sounds/river-flow.mp3",    volume: 0.6 },
    { src: "/sounds/birds-day.mp3",     volume: 0.4 },
    { src: "/sounds/wind-gentle.mp3",   volume: 0.3 },
    { src: "/sounds/water-splash.mp3",  volume: 0.2 },
    { src: "/sounds/aarti-chant.mp3",   volume: 0.2 },
  ],
  SUNSET: [
    { src: "/sounds/river-flow.mp3",    volume: 0.5 },
    { src: "/sounds/crickets.mp3",      volume: 0.4 },
    { src: "/sounds/conch-distant.mp3", volume: 0.5 },
    { src: "/sounds/crowd-ghat.mp3",    volume: 0.3 },
    { src: "/sounds/ghanti-bell.mp3",   volume: 0.6 },
    { src: "/sounds/diya-prayer.mp3",   volume: 0.3 },
  ],
  NIGHT: [
    { src: "/sounds/river-flow.mp3",    volume: 0.4 },
    { src: "/sounds/crickets.mp3",      volume: 0.7 },
    { src: "/sounds/wind-gentle.mp3",   volume: 0.3 },
    { src: "/sounds/water-splash.mp3",  volume: 0.2 },
    { src: "/sounds/diya-prayer.mp3",   volume: 0.4 },
  ],
};

// ─── Web Audio layer handle ───────────────────────────────────────────────────

interface AudioLayer {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GhatAmbience() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("MORNING");

  const ctxRef = useRef<AudioContext | null>(null);
  const layersRef = useRef<AudioLayer[]>([]);
  // Cache decoded buffers so subsequent plays are instant
  const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());

  // Detect time of day on mount and every minute
  useEffect(() => {
    function update() {
      setTimeOfDay(getTimeOfDay(new Date()).state);
    }
    update();
    const t = setInterval(update, 60_000);
    return () => clearInterval(t);
  }, []);

  // stopAll as a stable callback so cleanup effects always get the current version
  const stopAll = useCallback(() => {
    layersRef.current.forEach(({ source, gain }) => {
      try {
        gain.gain.setValueAtTime(0, ctxRef.current?.currentTime ?? 0);
        source.stop();
        source.disconnect();
        gain.disconnect();
      } catch {
        // already stopped
      }
    });
    layersRef.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
      ctxRef.current?.close().catch(() => {});
    };
  }, [stopAll]);

  async function fetchAndDecode(ctx: AudioContext, src: string): Promise<AudioBuffer> {
    const cached = bufferCacheRef.current.get(src);
    if (cached) return cached;

    const response = await fetch(src);
    if (!response.ok) throw new Error(`Failed to fetch ${src}: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    bufferCacheRef.current.set(src, audioBuffer);
    return audioBuffer;
  }

  async function handleToggle() {
    if (isPlaying) {
      stopAll();
      setIsPlaying(false);
      return;
    }

    // IMPORTANT: AudioContext MUST be created/resumed synchronously inside the
    // click handler — before any await — otherwise the browser revokes the user
    // gesture context and the AudioContext stays suspended or throws NotAllowedError.
    let ctx: AudioContext;
    try {
      if (!ctxRef.current || ctxRef.current.state === "closed") {
        ctxRef.current = new AudioContext();
      }
      ctx = ctxRef.current;
      // resume() must be awaited — sources started into a suspended context produce silence.
      // Awaiting ctx.resume() is safe here: the user gesture is already captured by the
      // synchronous new AudioContext() call above, and browsers whitelist ctx.resume() for await.
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
    } catch (err) {
      console.error("[GhatAmbience] AudioContext creation/resume failed:", err);
      return;
    }

    // Guard: if context still isn't running after resume, bail out
    if (ctxRef.current?.state !== "running") {
      console.warn("[GhatAmbience] AudioContext not running after resume, aborting");
      return;
    }

    setIsLoading(true);

    try {
      const layers = SOUND_LAYERS[timeOfDay];
      const masterVolume = 0.65;

      // Fetch and decode all layers in parallel; skip any that fail to load
      const results = await Promise.allSettled(
        layers.map((layer) => fetchAndDecode(ctx, layer.src))
      );

      // Create and connect source nodes for successfully loaded buffers
      const newLayers: AudioLayer[] = [];
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          console.warn(`[GhatAmbience] Skipping ${layers[i].src}:`, result.reason);
          return;
        }
        const buffer = result.value;
        const layer = layers[i];
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const gain = ctx.createGain();
        gain.gain.value = Math.min(1, masterVolume * layer.volume);

        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0);

        newLayers.push({ source, gain });
      });

      if (newLayers.length === 0) {
        throw new Error("No audio layers could be loaded");
      }

      layersRef.current = newLayers;
      setIsPlaying(true);
    } catch (err) {
      console.error("[GhatAmbience] Failed to start audio:", err);
      stopAll();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isLoading}
      aria-label={isPlaying ? "Mute ghat ambience sounds" : "Play ghat ambience sounds"}
      title={isPlaying ? "Mute ghat sounds" : "Play ghat sounds"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: 36,
        padding: "0 12px",
        borderRadius: 9999,
        cursor: isLoading ? "wait" : "pointer",
        transition: "all 0.2s ease",
        background: isPlaying
          ? "rgba(249,115,22,0.18)"
          : "rgba(255,255,255,0.06)",
        border: `1px solid ${isPlaying ? "rgba(249,115,22,0.55)" : "rgba(255,255,255,0.15)"}`,
        color: isPlaying ? "#f97316" : "rgba(255,255,255,0.5)",
        boxShadow: isPlaying ? "0 0 12px rgba(249,115,22,0.25)" : "none",
        outline: "none",
        flexShrink: 0,
        opacity: isLoading ? 0.6 : 1,
      }}
    >
      {isLoading ? (
        /* Loading spinner */
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: 18, height: 18, animation: "spin 1s linear infinite" }}
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : isPlaying ? (
        /* Speaker with waves — playing */
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: 18, height: 18 }}
          aria-hidden="true"
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      ) : (
        /* Speaker muted — stopped */
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: 18, height: 18 }}
          aria-hidden="true"
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      )}
      <span style={{ fontSize: "0.75rem", fontWeight: 500, letterSpacing: "0.01em" }}>
        {isLoading ? "Loading…" : isPlaying ? "Ghat ON" : "Ghat sounds"}
      </span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}