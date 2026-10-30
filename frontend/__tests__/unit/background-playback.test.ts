/**
 * Unit tests for background playback modules:
 * - wake-lock.ts
 * - audio-keep-alive.ts
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
  startAudioKeepAlive,
  stopAudioKeepAlive,
  isAudioKeepAliveRunning,
} from "../../lib/audio-keep-alive";
import {
  isMediaSessionSupported,
  updateMediaSessionMetadata,
  registerMediaSessionHandlers,
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

describe("AudioKeepAlive Module", () => {
  afterEach(() => {
    stopAudioKeepAlive();
  });

  it("toggles keep-alive running state", async () => {
    expect(isAudioKeepAliveRunning()).toBe(false);

    await startAudioKeepAlive();
    expect(isAudioKeepAliveRunning()).toBe(true);

    stopAudioKeepAlive();
    expect(isAudioKeepAliveRunning()).toBe(false);
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

  it("can register action handlers without errors", () => {
    expect(() => {
      registerMediaSessionHandlers({
        onPlay: vi.fn(),
        onPause: vi.fn(),
        onNext: vi.fn(),
        onPrev: vi.fn(),
      });
    }).not.toThrow();
  });

  it("can update metadata with a valid song and null", () => {
    expect(() => updateMediaSessionMetadata(dummySong, true)).not.toThrow();
    expect(() => updateMediaSessionMetadata(null, false)).not.toThrow();
  });

  it("can set playback state without errors", () => {
    expect(() => setMediaSessionPlaybackState("playing")).not.toThrow();
    expect(() => setMediaSessionPlaybackState("paused")).not.toThrow();
    expect(() => setMediaSessionPlaybackState("none")).not.toThrow();
  });
});

