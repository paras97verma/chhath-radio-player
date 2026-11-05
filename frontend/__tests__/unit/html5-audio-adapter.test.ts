import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Html5AudioAdapter } from "@/lib/audio/html5-audio-adapter";
import type { AudioStreamInfo, CanonicalStreamCandidate } from "@/lib/audio/types";

vi.mock("@/lib/piped/piped-client", () => ({
  fetchInvidiousStream: vi.fn(),
  reportStreamFailure: vi.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferredPromise<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function deferPlay(audio: HTMLAudioElement): Deferred<void> {
  const attempt = deferredPromise<void>();
  audio.play = vi.fn(() => attempt.promise);
  return attempt;
}

type FakeMediaState = Partial<{
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  error: MediaError | null;
}>;

function emitMediaEvent(
  audio: HTMLAudioElement,
  eventType: string,
  state: FakeMediaState = {}
): void {
  for (const [property, value] of Object.entries(state)) {
    Object.defineProperty(audio, property, {
      configurable: true,
      writable: true,
      value,
    });
  }
  audio.dispatchEvent(new Event(eventType));
}

function useFakeClock() {
  const epoch = 1_700_000_000_000;
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  return {
    now: () => Date.now() - epoch,
    advanceBy: (milliseconds: number) => vi.advanceTimersByTimeAsync(milliseconds),
  };
}

function proxyUrl(videoId: string): string {
  return `https://inv.example.test/latest_version?id=${videoId}&itag=140&local=true`;
}

function canonicalStream(
  videoId: string,
  directUrl: string,
  duration?: number,
): AudioStreamInfo {
  const now = Math.floor(Date.now() / 1000);
  const mimeType = 'audio/mp4; codecs="mp4a.40.2"';
  const makeSource = (mode: "direct" | "proxy", url: string): CanonicalStreamCandidate => ({
    mode,
    provider: "invidious",
    provider_origin: "https://inv.example.test",
    url,
    itag: 140,
    mime_type: mimeType,
    codec: "mp4a.40.2",
    resolved_at: now,
    expires_at: null,
    refresh_at: now + 1200,
    validation_state: "validated",
  });
  const proxy = proxyUrl(videoId);
  return {
    url: directUrl,
    direct_url: directUrl,
    proxy_url: proxy,
    status: "READY",
    schema_version: 1,
    video_id: videoId,
    generation: 1,
    refreshed_at: now,
    sources: [makeSource("direct", directUrl), makeSource("proxy", proxy)],
    format: "M4A",
    quality: "128kbps",
    mimeType,
    codec: "mp4a.40.2",
    bitrate: 128000,
    duration,
  };
}

afterEach(() => vi.useRealTimers());

describe("Html5AudioAdapter", () => {
  let primaryAudio: HTMLAudioElement;
  let secondaryAudio: HTMLAudioElement;
  let adapter: Html5AudioAdapter;

  beforeEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    primaryAudio = document.createElement("audio");
    secondaryAudio = document.createElement("audio");
    vi.spyOn(primaryAudio, "canPlayType").mockReturnValue("probably");
    vi.spyOn(secondaryAudio, "canPlayType").mockReturnValue("probably");
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

    emitMediaEvent(primaryAudio, "play", { paused: false });
    expect(states).not.toContain("PLAYING");

    emitMediaEvent(primaryAudio, "pause", { paused: true });
    expect(states).toContain("PAUSED");
  });

  it("forwards waiting/buffering and ended events to listeners", () => {
    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    emitMediaEvent(primaryAudio, "waiting", { currentTime: 0, paused: false });
    emitMediaEvent(primaryAudio, "stalled", { currentTime: 0, paused: false });
    expect(states).toContain("BUFFERING");

    emitMediaEvent(primaryAudio, "ended", { ended: true });
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

    emitMediaEvent(primaryAudio, "timeupdate", { duration: 210, currentTime: 45 });
    expect(recordedCur).toBe(45);
    expect(recordedDur).toBe(210);

    adapter.seekTo(90);
    expect(primaryAudio.currentTime).toBe(90);
    expect(recordedCur).toBe(90);
  });

  it("discards out-of-order resolved streams from previous loadVideo calls", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    const song1 = deferredPromise<AudioStreamInfo>();
    const song2 = deferredPromise<AudioStreamInfo>();

    vi.mocked(fetchInvidiousStream).mockImplementation(((videoId: string) => {
      if (videoId === "song1") {
        return song1.promise;
      }
      if (videoId === "song2") {
        return song2.promise;
      }
      return Promise.reject(new Error("Unknown song"));
    }) as any);

    primaryAudio.play = vi.fn().mockResolvedValue(undefined);

    // Call loadVideo for song 1 first
    const p1 = adapter.loadVideo("song1");
    // User quickly clicks song 2
    const p2 = adapter.loadVideo("song2");

    // Song 2 finishes first
    song2.resolve(canonicalStream("song2", "https://audio.example.com/song2.m4a"));
    await p2;
    expect(primaryAudio.src).toBe("https://audio.example.com/song2.m4a");

    // Now older song 1 finishes later
    song1.resolve(canonicalStream("song1", "https://audio.example.com/song1.m4a"));
    await p1;

    // Must still be song 2! Older song 1 must NOT overwrite song 2!
    expect(primaryAudio.src).toBe("https://audio.example.com/song2.m4a");
  });

  it("does not assign or play a source the current audio element rejects", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    const stream = canonicalStream("unsupported_mime", "https://audio.example.com/song.m4a");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(stream);
    vi.spyOn(primaryAudio, "canPlayType").mockReturnValue("");
    const play = vi.spyOn(primaryAudio, "play").mockResolvedValue(undefined);
    const states: string[] = [];
    adapter.onStateChange((state) => states.push(state));

    await adapter.loadVideo("unsupported_mime");

    expect(primaryAudio.canPlayType).toHaveBeenCalledWith(stream.mimeType);
    expect(primaryAudio.src).toBe("");
    expect(play).not.toHaveBeenCalled();
    expect(states).toContain("ERROR");
  });

  it("suppresses AbortError and does not emit ERROR state when load is aborted", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockImplementation(((_id: string, _el: any, signal?: AbortSignal) => {
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

  it("controls delayed play separately from canplay without media progress", async () => {
    const playAttempt = deferPlay(primaryAudio);
    let playResolved = false;
    const playPromise = primaryAudio.play().then(() => {
      playResolved = true;
    });

    emitMediaEvent(primaryAudio, "canplay", { currentTime: 0, paused: false });
    await Promise.resolve();

    expect(primaryAudio.currentTime).toBe(0);
    expect(playResolved).toBe(false);

    playAttempt.resolve(undefined);
    await playPromise;
    expect(playResolved).toBe(true);
  });

  it("getDuration prefers authoritative stream duration over native audio.duration", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("song_dur_test", "https://audio.example.com/song.m4a?dur=298.50", 298.5),
    );

    // Native audio.duration falsely reporting 597s (2x CoreAudio bug)
    Object.defineProperty(primaryAudio, "duration", { value: 597.0, configurable: true });

    await adapter.loadVideo("song_dur_test");
    expect(adapter.getDuration()).toBe(298.5);
  });

  it("deduplicates ENDED events to prevent accidental double-skipping", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("dedup_test", "https://audio.example.com/song.m4a?dur=200.0", 200),
    );
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);

    await adapter.loadVideo("dedup_test");

    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    // 1. Timeupdate reaches threshold near end (cur >= duration - 0.4)
    emitMediaEvent(primaryAudio, "timeupdate", {
      currentTime: 199.7,
      paused: false,
      ended: false,
    });

    expect(states.filter((s) => s === "ENDED").length).toBe(1);

    // 2. Native ended event fires immediately after
    emitMediaEvent(primaryAudio, "ended", { ended: true });

    // Crucial check: ENDED MUST still be emitted only ONCE!
    expect(states.filter((s) => s === "ENDED").length).toBe(1);
  });

  it("performs instant seamless handoff when secondary audio has preloaded song", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("next_vid_123", "https://audio.example.com/song_preloaded.m4a", 180),
    );
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

    // Simulate browser confirming media readiness (T028: only ready after canplay/progress, not mere src assignment)
    secondaryAudio.dispatchEvent(new Event("canplay"));

    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    // Now call loadVideo with the preloaded song ID
    await adapter.loadVideo("next_vid_123");

    // The warmed element starts immediately, but playback state waits for media progress.
    expect(secondaryAudio.play).toHaveBeenCalled();
    expect(states).toContain("BUFFERING");
    expect(states).not.toContain("PLAYING");

    emitMediaEvent(secondaryAudio, "timeupdate", { currentTime: 0.25, duration: 180, paused: false });
    expect(states).toContain("PLAYING");
  });

  it("observes readiness events fired during source assignment", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("early_ready", "https://audio.example.com/early.m4a"),
    );
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);
    secondaryAudio.play = vi.fn().mockResolvedValue(undefined);
    let assignedSource = "";
    Object.defineProperty(secondaryAudio, "src", {
      configurable: true,
      get: () => assignedSource,
      set: (value: string) => {
        assignedSource = value;
        secondaryAudio.dispatchEvent(new Event("canplay"));
      },
    });

    await adapter.preloadNextSong({
      id: "early_ready_song",
      youtube_video_id: "early_ready",
      title: "Early Ready",
      artist: "Singer",
      youtube_url: null,
      category: null,
      enabled: true,
      sort_order: 1,
    });
    await adapter.loadVideo("early_ready");

    expect(secondaryAudio.play).toHaveBeenCalled();
    expect(primaryAudio.play).not.toHaveBeenCalled();
  });

  it("uses primary playback when the browser ignores the preload hint", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("ignored_preload", "https://audio.example.com/standard.m4a"),
    );
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);
    secondaryAudio.play = vi.fn().mockResolvedValue(undefined);

    await adapter.preloadNextSong({
      id: "ignored_preload_song",
      youtube_video_id: "ignored_preload",
      title: "Ignored Preload",
      artist: "Singer",
      youtube_url: null,
      category: null,
      enabled: true,
      sort_order: 1,
    });
    await adapter.loadVideo("ignored_preload");

    expect(primaryAudio.src).toBe("https://audio.example.com/standard.m4a");
    expect(primaryAudio.play).toHaveBeenCalled();
    expect(secondaryAudio.play).not.toHaveBeenCalled();
  });

  it("removes preload readiness listeners when destroyed", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("destroy_preload", "https://audio.example.com/destroy.m4a"),
    );
    const removeListener = vi.spyOn(secondaryAudio, "removeEventListener");

    await adapter.preloadNextSong({
      id: "destroy_preload_song",
      youtube_video_id: "destroy_preload",
      title: "Destroy Preload",
      artist: "Singer",
      youtube_url: null,
      category: null,
      enabled: true,
      sort_order: 1,
    });
    adapter.destroy();

    expect(removeListener).toHaveBeenCalledWith("canplay", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("progress", expect.any(Function));
  });

  it("does not preload a MIME type the secondary audio element rejects", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    const stream = canonicalStream("unsupported_preload", "https://audio.example.com/song.m4a");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(stream);
    vi.spyOn(secondaryAudio, "canPlayType").mockReturnValue("");

    await adapter.preloadNextSong({
      id: "unsupported_preload_song",
      youtube_video_id: "unsupported_preload",
      title: "Unsupported Format",
      artist: "Singer",
      youtube_url: null,
      category: null,
      enabled: true,
      sort_order: 1,
    });

    expect(secondaryAudio.canPlayType).toHaveBeenCalledWith(stream.mimeType);
    expect(secondaryAudio.src).toBe("");
  });

  it("tries the current direct candidate before the proxy candidate", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("degraded_song", "https://googlevideo.com/videoplayback?ip=restricted"),
    );
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);

    await adapter.loadVideo("degraded_song");

    expect(primaryAudio.src).toBe("https://googlevideo.com/videoplayback?ip=restricted");
  });

  it("automatically fails over to proxy_url when direct stream errors", async () => {
    const clock = useFakeClock();
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("fail_direct_song", "https://googlevideo.com/videoplayback?fail_direct"),
    );
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);

    await adapter.loadVideo("fail_direct_song");
    expect(primaryAudio.src).toBe("https://googlevideo.com/videoplayback?fail_direct");

    // Simulate direct stream error (e.g. 403 Forbidden)
    emitMediaEvent(primaryAudio, "error", {
      error: { code: 4, message: "403 Forbidden" } as MediaError,
    });
    await clock.advanceBy(10);
    expect(clock.now()).toBe(10);

    // Must switch to proxy_url automatically without requiring another user click
    expect(primaryAudio.src).toBe(proxyUrl("fail_direct_song"));
  });

  it("requires advancing media time before reporting PLAYING", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("progress_required", "https://audio.example.com/progress.m4a", 200),
    );
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);

    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));
    await adapter.loadVideo("progress_required");

    emitMediaEvent(primaryAudio, "play", { currentTime: 0, paused: false });
    emitMediaEvent(primaryAudio, "waiting", { currentTime: 0, paused: false });
    emitMediaEvent(primaryAudio, "canplay", { currentTime: 0, paused: false });
    emitMediaEvent(primaryAudio, "loadeddata", { currentTime: 0, paused: false });
    emitMediaEvent(primaryAudio, "playing", { currentTime: 0, paused: false });
    expect(states).toContain("BUFFERING");
    expect(states).not.toContain("PLAYING");

    emitMediaEvent(primaryAudio, "timeupdate", { currentTime: 0.25, duration: 200, paused: false });
    expect(states.at(-1)).toBe("PLAYING");
  });

  it("allows five seconds for first progress before switching direct to proxy", async () => {
    const clock = useFakeClock();
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("progress_timeout", "https://audio.example.com/direct.m4a"),
    );
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);

    await adapter.loadVideo("progress_timeout");
    await clock.advanceBy(4999);
    expect(primaryAudio.src).toBe("https://audio.example.com/direct.m4a");

    await clock.advanceBy(1);
    expect(primaryAudio.src).toBe(proxyUrl("progress_timeout"));
  });

  it("starts a five-second recovery deadline when a progressing stream stalls", async () => {
    const clock = useFakeClock();
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("stall_timeout", "https://audio.example.com/stalling.m4a"),
    );
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);

    await adapter.loadVideo("stall_timeout");
    emitMediaEvent(primaryAudio, "timeupdate", { currentTime: 1, duration: 200, paused: false });
    emitMediaEvent(primaryAudio, "waiting", { currentTime: 1, duration: 200, paused: false });
    await clock.advanceBy(4999);
    expect(primaryAudio.src).toBe("https://audio.example.com/stalling.m4a");

    await clock.advanceBy(1);
    expect(primaryAudio.src).toBe(proxyUrl("stall_timeout"));
    expect(primaryAudio.currentTime).toBe(1);
  });

  it("terminates a stalled playback episode within twenty seconds", async () => {
    const clock = useFakeClock();
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("episode_timeout", "https://audio.example.com/episode.m4a"),
    );
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);
    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    await adapter.loadVideo("episode_timeout");
    await clock.advanceBy(19_999);
    expect(states).not.toContain("ERROR");
    await clock.advanceBy(1);

    expect(states).toContain("ERROR");
    expect(clock.now()).toBe(20_000);
  });

  it("retries a failed direct/proxy cycle with 1s, 2s, and 4s backoff", async () => {
    const clock = useFakeClock();
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockClear();
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("retry_backoff", "https://audio.example.com/retry.m4a"),
    );
    primaryAudio.play = vi.fn().mockRejectedValue(new Error("upstream unavailable"));
    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    await adapter.loadVideo("retry_backoff");
    expect(vi.mocked(fetchInvidiousStream)).toHaveBeenCalledTimes(1);
    expect(primaryAudio.play).toHaveBeenCalledTimes(2);

    await clock.advanceBy(999);
    expect(vi.mocked(fetchInvidiousStream)).toHaveBeenCalledTimes(1);
    await clock.advanceBy(1);
    expect(vi.mocked(fetchInvidiousStream)).toHaveBeenCalledTimes(2);

    await clock.advanceBy(1999);
    expect(vi.mocked(fetchInvidiousStream)).toHaveBeenCalledTimes(2);
    await clock.advanceBy(1);
    expect(vi.mocked(fetchInvidiousStream)).toHaveBeenCalledTimes(3);

    await clock.advanceBy(3999);
    expect(vi.mocked(fetchInvidiousStream)).toHaveBeenCalledTimes(3);
    await clock.advanceBy(1);
    expect(vi.mocked(fetchInvidiousStream)).toHaveBeenCalledTimes(4);
    expect(states).toContain("ERROR");
  });

  it("cancels the recovery deadline after media time advances", async () => {
    const clock = useFakeClock();
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    vi.mocked(fetchInvidiousStream).mockResolvedValue(
      canonicalStream("steady_playback", "https://audio.example.com/steady.m4a", 180),
    );
    primaryAudio.play = vi.fn().mockResolvedValue(undefined);
    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    await adapter.loadVideo("steady_playback");
    emitMediaEvent(primaryAudio, "timeupdate", { currentTime: 0.5, duration: 180, paused: false });
    await clock.advanceBy(20_000);

    expect(states).toContain("PLAYING");
    expect(states).not.toContain("ERROR");
  });

  it("ignores a late play-promise callback from a superseded selection", async () => {
    const { fetchInvidiousStream } = await import("@/lib/piped/piped-client");
    const stalePlay = deferredPromise<void>();
    primaryAudio.play = vi.fn().mockReturnValueOnce(stalePlay.promise).mockResolvedValue(undefined);
    vi.mocked(fetchInvidiousStream).mockImplementation((videoId) =>
      Promise.resolve(canonicalStream(videoId, "https://audio.example.com/selection.m4a")),
    );
    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    const oldLoad = adapter.loadVideo("old_selection");
    await Promise.resolve();
    await Promise.resolve();
    const newLoad = adapter.loadVideo("new_selection");
    await newLoad;
    const statesAfterNewSelection = [...states];
    stalePlay.resolve(undefined);
    await oldLoad;

    expect(states).toEqual(statesAfterNewSelection);
  });
});
