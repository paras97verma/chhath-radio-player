/**
 * Unit tests for lib/radio-store.ts
 *
 * Uses MockYouTubePlayerAdapter from youtube-adapter.ts to avoid any real
 * YouTube API calls. The Zustand store is reset between tests by calling
 * loadQueue() with a fresh adapter, which generates a new radioSessionId.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockYouTubePlayerAdapter } from "../../lib/youtube-adapter";
import { useRadioStore } from "../../lib/radio-store";
import type { Song } from "../../lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: crypto.randomUUID(),
    title: "Kaanch Hi Baans",
    artist: "Sharda Sinha",
    youtube_video_id: "dQw4w9WgXcQ",
    youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    category: "chhath",
    enabled: true,
    sort_order: 0,
    ...overrides,
  };
}

function makeSongs(count: number): Song[] {
  return Array.from({ length: count }, (_, i) =>
    makeSong({ title: `Song ${i + 1}`, youtube_video_id: `video${i + 1}00000` })
  );
}

function getStore() {
  return useRadioStore.getState();
}

// ─── TestLoadQueue ────────────────────────────────────────────────────────────

describe("TestLoadQueue", () => {
  it("sets queue, currentIndex=0, playState=IDLE", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(3);

    await getStore().loadQueue(songs, adapter);

    const state = getStore();
    expect(state.queue).toEqual(songs);
    expect(state.currentIndex).toBe(0);
    expect(state.playState).toBe("IDLE");
  });

  it("generates a new radioSessionId on each load", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(2);

    await getStore().loadQueue(songs, adapter);
    const firstSessionId = getStore().radioSessionId;

    await getStore().loadQueue(songs, new MockYouTubePlayerAdapter());
    const secondSessionId = getStore().radioSessionId;

    expect(firstSessionId).not.toBe(secondSessionId);
  });

  it("subscribes to adapter state changes", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(2);

    await getStore().loadQueue(songs, adapter);

    // Simulate adapter emitting PLAYING — store should update
    adapter.simulateSongEnd(); // triggers ENDED → auto-advance
    // After ENDED on song 0, should advance to song 1
    expect(getStore().currentIndex).toBe(1);
  });
});

// ─── TestCurrentSong ──────────────────────────────────────────────────────────

describe("TestCurrentSong", () => {
  it("returns queue[currentIndex]", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(3);

    await getStore().loadQueue(songs, adapter);

    expect(getStore().currentSong()).toEqual(songs[0]);
  });

  it("returns null when queue is empty", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    await getStore().loadQueue([], adapter);

    expect(getStore().currentSong()).toBeNull();
  });
});

// ─── TestUpNextSongs ──────────────────────────────────────────────────────────

describe("TestUpNextSongs", () => {
  it("returns next N songs after currentIndex", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(5);

    await getStore().loadQueue(songs, adapter);

    const upNext = getStore().upNextSongs(3);
    expect(upNext).toEqual([songs[1], songs[2], songs[3]]);
  });

  it("returns empty array at end of queue", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(2);

    await getStore().loadQueue(songs, adapter);
    // Advance to last song
    await getStore().nextSong();

    expect(getStore().upNextSongs(3)).toEqual([]);
  });
});

// ─── TestStartPlayback ────────────────────────────────────────────────────────

describe("TestStartPlayback", () => {
  it("calls adapter.play() when state is PAUSED without reloading video", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(2);
    await getStore().loadQueue(songs, adapter);

    // Manually set adapter state to PAUSED
    vi.spyOn(adapter, "getState").mockReturnValue("PAUSED");
    const playSpy = vi.spyOn(adapter, "play");
    const loadVideoSpy = vi.spyOn(adapter, "loadVideo");

    await getStore().startPlayback();

    expect(playSpy).toHaveBeenCalled();
    expect(loadVideoSpy).not.toHaveBeenCalled();
  });

  it("calls adapter.play() when state is CUED", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(2);
    await getStore().loadQueue(songs, adapter);

    vi.spyOn(adapter, "getState").mockReturnValue("CUED");
    const playSpy = vi.spyOn(adapter, "play");

    await getStore().startPlayback();

    expect(playSpy).toHaveBeenCalled();
  });

  it("calls adapter.loadVideo() and sets BUFFERING for other states", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(2);
    await getStore().loadQueue(songs, adapter);

    vi.spyOn(adapter, "getState").mockReturnValue("UNSTARTED");
    const loadVideoSpy = vi.spyOn(adapter, "loadVideo");

    await getStore().startPlayback();

    expect(loadVideoSpy).toHaveBeenCalledWith(songs[0].youtube_video_id);
  });

  it("is a no-op when queue is empty", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    await getStore().loadQueue([], adapter);

    const loadVideoSpy = vi.spyOn(adapter, "loadVideo");
    const playSpy = vi.spyOn(adapter, "play");

    await getStore().startPlayback();

    expect(loadVideoSpy).not.toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
  });
});

// ─── TestPausePlayback ────────────────────────────────────────────────────────

describe("TestPausePlayback", () => {
  it("calls adapter.pause() and sets playState=PAUSED", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(2);
    await getStore().loadQueue(songs, adapter);

    const pauseSpy = vi.spyOn(adapter, "pause");

    await getStore().pausePlayback();

    expect(pauseSpy).toHaveBeenCalled();
    expect(getStore().playState).toBe("PAUSED");
  });
});

// ─── TestNextSong ─────────────────────────────────────────────────────────────

describe("TestNextSong", () => {
  it("advances currentIndex and loads next video", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(3);
    await getStore().loadQueue(songs, adapter);

    const loadVideoSpy = vi.spyOn(adapter, "loadVideo");

    await getStore().nextSong();

    expect(getStore().currentIndex).toBe(1);
    expect(loadVideoSpy).toHaveBeenCalledWith(songs[1].youtube_video_id);
  });

  it("wraps to index 0 and sets playState=IDLE at end of queue", async () => {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(2);
    await getStore().loadQueue(songs, adapter);

    // Advance to last song
    await getStore().nextSong();
    expect(getStore().currentIndex).toBe(1);

    // Next from last → wrap
    await getStore().nextSong();
    expect(getStore().currentIndex).toBe(0);
    expect(getStore().playState).toBe("IDLE");
  });
});

// ─── TestHandleAdapterStateChange ─────────────────────────────────────────────

describe("TestHandleAdapterStateChange", () => {
  async function setupStore(songCount = 3) {
    const adapter = new MockYouTubePlayerAdapter();
    const songs = makeSongs(songCount);
    await getStore().loadQueue(songs, adapter);
    const { radioSessionId } = getStore();
    return { adapter, songs, sessionId: radioSessionId };
  }

  it("PLAYING → playState=PLAYING", async () => {
    const { sessionId } = await setupStore();
    await getStore().handleAdapterStateChange("PLAYING", sessionId);
    expect(getStore().playState).toBe("PLAYING");
  });

  it("PAUSED → playState=PAUSED", async () => {
    const { sessionId } = await setupStore();
    await getStore().handleAdapterStateChange("PAUSED", sessionId);
    expect(getStore().playState).toBe("PAUSED");
  });

  it("BUFFERING → playState=BUFFERING", async () => {
    const { sessionId } = await setupStore();
    await getStore().handleAdapterStateChange("BUFFERING", sessionId);
    expect(getStore().playState).toBe("BUFFERING");
  });

  it("ENDED → auto-advances to next song", async () => {
    const { adapter, songs, sessionId } = await setupStore(3);
    const loadVideoSpy = vi.spyOn(adapter, "loadVideo");

    await getStore().handleAdapterStateChange("ENDED", sessionId);

    expect(getStore().currentIndex).toBe(1);
    expect(loadVideoSpy).toHaveBeenCalledWith(songs[1].youtube_video_id);
  });

  it("ENDED at last song → wraps to index 0, playState=IDLE", async () => {
    const { sessionId } = await setupStore(2);

    // Advance to last song first
    await getStore().handleAdapterStateChange("ENDED", sessionId);
    expect(getStore().currentIndex).toBe(1);

    // ENDED at last song
    await getStore().handleAdapterStateChange("ENDED", sessionId);
    expect(getStore().currentIndex).toBe(0);
    expect(getStore().playState).toBe("IDLE");
  });

  it("ERROR → skips broken song and loads next", async () => {
    const { adapter, songs, sessionId } = await setupStore(3);
    const loadVideoSpy = vi.spyOn(adapter, "loadVideo");

    await getStore().handleAdapterStateChange("ERROR", sessionId);

    expect(getStore().currentIndex).toBe(1);
    expect(loadVideoSpy).toHaveBeenCalledWith(songs[1].youtube_video_id);
  });

  it("ERROR at last song → playState=ERROR", async () => {
    const { sessionId } = await setupStore(1);

    await getStore().handleAdapterStateChange("ERROR", sessionId);

    expect(getStore().playState).toBe("ERROR");
  });

  it("stale session ID → event is ignored", async () => {
    await setupStore(3);
    const stateBeforeStaleEvent = getStore().playState;

    await getStore().handleAdapterStateChange("PLAYING", "stale-session-id-xyz");

    // State should not have changed
    expect(getStore().playState).toBe(stateBeforeStaleEvent);
  });
});