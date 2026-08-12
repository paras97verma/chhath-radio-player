/**
 * Unit tests for the Radio Queue Controller (Zustand store).
 * Uses MockYouTubePlayerAdapter to avoid any real YouTube API calls.
 *
 * Tests cover:
 * - Phase 4.2: Auto-progression when a song ends
 * - Phase 4.3: Error recovery (skip broken video)
 * - Phase 4.4: Session guard (stale events ignored)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockYouTubePlayerAdapter } from "@/lib/youtube-adapter";
import { useRadioStore } from "@/lib/radio-store";
import type { Song } from "@/lib/api";

function makeSong(id: string, title: string): Song {
  return {
    id,
    title,
    artist: "Test Artist",
    youtube_video_id: `vid_${id}`,
    youtube_url: null,
    category: null,
    enabled: true,
    sort_order: 0,
  };
}

const SONGS: Song[] = [
  makeSong("1", "Song One"),
  makeSong("2", "Song Two"),
  makeSong("3", "Song Three"),
];

describe("RadioStore", () => {
  let adapter: MockYouTubePlayerAdapter;

  beforeEach(async () => {
    // Reset the store to initial state before each test
    useRadioStore.setState({
      queue: [],
      currentIndex: 0,
      playState: "IDLE",
      adapter: null,
    });

    adapter = new MockYouTubePlayerAdapter();
    await useRadioStore.getState().loadQueue(SONGS, adapter);
  });

  it("loads the queue and sets currentIndex to 0", () => {
    const state = useRadioStore.getState();
    expect(state.queue).toHaveLength(3);
    expect(state.currentIndex).toBe(0);
    expect(state.playState).toBe("IDLE");
  });

  it("currentSong() returns the first song after loading", () => {
    const song = useRadioStore.getState().currentSong();
    expect(song?.title).toBe("Song One");
  });

  it("upNextSongs() returns the next 2 songs", () => {
    const upNext = useRadioStore.getState().upNextSongs(2);
    expect(upNext).toHaveLength(2);
    expect(upNext[0].title).toBe("Song Two");
    expect(upNext[1].title).toBe("Song Three");
  });

  it("Phase 4.2: auto-progresses to next song when ENDED fires", async () => {
    const sessionId = useRadioStore.getState().radioSessionId;
    await useRadioStore.getState().handleAdapterStateChange("ENDED", sessionId);

    const state = useRadioStore.getState();
    expect(state.currentIndex).toBe(1);
    expect(adapter.currentVideoId).toBe("vid_2");
  });

  it("Phase 4.2: wraps to index 0 when last song ends", async () => {
    // Move to last song
    useRadioStore.setState({ currentIndex: 2 });
    const sessionId = useRadioStore.getState().radioSessionId;
    await useRadioStore.getState().handleAdapterStateChange("ENDED", sessionId);

    const state = useRadioStore.getState();
    expect(state.currentIndex).toBe(0);
    expect(state.playState).toBe("IDLE");
  });

  it("Phase 4.3: skips to next song on ERROR", async () => {
    const sessionId = useRadioStore.getState().radioSessionId;
    await useRadioStore.getState().handleAdapterStateChange("ERROR" as never, sessionId);

    const state = useRadioStore.getState();
    expect(state.currentIndex).toBe(1);
    expect(adapter.currentVideoId).toBe("vid_2");
  });

  it("Phase 4.4: ignores state changes from a stale session", async () => {
    const staleSessionId = "old-session-id-that-does-not-match";
    await useRadioStore.getState().handleAdapterStateChange("ENDED", staleSessionId);

    // Index should NOT have changed
    expect(useRadioStore.getState().currentIndex).toBe(0);
  });

  it("pausePlayback sets playState to PAUSED", async () => {
    await useRadioStore.getState().pausePlayback();
    expect(useRadioStore.getState().playState).toBe("PAUSED");
  });
});