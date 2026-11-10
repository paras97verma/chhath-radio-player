/**
 * Unit tests for background playback modules:
 * - wake-lock.ts
 * - media-session.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isWakeLockSupported,
  isWakeLockActive,
  isWakeLockEnabled,
  setWakeLockEnabled,
  requestWakeLock,
  releaseWakeLock,
  onPlaybackStateChange,
} from "../../lib/wake-lock";
import {
  isMediaSessionSupported,
  updateMediaSessionMetadata,
  registerMediaSessionHandlers,
  reassertMediaSessionHandlers,
  setMediaSessionPlaybackState,
} from "../../lib/media-session";
import type { Song } from "../../lib/api";

describe("WakeLock Module", () => {
  beforeEach(() => {
    setWakeLockEnabled(true);
  });

  afterEach(async () => {
    await releaseWakeLock();
  });

  it("reports support based on navigator.wakeLock", () => {
    expect(typeof isWakeLockSupported()).toBe("boolean");
  });

  it("can toggle enabled state", () => {
    setWakeLockEnabled(false);
    expect(isWakeLockEnabled()).toBe(false);

    setWakeLockEnabled(true);
    expect(isWakeLockEnabled()).toBe(true);
  });

  it("handles playback state changes without throwing", () => {
    expect(() => onPlaybackStateChange(true)).not.toThrow();
    expect(() => onPlaybackStateChange(false)).not.toThrow();
  });
});

describe("MediaSession Module", () => {
  const dummySong: Song = {
    id: "test-id",
    title: "Kaanch Hi Baans",
    artist: "Sharda Sinha",
    youtube_video_id: "dQw4w9WgXcQ",
    youtube_url: null,
    category: "chhath",
    enabled: true,
    sort_order: 1,
  };

  it("reports support based on navigator.mediaSession", () => {
    expect(typeof isMediaSessionSupported()).toBe("boolean");
  });

  it("can register action handlers without errors and disables relative skips", () => {
    const fakeMediaSession = {
      setActionHandler: vi.fn(),
      metadata: null,
      playbackState: "none",
    };
    Object.defineProperty(navigator, "mediaSession", {
      value: fakeMediaSession,
      configurable: true,
      writable: true,
    });

    const setActionHandlerSpy = vi.spyOn(navigator.mediaSession, "setActionHandler");

    const onSeekBackward = vi.fn();
    const onSeekForward = vi.fn();

    expect(() => {
      registerMediaSessionHandlers({
        onPlay: vi.fn(),
        onPause: vi.fn(),
        onNext: vi.fn(),
        onPrev: vi.fn(),
        onSeekBackward,
        onSeekForward,
      });
    }).not.toThrow();

    expect(setActionHandlerSpy).toHaveBeenCalledWith("previoustrack", expect.any(Function));
    expect(setActionHandlerSpy).toHaveBeenCalledWith("nexttrack", expect.any(Function));
    expect(setActionHandlerSpy).toHaveBeenCalledWith("seekbackward", expect.any(Function));
    expect(setActionHandlerSpy).toHaveBeenCalledWith("seekforward", expect.any(Function));

    expect(() => reassertMediaSessionHandlers()).not.toThrow();
  });

  it("disables seekbackward and seekforward on iOS to preserve track skip buttons", () => {
    const originalUA = navigator.userAgent;
    try {
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
        configurable: true,
      });

      const setActionHandlerSpy = vi.spyOn(navigator.mediaSession, "setActionHandler");
      reassertMediaSessionHandlers();

      expect(setActionHandlerSpy).toHaveBeenCalledWith("seekbackward", null);
      expect(setActionHandlerSpy).toHaveBeenCalledWith("seekforward", null);
      expect(setActionHandlerSpy).toHaveBeenCalledWith("previoustrack", expect.any(Function));
      expect(setActionHandlerSpy).toHaveBeenCalledWith("nexttrack", expect.any(Function));
    } finally {
      Object.defineProperty(navigator, "userAgent", {
        value: originalUA,
        configurable: true,
      });
    }
  });

  it("keeps Android previous/next controls and routes transport and scrubber actions", async () => {
    const originalUA = navigator.userAgent;
    const fakeMediaSession = {
      setActionHandler: vi.fn(),
      metadata: null,
      playbackState: "none",
    };
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const onSeekTo = vi.fn();
    try {
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile",
        configurable: true,
      });
      Object.defineProperty(navigator, "mediaSession", {
        value: fakeMediaSession,
        configurable: true,
        writable: true,
      });

      registerMediaSessionHandlers({
        onPlay,
        onPause,
        onNext,
        onPrev,
        onSeekTo,
        onSeekBackward: vi.fn(),
        onSeekForward: vi.fn(),
      });

      const action = (name: string) =>
        fakeMediaSession.setActionHandler.mock.calls.find(([registered]) => registered === name)?.[1];

      expect(action("previoustrack")).toEqual(expect.any(Function));
      expect(action("nexttrack")).toEqual(expect.any(Function));
      expect(action("seekto")).toEqual(expect.any(Function));
      expect(action("seekbackward")).toBeNull();
      expect(action("seekforward")).toBeNull();

      await action("play")?.({});
      await action("pause")?.({});
      await action("previoustrack")?.({});
      await action("nexttrack")?.({});
      action("seekto")?.({ seekTime: 42 });
      expect(onPlay).toHaveBeenCalledOnce();
      expect(onPause).toHaveBeenCalledOnce();
      expect(onPrev).toHaveBeenCalledOnce();
      expect(onNext).toHaveBeenCalledOnce();
      expect(onSeekTo).toHaveBeenCalledWith(42);
    } finally {
      Object.defineProperty(navigator, "userAgent", {
        value: originalUA,
        configurable: true,
      });
    }
  });

  it("can update metadata with a valid song and null", () => {
    expect(() => updateMediaSessionMetadata(dummySong, true)).not.toThrow();
    expect(() => updateMediaSessionMetadata(null, false)).not.toThrow();
  });

  it("uses the song's thumbnail for artwork and never substitutes the app icon", () => {
    let capturedInit: any = null;
    (globalThis as any).MediaMetadata = class MockMediaMetadata {
      constructor(init?: any) {
        capturedInit = init || null;
      }
    };

    updateMediaSessionMetadata(dummySong, true);

    expect(capturedInit).not.toBeNull();
    const artwork = (capturedInit?.artwork as any[]) || [];
    expect(artwork.length).toBeGreaterThan(0);
    // Every artwork entry must point to the song's thumbnail or proxy, NOT the app icon
    for (const img of artwork) {
      expect(img.src).toContain(dummySong.youtube_video_id);
      expect(img.src).not.toContain("icon-512.png");
      expect(img.src).not.toContain("icon-192.png");
    }
  });

  it("can set playback state without errors", () => {
    expect(() => setMediaSessionPlaybackState("playing")).not.toThrow();
    expect(() => setMediaSessionPlaybackState("paused")).not.toThrow();
    expect(() => setMediaSessionPlaybackState("none")).not.toThrow();
  });
});

