import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RadioPlayer from "@/components/radio/RadioPlayer";
import { useRadioStore } from "@/lib/radio-store";
import { MockYouTubePlayerAdapter } from "@/lib/youtube-adapter";
import type { Song } from "@/lib/api";

const songs: Song[] = [
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

describe("RadioPlayer recovery and accessible state", () => {
  let adapter: MockYouTubePlayerAdapter;

  beforeEach(async () => {
    localStorage.clear();
    adapter = new MockYouTubePlayerAdapter();
    useRadioStore.setState({
      favorites: [],
      activeFilter: "all",
      allSongs: songs,
      queue: songs,
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
    await useRadioStore.getState().loadQueue(songs, adapter);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("announces loading, ready, starting, buffering, paused, error, and empty states", () => {
    render(<RadioPlayer hasTunedIn />);

    expect(screen.getByRole("region", { name: "Radio player" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ready to play");

    act(() => useRadioStore.setState({ playState: "PLAYING" }));
    expect(screen.getByRole("status")).toHaveTextContent("Starting audio");

    act(() => useRadioStore.setState({ playState: "BUFFERING" }));
    expect(screen.getByRole("status")).toHaveTextContent("Connecting to audio");

    act(() => useRadioStore.setState({ playState: "PAUSED" }));
    expect(screen.getByRole("status")).toHaveTextContent("Paused");

    act(() => useRadioStore.setState({ playState: "ERROR", error: "Stream unavailable" }));
    expect(screen.getByRole("status")).toHaveTextContent("Playback interrupted");
    expect(screen.getByRole("alert")).toHaveTextContent("Stream unavailable");

    act(() => useRadioStore.setState({ queue: [], allSongs: [], currentIndex: 0, playState: "IDLE", error: null, isReady: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Choose a song");

    act(() => useRadioStore.setState({ isReady: false }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading your station");
  });

  it("announces On air and shows the equalizer only after media time advances", () => {
    vi.useFakeTimers();
    render(<RadioPlayer hasTunedIn />);

    act(() => useRadioStore.setState({ playState: "PLAYING" }));
    expect(screen.getByRole("status")).toHaveTextContent("Starting audio");
    expect(document.querySelectorAll(".spec-bar-animated")).toHaveLength(0);

    adapter.currentTime = 1;
    act(() => vi.advanceTimersByTime(250));

    expect(screen.getByRole("status")).toHaveTextContent("On air");
    expect(document.querySelectorAll(".spec-bar-animated")).toHaveLength(5);
  });

  it("provides keyboard-focusable Retry and explicit Skip actions for the selected song", async () => {
    const user = userEvent.setup();
    act(() => useRadioStore.setState({ playState: "ERROR", error: "Stream unavailable" }));
    render(<RadioPlayer hasTunedIn />);

    const retry = screen.getByRole("button", { name: "Retry song" });
    const skip = screen.getByRole("button", { name: "Skip this song and play the next song" });
    expect(retry).toBeEnabled();
    expect(skip).toBeEnabled();

    retry.focus();
    expect(document.activeElement).toBe(retry);
    await user.keyboard("{Enter}");
    expect(useRadioStore.getState().currentIndex).toBe(0);
    expect(adapter.currentVideoId).toBe(songs[0].youtube_video_id);

    act(() => useRadioStore.setState({ playState: "ERROR", error: "Still unavailable" }));
    const focusedSkip = screen.getByRole("button", { name: "Skip this song and play the next song" });
    focusedSkip.focus();
    expect(document.activeElement).toBe(focusedSkip);
    await user.keyboard("{Enter}");

    expect(useRadioStore.getState().currentIndex).toBe(1);
    expect(adapter.currentVideoId).toBe(songs[1].youtube_video_id);
  });

  it("disables Skip when the queue has no alternate song but keeps Retry available", () => {
    act(() => useRadioStore.setState({
      queue: [songs[0]],
      currentIndex: 0,
      playState: "ERROR",
      error: "Stream unavailable",
    }));
    render(<RadioPlayer hasTunedIn />);

    expect(screen.getByRole("button", { name: "Retry song" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Skip this song and play the next song" })).toBeDisabled();
  });

  it("keeps previous and next song controls available at the start of a multi-song queue", async () => {
    const user = userEvent.setup();
    render(<RadioPlayer hasTunedIn />);

    const previous = screen.getByRole("button", { name: "Previous song" });
    const next = screen.getByRole("button", { name: "Next song" });
    expect(previous).toBeEnabled();
    expect(next).toBeEnabled();

    await user.click(previous);
    await waitFor(() => expect(adapter.currentVideoId).toBe(songs[1].youtube_video_id));
  });

  it("loads vinyl artwork through the same-origin proxy and falls back when an image fails", () => {
    render(<RadioPlayer hasTunedIn />);

    const vinylImage = document.querySelector(".radio-player-vinyl img") as HTMLImageElement;
    expect(vinylImage.getAttribute("src")).toBe(`/yt-thumb?v=${songs[0].youtube_video_id}`);

    fireEvent.error(vinylImage);
    const fallbackImage = document.querySelector(".radio-player-vinyl img") as HTMLImageElement;
    expect(fallbackImage.getAttribute("src")).toBe(
      `https://i.ytimg.com/vi/${songs[0].youtube_video_id}/mqdefault.jpg`,
    );

    fireEvent.error(fallbackImage);
    expect(document.querySelector(".radio-player-vinyl img")).toBeNull();
    expect(document.body).toHaveTextContent("🪔");
  });

  it("seeks from the progress bar when a touch pointer is released", () => {
    render(<RadioPlayer hasTunedIn />);
    const seek = screen.getByRole("slider", { name: "Seek" });

    fireEvent.pointerDown(seek, { pointerType: "touch" });
    fireEvent.change(seek, { target: { value: "500" } });
    fireEvent.pointerUp(seek, { pointerType: "touch" });

    expect(adapter.currentTime).toBe(90);
    expect(useRadioStore.getState().currentTime).toBe(90);
  });

  it("plays and pauses from the visible player control", async () => {
    const user = userEvent.setup();
    render(<RadioPlayer hasTunedIn />);

    await user.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(adapter.currentVideoId).toBe(songs[0].youtube_video_id));
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(useRadioStore.getState().playState).toBe("PAUSED"));
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
  });

  it("keeps player motion constrained when reduced motion is requested", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.radio-player[\s\S]*?animation-duration:\s*0\.01ms\s*!important;/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-iteration-count:\s*1\s*!important;/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition-duration:\s*0\.01ms\s*!important;/);
  });
});
