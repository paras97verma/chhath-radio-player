/**
 * Screen Wake Lock API Manager
 *
 * Keeps the device screen awake while radio is actively playing so that
 * the phone does not automatically go to sleep after 30-60s of inactivity.
 * Supported in Chrome, Edge, Safari 16.4+ (iOS 16.4+ / macOS 13.3+).
 */

type WakeLockSentinel = EventTarget & {
  released: boolean;
  type: "screen";
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
  removeEventListener: (type: "release", listener: () => void) => void;
};

let activeWakeLock: WakeLockSentinel | null = null;
let isEnabled = true;
let isPlayingTrack = false;
const listeners = new Set<(active: boolean) => void>();

function notifyListeners() {
  const active = !!activeWakeLock && !activeWakeLock.released;
  listeners.forEach((cb) => {
    try {
      cb(active);
    } catch {
      /* ignore */
    }
  });
}

export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export function isWakeLockActive(): boolean {
  return !!activeWakeLock && !activeWakeLock.released;
}

export function isWakeLockEnabled(): boolean {
  return isEnabled;
}

export function setWakeLockEnabled(enabled: boolean): void {
  isEnabled = enabled;
  if (!enabled) {
    releaseWakeLock();
  } else if (isPlayingTrack) {
    requestWakeLock();
  }
}

export function subscribeWakeLock(callback: (active: boolean) => void): () => void {
  listeners.add(callback);
  callback(isWakeLockActive());
  return () => {
    listeners.delete(callback);
  };
}

export async function requestWakeLock(): Promise<boolean> {
  if (!isEnabled || !isWakeLockSupported()) return false;
  if (activeWakeLock && !activeWakeLock.released) return true;

  try {
    const nav = navigator as unknown as {
      wakeLock: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    const sentinel = await nav.wakeLock.request("screen");
    activeWakeLock = sentinel;

    sentinel.addEventListener("release", () => {
      if (activeWakeLock === sentinel) {
        activeWakeLock = null;
      }
      notifyListeners();
    });

    notifyListeners();
    return true;
  } catch (err) {
    console.warn("[WakeLock] Could not acquire wake lock:", err);
    activeWakeLock = null;
    notifyListeners();
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (activeWakeLock && !activeWakeLock.released) {
    try {
      await activeWakeLock.release();
    } catch {
      /* ignore */
    }
    activeWakeLock = null;
    notifyListeners();
  }
}

/**
 * Notify the wake lock manager about playback state changes.
 */
export function onPlaybackStateChange(isPlaying: boolean): void {
  isPlayingTrack = isPlaying;
  if (isPlaying) {
    requestWakeLock();
  } else {
    releaseWakeLock();
  }
}

// Re-acquire wake lock when the page returns to visible state (if playing)
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isPlayingTrack && isEnabled) {
      requestWakeLock();
    }
  });
}
