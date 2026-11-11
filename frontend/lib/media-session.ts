/**
 * Media Session API Service
 *
 * Integrates the web player with the OS media notification and lock screen controls:
 * - Android: Persistent notification card with play/pause/prev/next, scrubber & album art.
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
  onSeekBackward?: (offset: number) => void;
  onSeekForward?: (offset: number) => void;
}

let registeredCallbacks: MediaSessionCallbacks | null = null;

function dispatchMediaSessionAction(
  callback: (() => Promise<void> | void) | undefined,
): void {
  if (!callback) return;

  try {
    const result = callback();
    if (result && typeof result.then === "function") {
      void Promise.resolve(result).catch((error) => {
        console.warn(
          "[MediaSession] Action failed:",
          error instanceof Error ? error.name : "UnknownError",
        );
      });
    }
  } catch (error) {
    console.warn(
      "[MediaSession] Action failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
  }
}

export function isMediaSessionSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && typeof document !== "undefined" && "ontouchend" in document);
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || isIosDevice();
}

/**
 * Re-assert OS media action handlers (Lock screen, Control Center, Bluetooth controls).
 * Mobile exposes play, pause, prev, next, stop, and seekto. Relative-seek actions compete
 * with track buttons in mobile system UIs, so scrubbing uses the position bar instead.
 */
export function reassertMediaSessionHandlers(): void {
  if (!isMediaSessionSupported() || !registeredCallbacks) return;

  const ms = navigator.mediaSession;
  const isMobile = isMobileDevice();

  const safeSetHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      // Action might not be supported on this browser version
    }
  };

  safeSetHandler("play", () => dispatchMediaSessionAction(registeredCallbacks?.onPlay));

  safeSetHandler("pause", () => dispatchMediaSessionAction(registeredCallbacks?.onPause));

  safeSetHandler("previoustrack", () => dispatchMediaSessionAction(registeredCallbacks?.onPrev));

  safeSetHandler("nexttrack", () => dispatchMediaSessionAction(registeredCallbacks?.onNext));

  safeSetHandler("stop", () => dispatchMediaSessionAction(registeredCallbacks?.onPause));

  safeSetHandler("seekto", (details) => {
    if (typeof details.seekTime === "number" && registeredCallbacks?.onSeekTo) {
      registeredCallbacks.onSeekTo(details.seekTime);
    }
  });

  if (isMobile) {
    // Keep mobile transport controls consistent: use the scrubber for seeking and reserve
    // the transport slots for Previous/Next instead of relative-seek buttons.
    safeSetHandler("seekbackward", null);
    safeSetHandler("seekforward", null);
  } else {
    // Android, Windows SMTC, macOS, Linux: Support fast-seeking in notification and headsets
    safeSetHandler("seekbackward", (details) => {
      const offset = details.seekOffset || 10;
      if (registeredCallbacks?.onSeekBackward) {
        registeredCallbacks.onSeekBackward(offset);
      }
    });

    safeSetHandler("seekforward", (details) => {
      const offset = details.seekOffset || 10;
      if (registeredCallbacks?.onSeekForward) {
        registeredCallbacks.onSeekForward(offset);
      }
    });
  }
}

/**
 * Register OS media action handlers (Lock screen, Control Center, Bluetooth controls).
 */
export function registerMediaSessionHandlers(callbacks: MediaSessionCallbacks): void {
  if (!isMediaSessionSupported()) return;
  registeredCallbacks = callbacks;
  reassertMediaSessionHandlers();
}

/**
 * Update media metadata displayed on lock screens and notification centers.
 */
export function updateMediaSessionMetadata(
  song: Song | null,
  isPlaying = true,
  duration?: number,
  currentTime?: number
): void {
  if (!isMediaSessionSupported()) return;

  const ms = navigator.mediaSession;

  if (!song) {
    ms.metadata = null;
    ms.playbackState = "none";
    return;
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const videoId = song.youtube_video_id;

  // Use the same-origin proxy so mobile platform surfaces and the player share one
  // cacheable source. The endpoint returns a landscape thumbnail, so omit `sizes`
  // instead of claiming it is several different square assets.
  const artworkUrl = origin
    ? `${origin}/yt-thumb?v=${encodeURIComponent(videoId)}`
    : `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  const artwork: MediaImage[] = [{ src: artworkUrl, type: "image/jpeg" }];

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

  // Re-assert action handlers whenever metadata updates so WebKit/iOS Lock Screen
  // binds previoustrack and nexttrack to the newly active media item
  reassertMediaSessionHandlers();

  // If duration is provided, update position state immediately so Android notification
  // instantly renders the seekbar without awaiting animation frame cycles
  if (typeof duration === "number" && duration > 0) {
    updateMediaSessionPositionState(currentTime ?? 0, duration, isPlaying ? 1 : 0);
  }
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
