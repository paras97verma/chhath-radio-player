/**
 * Media Session API Service
 *
 * Integrates the web player with the OS media notification and lock screen controls:
 * - Android: Persistent notification card with play/pause/prev/next & album art.
 * - iOS: Control Center & Lock Screen media player widget.
 * - Windows: System Media Transport Controls (SMTC) overlay & media keys.
 * - macOS: Now Playing menu bar & Touch Bar widget.
 */

import type { Song } from "./api";

export interface MediaSessionCallbacks {
  onPlay: () => Promise<void> | void;
  onPause: () => Promise<void> | void;
  onNext: () => Promise<void> | void;
  onPrev: () => Promise<void> | void;
  onSeekTo?: (time: number) => void;
  onSeekBack?: (offset: number) => void;
  onSeekFwd?: (offset: number) => void;
}

let registeredCallbacks: MediaSessionCallbacks | null = null;

export function isMediaSessionSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

/**
 * Register OS media action handlers (Lock screen, Control Center, Bluetooth controls).
 */
export function registerMediaSessionHandlers(callbacks: MediaSessionCallbacks): void {
  if (!isMediaSessionSupported()) return;
  registeredCallbacks = callbacks;

  const ms = navigator.mediaSession;

  const safeSetHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      // Action might not be supported on this browser version
    }
  };

  safeSetHandler("play", async () => {
    if (registeredCallbacks?.onPlay) {
      await registeredCallbacks.onPlay();
    }
  });

  safeSetHandler("pause", async () => {
    if (registeredCallbacks?.onPause) {
      await registeredCallbacks.onPause();
    }
  });

  safeSetHandler("previoustrack", async () => {
    if (registeredCallbacks?.onPrev) {
      await registeredCallbacks.onPrev();
    }
  });

  safeSetHandler("nexttrack", async () => {
    if (registeredCallbacks?.onNext) {
      await registeredCallbacks.onNext();
    }
  });

  safeSetHandler("stop", async () => {
    if (registeredCallbacks?.onPause) {
      await registeredCallbacks.onPause();
    }
  });

  safeSetHandler("seekto", (details) => {
    if (typeof details.seekTime === "number" && registeredCallbacks?.onSeekTo) {
      registeredCallbacks.onSeekTo(details.seekTime);
    }
  });

  // Only register relative skip buttons if explicitly requested.
  // When omitted (null), mobile OS lock screens (iOS/Android) display Previous (⏮) and Next (⏭) track buttons
  // instead of replacing them with 10s skip buttons.
  if (registeredCallbacks?.onSeekBack) {
    safeSetHandler("seekbackward", (details) => {
      const offset = details.seekOffset || 10;
      registeredCallbacks?.onSeekBack?.(offset);
    });
  } else {
    safeSetHandler("seekbackward", null);
  }

  if (registeredCallbacks?.onSeekFwd) {
    safeSetHandler("seekforward", (details) => {
      const offset = details.seekOffset || 10;
      registeredCallbacks?.onSeekFwd?.(offset);
    });
  } else {
    safeSetHandler("seekforward", null);
  }
}

/**
 * Update media metadata displayed on lock screens and notification centers.
 */
export function updateMediaSessionMetadata(song: Song | null, isPlaying = true): void {
  if (!isMediaSessionSupported()) return;

  const ms = navigator.mediaSession;

  if (!song) {
    ms.metadata = null;
    ms.playbackState = "none";
    return;
  }

  const videoId = song.youtube_video_id;
  const artwork = [
    {
      src: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
      sizes: "120x90",
      type: "image/jpeg",
    },
    {
      src: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      sizes: "320x180",
      type: "image/jpeg",
    },
    {
      src: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      sizes: "480x360",
      type: "image/jpeg",
    },
    {
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
    },
  ];

  try {
    ms.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist || "Chhath Radio",
      album: "Chhath Radio — छठ के गीत, बिना रुके 🪔",
      artwork,
    });
  } catch (err) {
    console.warn("[MediaSession] Error setting metadata:", err);
  }

  ms.playbackState = isPlaying ? "playing" : "paused";
}

/**
 * Update playback position state for scrubber display in lock screen / notifications.
 */
export function updateMediaSessionPositionState(currentTime: number, duration: number, playbackRate = 1): void {
  if (!isMediaSessionSupported()) return;
  const ms = navigator.mediaSession;

  if (
    "setPositionState" in ms &&
    typeof ms.setPositionState === "function" &&
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(currentTime) &&
    currentTime >= 0
  ) {
    try {
      const safeDuration = Math.max(0.1, duration);
      // WebKit throws if position > duration even by a fraction of a millisecond
      const safePosition = Math.min(Math.max(0, currentTime), safeDuration);
      ms.setPositionState({
        duration: safeDuration,
        playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
        position: safePosition,
      });
    } catch (err) {
      // Ignore invalid range or state errors gracefully
    }
  }
}

/**
 * Set the playbackState directly ("playing", "paused", "none").
 */
export function setMediaSessionPlaybackState(state: "playing" | "paused" | "none"): void {
  if (!isMediaSessionSupported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    /* ignore */
  }
}
