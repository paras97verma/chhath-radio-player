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
    localStorage.clear();
    adapter = new MockYouTubePlayerAdapter();
    useRadioStore.setState({
      favorites: [],
      activeFilter: "all",
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

  it("keeps the playlist drawer open when a song is selected by the user", async () => {
    const onPlaylistToggle = vi.fn();
    useRadioStore.setState({ isReady: true, adapter });

    render(
      <RadioPlayer
        hasTunedIn={true}
        showPlaylist={true}
        onPlaylistToggle={onPlaylistToggle}
      />
    );

    const songButtons = screen.getAllByRole("button").filter((b) => b.textContent?.includes("Kelwa Ke Paat Par"));
    expect(songButtons.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(songButtons[0]);
    });

    // onPlaylistToggle must NOT be called — drawer stays open for the user
    expect(onPlaylistToggle).not.toHaveBeenCalled();
    expect(useRadioStore.getState().currentIndex).toBe(1);
  });

  it("changes volume with ArrowUp and ArrowDown keys even when playlist is open", async () => {
    useRadioStore.setState({ isReady: true, adapter, volume: 50 });

    render(
      <RadioPlayer
        hasTunedIn={true}
        showPlaylist={true}
      />
    );

    // Press ArrowUp when playlist is open
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp" }));
    });
    expect(useRadioStore.getState().volume).toBe(55);

    // Press ArrowDown when playlist is open
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowDown" }));
    });
    expect(useRadioStore.getState().volume).toBe(50);
  });

  it("displays current song title and heart against it if and only if in favorites, without heart being a toggle button", async () => {
    useRadioStore.setState({ isReady: true, adapter, favorites: [] });

    const { rerender } = render(
      <RadioPlayer
        hasTunedIn={true}
        showPlaylist={false}
      />
    );

    // Song 1 is playing and not in favorites
    expect(screen.getByText("Kaanch Hi Baans Ke Bahangiya")).toBeDefined();
    expect(screen.queryByTitle("In Favorites")).toBeNull();

    // Now favorite Song 1
    act(() => {
      useRadioStore.getState().toggleFavorite("song-1");
    });

    rerender(
      <RadioPlayer
        hasTunedIn={true}
        showPlaylist={false}
      />
    );

    // Heart indicator is displayed against the title
    const heartIndicator = screen.getByTitle("In Favorites");
    expect(heartIndicator).toBeDefined();
    expect(heartIndicator.textContent).toBe("❤️");

    // Clicking the heart does NOT toggle favorite
    fireEvent.click(heartIndicator);
    expect(useRadioStore.getState().isFavorite("song-1")).toBe(true);
  });

  it("switching from regular playlist to fav playlist does not start playing a song or change current song", async () => {
    useRadioStore.setState({
      isReady: true,
      adapter,
      playState: "PLAYING",
      userIntent: "playing",
      currentIndex: 0,
    });
    // Song 2 is in favorites
    useRadioStore.getState().toggleFavorite("song-2");

    const loadVideoSpy = vi.spyOn(adapter, "loadVideo");

    render(
      <RadioPlayer
        hasTunedIn={true}
        showPlaylist={true}
      />
    );

    // Initial state: Song 1 is playing (appears in controller and in all songs drawer)
    expect(screen.getAllByText("Kaanch Hi Baans Ke Bahangiya").length).toBeGreaterThan(0);

    // Switch tab to Favorites
    const favTabBtn = screen.getByText("❤️ Favorites");
    await act(async () => {
      fireEvent.click(favTabBtn);
    });

    // loadVideo must NOT have been called
    expect(loadVideoSpy).not.toHaveBeenCalled();

    // The song name display above the controller must STILL display Song 1 (which is not in favorites list)
    expect(screen.getByText("Kaanch Hi Baans Ke Bahangiya")).toBeDefined();
    expect(useRadioStore.getState().currentIndex).toBe(0);

    // Now click Song 2 in the favorites list to play it
    const song2Btn = screen.getAllByRole("button").find((b) => b.textContent?.includes("Kelwa Ke Paat Par"));
    expect(song2Btn).toBeDefined();

    await act(async () => {
      fireEvent.click(song2Btn!);
    });

    // Now Song 2 should be loaded and playing
    expect(loadVideoSpy).toHaveBeenCalledWith("vid87654321");
    expect(useRadioStore.getState().currentSong()?.id).toBe("song-2");
  });

  it("immediately updates heart indicator on controller in real-time when currently playing song is favorited or unfavorited", async () => {
    useRadioStore.setState({
      isReady: true,
      adapter,
      playState: "PLAYING",
      userIntent: "playing",
      currentIndex: 0,
      favorites: ["song-1", "vid12345678"],
    });

    render(
      <RadioPlayer
        hasTunedIn={true}
        showPlaylist={false}
      />
    );

    // Heart is visible while song-1 is playing
    expect(screen.getByTitle("In Favorites")).toBeDefined();

    // User unfavorites song-1 while it is playing
    await act(async () => {
      useRadioStore.getState().toggleFavorite("song-1");
    });

    // In the controller, the heart sign next to song title must IMMEDIATELY disappear
    expect(screen.queryByTitle("In Favorites")).toBeNull();

    // User re-favorites song-1
    await act(async () => {
      useRadioStore.getState().toggleFavorite("song-1");
    });

    // Heart sign immediately reappears
    expect(screen.getByTitle("In Favorites")).toBeDefined();
  });

  it("updates playlist drawer in real-time and orders favorites in the order they were marked", async () => {
    const song3: Song = {
      id: "song-3",
      title: "Uga Ho Suruj Dev",
      artist: "Sharda Sinha",
      youtube_video_id: "vid33333333",
      youtube_url: "https://www.youtube.com/watch?v=vid33333333",
      category: "chhath",
      enabled: true,
      sort_order: 3,
    };
    const threeSongs = [...mockSongs, song3];
    await useRadioStore.getState().loadQueue(threeSongs, adapter);
    useRadioStore.setState({
      isReady: true,
      adapter,
      playState: "PLAYING",
      userIntent: "playing",
      currentIndex: 0,
      favorites: [],
      activeFilter: "all",
    });

    render(
      <RadioPlayer
        hasTunedIn={true}
        showPlaylist={true}
      />
    );

    // Find heart toggle buttons: mockSongs[0] is song-1, mockSongs[1] is song-2, mockSongs[2] is song-3
    const favButtons = screen.getAllByRole("button", { name: "Add to favorites" });
    expect(favButtons.length).toBe(3);

    // Click favorite on Song 2 (index 1) first
    await act(async () => {
      fireEvent.click(favButtons[1]);
    });

    // Favorites tab button appears with count (1) immediately without toggling drawer
    expect(screen.getByText("❤️ Favorites")).toBeDefined();
    expect(screen.getByText("(1)")).toBeDefined();

    // Now click favorite on Song 1 (index 0)
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Add to favorites" })[0]);
    });
    expect(screen.getByText("(2)")).toBeDefined();

    // Switch to Favorites tab
    await act(async () => {
      fireEvent.click(screen.getByText("❤️ Favorites"));
    });

    // In the favorites list, song-2 was favorited first, song-1 second.
    // They must appear in order: [Kelwa Ke Paat Par, Kaanch Hi Baans Ke Bahangiya]
    const renderedSongs = screen.getAllByRole("button").filter((b) =>
      b.textContent?.includes("Kelwa Ke Paat Par") || b.textContent?.includes("Kaanch Hi Baans Ke Bahangiya")
    );
    expect(renderedSongs[0].textContent).toContain("Kelwa Ke Paat Par");
    expect(renderedSongs[1].textContent).toContain("Kaanch Hi Baans Ke Bahangiya");

    // While in the Favorites tab, unfavorite Song 2
    const removeBtn = screen.getAllByRole("button", { name: "Remove from favorites" })[0];
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    // Song 2 immediately disappears from favorites list in real time
    const remainingInFavs = screen.getAllByRole("button").filter((b) =>
      b.textContent?.includes("Kelwa Ke Paat Par")
    );
    expect(remainingInFavs.length).toBe(0);
  });
});
