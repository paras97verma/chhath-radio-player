import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectBestAudioStream, isAppleWebKit } from "@/lib/piped/stream-selector";
import type { AudioStreamInfo, CanonicalStreamCandidate } from "@/lib/audio/types";

function makeStream(
  id: string,
  url: string,
  mimeType: string,
  bitrate: number,
  mode: "direct" | "proxy" = "direct",
  sourceOverrides: Partial<CanonicalStreamCandidate> = {},
): AudioStreamInfo {
  const now = Math.floor(Date.now() / 1000);
  const source: CanonicalStreamCandidate = {
    mode,
    provider: "invidious",
    provider_origin: "https://inv.example.test",
    url,
    itag: 140,
    mime_type: mimeType,
    codec: mimeType.includes("opus") ? "opus" : "mp4a.40.2",
    resolved_at: now,
    expires_at: null,
    refresh_at: now + 1200,
    validation_state: "validated",
    ...sourceOverrides,
  };
  return {
    url,
    format: mimeType.includes("webm") ? "WEBM_OPUS" : "M4A",
    quality: `${Math.round(bitrate / 1000)}kbps`,
    mimeType,
    codec: source.codec || "",
    bitrate,
    schema_version: 1,
    video_id: id,
    generation: 1,
    refreshed_at: now,
    sources: [source],
  };
}

describe("Audio Stream Selector", () => {
  const sampleStreams: AudioStreamInfo[] = [
    makeStream("song123", "https://googlevideo.example/opus-low.webm", 'audio/webm; codecs="opus"', 64000),
    makeStream("song123", "https://googlevideo.example/opus-high.webm", 'audio/webm; codecs="opus"', 160000),
    makeStream("song123", "https://googlevideo.example/aac.m4a", 'audio/mp4; codecs="mp4a.40.2"', 128000),
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns null when stream list is empty", () => {
    expect(selectBestAudioStream([])).toBeNull();
  });

  it("requires the current audio element to confirm format support", () => {
    expect(selectBestAudioStream(sampleStreams)).toBeNull();
  });

  it("selects the highest bitrate among current formats the browser accepts", () => {
    const mockAudio = { canPlayType: vi.fn().mockReturnValue("probably") } as unknown as HTMLAudioElement;
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
    });

    const best = selectBestAudioStream(sampleStreams, mockAudio);
    expect(best?.bitrate).toBe(160000);
  });

  it("prioritizes M4A/AAC under Apple WebKit", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    });
    expect(isAppleWebKit()).toBe(true);

    const mockAudio = { canPlayType: vi.fn().mockReturnValue("probably") } as unknown as HTMLAudioElement;
    const best = selectBestAudioStream(sampleStreams, mockAudio);
    expect(best?.format).toBe("M4A");
    expect(best?.mimeType).toContain("mp4");
  });

  it("selects WebM when the current engine accepts WebM and rejects AAC", () => {
    const mockAudio = {
      canPlayType: vi.fn((type: string) => type.includes("webm") ? "maybe" : ""),
    } as unknown as HTMLAudioElement;
    const best = selectBestAudioStream(sampleStreams, mockAudio);
    expect(best?.format).toBe("WEBM_OPUS");
    expect(best?.mimeType).toContain("audio/webm");
  });

  it("rejects expired, refresh-due, malformed, non-Invidious, and non-audio sources", () => {
    const now = Math.floor(Date.now() / 1000);
    const candidates = [
      makeStream("song123", "https://googlevideo.example/expired.m4a?expire=1700000000", 'audio/mp4; codecs="mp4a.40.2"', 128000, "direct", {
        expires_at: 1700000000,
      }),
      makeStream("song123", "https://googlevideo.example/due.m4a", 'audio/mp4; codecs="mp4a.40.2"', 128000, "direct", {
        refresh_at: now - 1,
      }),
      makeStream("song123", "http://googlevideo.example/insecure.m4a", 'audio/mp4; codecs="mp4a.40.2"', 128000),
      makeStream("song123", "https://googlevideo.example/wrong-provider.m4a", 'audio/mp4; codecs="mp4a.40.2"', 128000, "direct", {
        provider: "other" as "invidious",
      }),
      makeStream("song123", "https://googlevideo.example/video.mp4", "video/mp4", 128000),
      makeStream("song123", "https://googlevideo.example/unsupported.ogg", 'audio/ogg; codecs="vorbis"', 128000),
    ];
    expect(selectBestAudioStream(candidates)).toBeNull();
  });

  it("orders a playable direct source before a higher-bitrate proxy fallback", () => {
    const direct = makeStream("song123", "https://googlevideo.example/direct.m4a", 'audio/mp4; codecs="mp4a.40.2"', 96000, "direct");
    const proxy = makeStream("song123", "https://inv.example.test/latest_version?id=song123&itag=140&local=true", 'audio/mp4; codecs="mp4a.40.2"', 320000, "proxy");
    const mockAudio = { canPlayType: vi.fn().mockReturnValue("probably") } as unknown as HTMLAudioElement;

    const best = selectBestAudioStream([proxy, direct], mockAudio);

    expect(best?.sources?.[0]).toMatchObject({ mode: "direct" });
  });

  it("does not fall back to a stream the media element reports as unsupported", () => {
    const mockAudio = { canPlayType: vi.fn().mockReturnValue("") } as unknown as HTMLAudioElement;
    expect(selectBestAudioStream(sampleStreams, mockAudio)).toBeNull();
  });
});
