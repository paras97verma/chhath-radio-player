import { describe, it, expect, vi, beforeEach } from "vitest";
import { Html5AudioAdapter } from "@/lib/audio/html5-audio-adapter";

vi.mock("@/lib/piped/piped-client", () => ({
  fetchPipedStream: vi.fn(),
}));

describe("Html5AudioAdapter", () => {
  let primaryAudio: HTMLAudioElement;
  let secondaryAudio: HTMLAudioElement;
  let adapter: Html5AudioAdapter;

  beforeEach(async () => {
    vi.restoreAllMocks();
    primaryAudio = document.createElement("audio");
    secondaryAudio = document.createElement("audio");
    adapter = new Html5AudioAdapter(primaryAudio, secondaryAudio);
    await adapter.initialize(null);
  });

  it("initializes audio elements with playsinline and preload", () => {
    expect(primaryAudio.preload).toBe("none");
    expect(secondaryAudio.preload).toBe("none");
    expect(primaryAudio.getAttribute("playsinline")).toBe("true");
    expect(secondaryAudio.getAttribute("playsinline")).toBe("true");
  });

  it("updates volume and mute settings across both audio elements", () => {
    adapter.setVolume(50);
    expect(primaryAudio.volume).toBe(0.5);
    expect(secondaryAudio.volume).toBe(0.5);

    adapter.mute();
    expect(primaryAudio.muted).toBe(true);
    expect(secondaryAudio.muted).toBe(true);

    adapter.unMute();
    expect(primaryAudio.muted).toBe(false);
    expect(secondaryAudio.muted).toBe(false);
  });

  it("forwards audio play and pause events to listeners", () => {
    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    // Simulate play event
    primaryAudio.dispatchEvent(new Event("play"));
    expect(states).toContain("PLAYING");

    // Simulate pause event
    primaryAudio.dispatchEvent(new Event("pause"));
    expect(states).toContain("PAUSED");
  });

  it("forwards waiting/buffering and ended events to listeners", () => {
    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    primaryAudio.dispatchEvent(new Event("waiting"));
    expect(states).toContain("BUFFERING");

    primaryAudio.dispatchEvent(new Event("ended"));
    expect(states).toContain("ENDED");
  });

  it("cleans up listeners and pauses audio upon destroy", () => {
    const pauseSpy = vi.spyOn(primaryAudio, "pause");
    adapter.destroy();
    expect(pauseSpy).toHaveBeenCalled();
  });

  it("forwards timeupdate and metadata progress events to onProgress listeners", () => {
    let recordedCur = 0;
    let recordedDur = 0;
    adapter.onProgress((cur, dur) => {
      recordedCur = cur;
      recordedDur = dur;
    });

    Object.defineProperty(primaryAudio, "duration", { value: 210, configurable: true });
    Object.defineProperty(primaryAudio, "currentTime", { value: 45, configurable: true, writable: true });

    primaryAudio.dispatchEvent(new Event("timeupdate"));
    expect(recordedCur).toBe(45);
    expect(recordedDur).toBe(210);

    adapter.seekTo(90);
    expect(primaryAudio.currentTime).toBe(90);
    expect(recordedCur).toBe(90);
  });

  it("discards out-of-order resolved streams from previous loadVideo calls", async () => {
    const { fetchPipedStream } = await import("@/lib/piped/piped-client");
    let resolveSong1: any;
    let resolveSong2: any;

    vi.mocked(fetchPipedStream).mockImplementation(((videoId: string) => {
      if (videoId === "song1") {
        return new Promise((resolve) => {
          resolveSong1 = () =>
            resolve({
              url: "https://audio.example.com/song1.m4a",
              format: "M4A",
              quality: "128kbps",
              mimeType: 'audio/mp4; codecs="mp4a.40.2"',
              codec: "mp4a.40.2",
              bitrate: 128000,
            });
        });
      }
      if (videoId === "song2") {
        return new Promise((resolve) => {
          resolveSong2 = () =>
            resolve({
              url: "https://audio.example.com/song2.m4a",
              format: "M4A",
              quality: "128kbps",
              mimeType: 'audio/mp4; codecs="mp4a.40.2"',
              codec: "mp4a.40.2",
              bitrate: 128000,
            });
        });
      }
      return Promise.reject(new Error("Unknown song"));
    }) as any);

    primaryAudio.play = vi.fn().mockResolvedValue(undefined);

    // Call loadVideo for song 1 first
    const p1 = adapter.loadVideo("song1");
    // User quickly clicks song 2
    const p2 = adapter.loadVideo("song2");

    // Song 2 finishes first
    resolveSong2();
    await p2;
    expect(primaryAudio.src).toBe("https://audio.example.com/song2.m4a");

    // Now older song 1 finishes later
    resolveSong1();
    await p1;

    // Must still be song 2! Older song 1 must NOT overwrite song 2!
    expect(primaryAudio.src).toBe("https://audio.example.com/song2.m4a");
  });

  it("suppresses AbortError and does not emit ERROR state when load is aborted", async () => {
    const { fetchPipedStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchPipedStream).mockImplementation(((_id: string, _el: any, signal?: AbortSignal) => {
      return new Promise((_, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("The user aborted a request.", "AbortError"));
          });
        }
      });
    }) as any);

    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    // Start loading song 1
    const p1 = adapter.loadVideo("song1");
    // Start loading song 2, which aborts song 1
    adapter.loadVideo("song2");

    await p1; // Should resolve quietly without throwing or emitting ERROR
    expect(states).not.toContain("ERROR");
  });

  it("primeAudio unlocks audio elements with silent audio payload", () => {
    const playSpy = vi.spyOn(primaryAudio, "play").mockResolvedValue(undefined);
    adapter.primeAudio();
    expect(primaryAudio.src).toContain("data:audio/wav;base64");
    expect(playSpy).toHaveBeenCalled();
  });

  it("getDuration prefers authoritative stream duration over native audio.duration", async () => {
    const { fetchPipedStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchPipedStream).mockResolvedValue({
      url: "https://audio.example.com/song.m4a?dur=298.50",
      format: "M4A",
      quality: "128kbps",
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      codec: "mp4a.40.2",
      bitrate: 128000,
      duration: 298.5,
    });

    // Native audio.duration falsely reporting 597s (2x CoreAudio bug)
    Object.defineProperty(primaryAudio, "duration", { value: 597.0, configurable: true });

    await adapter.loadVideo("song_dur_test");
    expect(adapter.getDuration()).toBe(298.5);
  });

  it("deduplicates ENDED events to prevent accidental double-skipping", async () => {
    const { fetchPipedStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchPipedStream).mockResolvedValue({
      url: "https://audio.example.com/song.m4a?dur=200.0",
      format: "M4A",
      quality: "128kbps",
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      codec: "mp4a.40.2",
      bitrate: 128000,
      duration: 200.0,
    });
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);

    await adapter.loadVideo("dedup_test");

    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    // 1. Timeupdate reaches threshold near end (cur >= duration - 0.4)
    Object.defineProperty(primaryAudio, "currentTime", { value: 199.7, configurable: true, writable: true });
    Object.defineProperty(primaryAudio, "paused", { value: false, configurable: true });
    Object.defineProperty(primaryAudio, "ended", { value: false, configurable: true });
    primaryAudio.dispatchEvent(new Event("timeupdate"));

    expect(states.filter((s) => s === "ENDED").length).toBe(1);

    // 2. Native ended event fires immediately after
    Object.defineProperty(primaryAudio, "ended", { value: true, configurable: true });
    primaryAudio.dispatchEvent(new Event("ended"));

    // Crucial check: ENDED MUST still be emitted only ONCE!
    expect(states.filter((s) => s === "ENDED").length).toBe(1);
  });

  it("performs instant seamless handoff when secondary audio has preloaded song", async () => {
    const { fetchPipedStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchPipedStream).mockResolvedValue({
      url: "https://audio.example.com/song_preloaded.m4a",
      format: "M4A",
      quality: "128kbps",
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      codec: "mp4a.40.2",
      bitrate: 128000,
      duration: 180,
    });
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);
    secondaryAudio.play = vi.fn().mockResolvedValue(undefined);

    // Preload next song
    await adapter.preloadNextSong({
      id: "song_next",
      youtube_video_id: "next_vid_123",
      title: "Next Song",
      artist: "Singer",
      youtube_url: null,
      category: null,
      enabled: true,
      sort_order: 1,
    });

    expect(secondaryAudio.src).toBe("https://audio.example.com/song_preloaded.m4a");

    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    // Now call loadVideo with the preloaded song ID
    await adapter.loadVideo("next_vid_123");

    // Must immediately transition without waiting for network re-fetch
    expect(secondaryAudio.play).toHaveBeenCalled();
    expect(states).toContain("PLAYING");
  });
});
