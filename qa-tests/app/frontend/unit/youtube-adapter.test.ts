/**
 * Unit tests for MockYouTubePlayerAdapter in lib/youtube-adapter.ts.
 * Verifies the mock's behavior used in all radio store tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockYouTubePlayerAdapter, YT_UNPLAYABLE_ERRORS } from "@/lib/youtube-adapter";
import type { PlayerState } from "@/lib/youtube-adapter";

describe("MockYouTubePlayerAdapter", () => {
  let adapter: MockYouTubePlayerAdapter;

  beforeEach(() => {
    adapter = new MockYouTubePlayerAdapter();
  });

  // ── initialize ──────────────────────────────────────────────────────────────

  it("initialize sets initializeCalled to true", async () => {
    const container = document.createElement("div");
    await adapter.initialize(container, "dQw4w9WgXcQ");
    expect(adapter.initializeCalled).toBe(true);
  });

  it("initialize stores the videoId", async () => {
    const container = document.createElement("div");
    await adapter.initialize(container, "dQw4w9WgXcQ");
    expect(adapter.currentVideoId).toBe("dQw4w9WgXcQ");
  });

  // ── loadVideo ───────────────────────────────────────────────────────────────

  it("loadVideo updates currentVideoId", async () => {
    await adapter.loadVideo("newVideoId11");
    expect(adapter.currentVideoId).toBe("newVideoId11");
  });

  it("loadVideo emits PLAYING state to listeners", async () => {
    const states: PlayerState[] = [];
    adapter.onStateChange((s) => states.push(s));
    await adapter.loadVideo("dQw4w9WgXcQ");
    expect(states).toContain("PLAYING");
  });

  // ── play ────────────────────────────────────────────────────────────────────

  it("play emits PLAYING state", async () => {
    const states: PlayerState[] = [];
    adapter.onStateChange((s) => states.push(s));
    await adapter.play();
    expect(states).toContain("PLAYING");
  });

  it("play updates internal state to PLAYING", async () => {
    await adapter.play();
    expect(adapter.getState()).toBe("PLAYING");
  });

  // ── pause ───────────────────────────────────────────────────────────────────

  it("pause emits PAUSED state", async () => {
    const states: PlayerState[] = [];
    adapter.onStateChange((s) => states.push(s));
    await adapter.pause();
    expect(states).toContain("PAUSED");
  });

  it("pause updates internal state to PAUSED", async () => {
    await adapter.pause();
    expect(adapter.getState()).toBe("PAUSED");
  });

  // ── getState ────────────────────────────────────────────────────────────────

  it("initial state is UNSTARTED", () => {
    expect(adapter.getState()).toBe("UNSTARTED");
  });

  // ── onStateChange / unsubscribe ─────────────────────────────────────────────

  it("onStateChange returns an unsubscribe function", () => {
    const unsubscribe = adapter.onStateChange(() => {});
    expect(typeof unsubscribe).toBe("function");
  });

  it("unsubscribe prevents further callbacks", async () => {
    const states: PlayerState[] = [];
    const unsubscribe = adapter.onStateChange((s) => states.push(s));
    unsubscribe();
    await adapter.play();
    expect(states).toHaveLength(0);
  });

  it("multiple listeners all receive state changes", async () => {
    const states1: PlayerState[] = [];
    const states2: PlayerState[] = [];
    adapter.onStateChange((s) => states1.push(s));
    adapter.onStateChange((s) => states2.push(s));
    await adapter.play();
    expect(states1).toContain("PLAYING");
    expect(states2).toContain("PLAYING");
  });

  // ── simulateSongEnd ─────────────────────────────────────────────────────────

  it("simulateSongEnd emits ENDED state", () => {
    const states: PlayerState[] = [];
    adapter.onStateChange((s) => states.push(s));
    adapter.simulateSongEnd();
    expect(states).toContain("ENDED");
  });

  it("simulateSongEnd updates internal state to ENDED", () => {
    adapter.simulateSongEnd();
    expect(adapter.getState()).toBe("ENDED");
  });

  // ── simulateError ───────────────────────────────────────────────────────────

  it("simulateError emits ERROR state", () => {
    const states: PlayerState[] = [];
    adapter.onStateChange((s) => states.push(s));
    adapter.simulateError();
    expect(states).toContain("ERROR");
  });

  it("simulateError updates internal state to ERROR", () => {
    adapter.simulateError();
    expect(adapter.getState()).toBe("ERROR");
  });

  // ── destroy ─────────────────────────────────────────────────────────────────

  it("destroy sets destroyCalled to true", () => {
    adapter.destroy();
    expect(adapter.destroyCalled).toBe(true);
  });

  it("destroy clears all state listeners", async () => {
    const states: PlayerState[] = [];
    adapter.onStateChange((s) => states.push(s));
    adapter.destroy();
    await adapter.play();
    // After destroy, listeners are cleared — but play() still emits internally
    // The key is that the cleared listeners don't receive the event
    expect(states).toHaveLength(0);
  });
});

// ─── YT_UNPLAYABLE_ERRORS ─────────────────────────────────────────────────────

describe("YT_UNPLAYABLE_ERRORS", () => {
  it("contains error code 2 (invalid parameter)", () => {
    expect(YT_UNPLAYABLE_ERRORS.has(2)).toBe(true);
  });

  it("contains error code 5 (HTML5 player error)", () => {
    expect(YT_UNPLAYABLE_ERRORS.has(5)).toBe(true);
  });

  it("contains error code 100 (video not found)", () => {
    expect(YT_UNPLAYABLE_ERRORS.has(100)).toBe(true);
  });

  it("contains error code 101 (embedding not allowed)", () => {
    expect(YT_UNPLAYABLE_ERRORS.has(101)).toBe(true);
  });

  it("contains error code 150 (embedding not allowed variant)", () => {
    expect(YT_UNPLAYABLE_ERRORS.has(150)).toBe(true);
  });

  it("does not contain error code 0 (ended — not an error)", () => {
    expect(YT_UNPLAYABLE_ERRORS.has(0)).toBe(false);
  });
});