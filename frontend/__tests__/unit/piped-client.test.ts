import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPipedStream, clearStreamCache } from "@/lib/piped/piped-client";

describe("Piped Stream Client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearStreamCache();
  });

  it("throws error if invalid videoId is provided", async () => {
    await expect(fetchPipedStream("")).rejects.toThrow("Invalid videoId provided");
  });

  it("fetches audio streams and resolves best stream on HTTP 200", async () => {
    const mockApiResponse = {
      title: "Chhath Song",
      url: "https://audio-cdn.example.com/audio.m4a",
      format: "M4A",
      quality: "128kbps",
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      codec: "mp4a.40.2",
      bitrate: 128000,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      })
    );

    const stream = await fetchPipedStream("dQw4w9WgXcQ");
    expect(stream.url).toBe("https://audio-cdn.example.com/audio.m4a");
    expect(stream.format).toBe("M4A");
  });

  it("caches resolved streams to avoid redundant network requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: "https://audio-cdn.example.com/audio.m4a",
        format: "M4A",
        quality: "128kbps",
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        codec: "mp4a.40.2",
        bitrate: 128000,
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    // Call 1: network hit
    await fetchPipedStream("vid12345");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Call 2: in-memory cache hit
    const cachedStream = await fetchPipedStream("vid12345");
    expect(cachedStream.url).toBe("https://audio-cdn.example.com/audio.m4a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rotates to next instance if current instance returns HTTP 500", async () => {
    let streamCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        // Bypass /api/stream to test instance rotation fallback
        if (url.startsWith("/api/stream")) {
          return Promise.resolve({ ok: false, status: 502 });
        }
        // Direct stream calls
        if (url.includes("streams") || url.includes("videos")) {
          streamCalls++;
          if (streamCalls === 1) {
            // Instance 1 fails
            return Promise.resolve({ ok: false, status: 500 });
          }
          // Instance 2 succeeds
          return Promise.resolve({
            ok: true,
            json: async () => ({
              audioStreams: [
                {
                  url: "https://instance2.example.com/audio.m4a",
                  format: "M4A",
                  quality: "128kbps",
                  mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                  codec: "mp4a.40.2",
                  bitrate: 128000,
                },
              ],
              adaptiveFormats: [
                {
                  type: 'audio/mp4; codecs="mp4a.40.2"',
                  url: "https://instance2.example.com/audio.m4a",
                  audioQuality: "128kbps",
                  bitrate: 128000,
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      })
    );

    const stream = await fetchPipedStream("vidFallback");
    expect(streamCalls).toBe(2);
    expect(stream.url).toBe("https://instance2.example.com/audio.m4a");
  });

  it("immediately stops and rejects with AbortError when AbortSignal is triggered", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(fetchPipedStream("vidAbort", null, controller.signal)).rejects.toThrow();
  });
});
