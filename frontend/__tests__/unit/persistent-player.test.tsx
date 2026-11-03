/**
 * Unit tests for Persistent YouTube Player Lifecycle & Navigation Persistence
 *
 * Verifies:
 * 1. Global player lifecycle & safe cleanup (unmounting RadioPlayer does NOT destroy the player).
 * 2. Navigation persistence: unmounting/remounting preserves active playback state & controls.
 * 3. Centralized state synchronization: volume, mute, seek, isReady, error in useRadioStore.
 * 4. Error recovery: invalid state/error yields recoverable UI without infinite loading indicators.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useRadioStore } from "@/lib/radio-store";
import { MockYouTubePlayerAdapter } from "@/lib/youtube-adapter";
import RadioPlayer from "@/components/radio/RadioPlayer";
import type { Song } from "@/lib/api";

const mockSongs: Song[] = [
  {
    id: "song-1",
    title: "Kaanch Hi Baans Ke Bahangiya",
    artist: "Sharda Sinha",
    youtube_video_id: "vid12345678",
    youtube_url: "https://www.youtube.com/watch?v=vid12345678",
    category: "chhath",
    enabled: true,
    sort_order: 1,
  },
  {
    id: "song-2",
    title: "Kelwa Ke Paat Par",
    artist: "Anuradha Paudwal",
    youtube_video_id: "vid87654321",
    youtube_url: "https://www.youtube.com/watch?v=vid87654321",
    category: "chhath",
    enabled: true,
    sort_order: 2,
  },
];

describe("Persistent Player Lifecycle & Navigation Persistence", () => {
  let adapter: MockYouTubePlayerAdapter;

  beforeEach(async () => {
    adapter = new MockYouTubePlayerAdapter();
    useRadioStore.setState({
      allSongs: mockSongs,
      queue: mockSongs,
      currentIndex: 0,
      playState: "IDLE",
      userIntent: "idle",
      adapter: null,
      isReady: false,
      error: null,
      volume: 80,
      isMuted: false,
      currentTime: 0,
      duration: 180,
      hasTunedIn: false,
    });
    await useRadioStore.getState().loadQueue(mockSongs, adapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("unmounting RadioPlayer does NOT call adapter.destroy()", async () => {
    const { unmount } = render(<RadioPlayer hasTunedIn={true} />);

    // Adapter should be intact
    expect(adapter.destroyCalled).toBe(false);

    // Simulate navigation away from radio page (e.g. going to /admin or /share)
    unmount();

    // Adapter MUST still be alive and not destroyed!
    expect(adapter.destroyCalled).toBe(false);
  });

  it("preserves active playing state when navigating away and returning", async () => {
    // Start playback
    await useRadioStore.getState().startPlayback();
    expect(useRadioStore.getState().playState).toBe("PLAYING");

    // First render of RadioPlayer on "/"
    const { unmount } = render(<RadioPlayer hasTunedIn={true} />);
    expect(screen.getByText("Kaanch Hi Baans Ke Bahangiya")).toBeDefined();
    expect(screen.getByLabelText("Pause")).toBeDefined();

    // User navigates away to /admin -> RadioPlayer unmounts
    unmount();

    // Playback state in store continues uninterrupted
    expect(useRadioStore.getState().playState).toBe("PLAYING");
    expect(adapter.destroyCalled).toBe(false);

    // User navigates back to "/" -> RadioPlayer mounts again
    render(<RadioPlayer hasTunedIn={true} />);

    // Playback state and active controls are immediately restored
    expect(screen.getByText("Kaanch Hi Baans Ke Bahangiya")).toBeDefined();
    expect(screen.getByLabelText("Pause")).toBeDefined();
    expect(adapter.destroyCalled).toBe(false);
  });

  it("synchronizes centralized volume and mute across store and UI", async () => {
    render(<RadioPlayer hasTunedIn={true} />);

    // Change volume via store action
    act(() => {
      useRadioStore.getState().setVolume(50);
    });
    expect(useRadioStore.getState().volume).toBe(50);
    expect(adapter.volume).toBe(50);

    // Toggle mute
    act(() => {
      useRadioStore.getState().toggleMute();
    });
    expect(useRadioStore.getState().isMuted).toBe(true);
    expect(adapter.isMuted).toBe(true);

    // Unmute
    act(() => {
      useRadioStore.getState().toggleMute();
    });
    expect(useRadioStore.getState().isMuted).toBe(false);
    expect(adapter.isMuted).toBe(false);
  });

  it("synchronizes seeking through useRadioStore.seekTo()", async () => {
    act(() => {
      useRadioStore.getState().seekTo(45);
    });

    expect(useRadioStore.getState().currentTime).toBe(45);
    expect(adapter.currentTime).toBe(45);
  });

  it("provides a recoverable error state instead of getting stuck in infinite buffering", async () => {
    render(<RadioPlayer hasTunedIn={true} />);

    // Simulate an unplayable video error from YouTube
    await act(async () => {
      adapter.simulateError();
    });

    // In a multi-song queue, error automatically skips broken song
    expect(useRadioStore.getState().currentIndex).toBe(1);

    // If queue has 1 song and errors, transitions cleanly to ERROR state with message
    act(() => {
      useRadioStore.setState({ queue: [mockSongs[0]], currentIndex: 0 });
    });
    await act(async () => {
      adapter.simulateError();
    });

    expect(useRadioStore.getState().playState).toBe("ERROR");
    expect(useRadioStore.getState().error).toBeDefined();

    // User can tap Play to retry without being stuck in BUFFERING
    const playBtn = screen.getByLabelText("Play");
    expect(playBtn).toBeDefined();
    expect(playBtn.hasAttribute("disabled")).toBe(false);
  });

  it("keeps the track paused by default after tuning in until Play button is clicked", async () => {
    // When user tunes in (splash dismissed)
    act(() => {
      useRadioStore.getState().setHasTunedIn(true);
    });

    render(<RadioPlayer hasTunedIn={true} />);

    // By default, track is paused / idle — not auto-playing
    expect(useRadioStore.getState().playState).toBe("IDLE");
    expect(useRadioStore.getState().userIntent).toBe("idle");
    const playBtn = screen.getByLabelText("Play");
    expect(playBtn).toBeDefined();

    // Only plays when the user explicitly clicks the Play button
    await act(async () => {
      fireEvent.click(playBtn);
    });

    expect(useRadioStore.getState().playState).toBe("PLAYING");
    expect(screen.getByLabelText("Pause")).toBeDefined();
  });
});
