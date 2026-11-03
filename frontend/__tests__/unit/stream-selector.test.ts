import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectBestAudioStream, isAppleWebKit } from "@/lib/piped/stream-selector";
import type { AudioStreamInfo } from "@/lib/audio/types";

describe("Audio Stream Selector", () => {
  const sampleStreams: AudioStreamInfo[] = [
    {
      url: "https://example.com/stream-opus-low.webm",
      format: "WEBM_OPUS",
      quality: "64kbps",
      mimeType: 'audio/webm; codecs="opus"',
      codec: "opus",
      bitrate: 64000,
    },
    {
      url: "https://example.com/stream-opus-high.webm",
      format: "WEBM_OPUS",
      quality: "160kbps",
      mimeType: 'audio/webm; codecs="opus"',
      codec: "opus",
      bitrate: 160000,
    },
    {
      url: "https://example.com/stream-m4a.m4a",
      format: "M4A",
      quality: "128kbps",
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      codec: "mp4a.40.2",
      bitrate: 128000,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when stream list is empty", () => {
    expect(selectBestAudioStream([])).toBeNull();
  });

  it("selects highest bitrate stream for desktop/Android when canPlayType supports all", () => {
    const mockAudio = {
      canPlayType: vi.fn().mockReturnValue("probably"),
    } as unknown as HTMLAudioElement;

    // Simulate standard Chrome userAgent
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
    });

    const best = selectBestAudioStream(sampleStreams, mockAudio);
    expect(best).not.toBeNull();
    expect(best?.bitrate).toBe(160000);
  });

  it("prioritizes M4A/AAC when running under Apple WebKit (iOS)", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });

    expect(isAppleWebKit()).toBe(true);

    const mockAudio = {
      canPlayType: vi.fn((type: string) => {
        if (type.includes("mp4") || type.includes("aac")) return "probably";
        return "";
      }),
    } as unknown as HTMLAudioElement;

    const best = selectBestAudioStream(sampleStreams, mockAudio);
    expect(best).not.toBeNull();
    expect(best?.format).toBe("M4A");
    expect(best?.mimeType).toContain("mp4");
  });
});

