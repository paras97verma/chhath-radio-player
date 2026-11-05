import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPipedStream, reportStreamFailure } from "@/lib/piped/piped-client";
import type { AudioStreamInfo, CanonicalStreamCandidate } from "@/lib/audio/types";

function currentResponse(videoId: string): AudioStreamInfo {
  const now = Math.floor(Date.now() / 1000);
  const directUrl = "https://googlevideo.example/audio.m4a";
  const proxyUrl = `https://inv.example.test/latest_version?id=${videoId}&itag=140&local=true`;
  const source = (mode: "direct" | "proxy", url: string): CanonicalStreamCandidate => ({
    mode,
    provider: "invidious",
    provider_origin: "https://inv.example.test",
    url,
    itag: 140,
    mime_type: 'audio/mp4; codecs="mp4a.40.2"',
    codec: "mp4a.40.2",
    resolved_at: now,
    expires_at: null,
    refresh_at: now + 1200,
    validation_state: "validated",
  });
  return {
    title: "Chhath Song",
    url: directUrl,
    direct_url: directUrl,
    proxy_url: proxyUrl,
    status: "READY",
    schema_version: 1,
    video_id: videoId,
    generation: 9,
    refreshed_at: now,
    sources: [source("direct", directUrl), source("proxy", proxyUrl)],
    format: "M4A",
    quality: "128kbps",
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    codec: "mp4a.40.2",
    bitrate: 128000,
  };
}

function jsonResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

describe("Piped Stream Client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws error if invalid videoId is provided", async () => {
    await expect(fetchPipedStream("")).rejects.toThrow("Invalid videoId provided");
  });

  it("fetches audio streams and resolves best stream on HTTP 200", async () => {
    const mockApiResponse = currentResponse("dQw4w9WgXcQ");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      })
    );

    const stream = await fetchPipedStream("dQw4w9WgXcQ");
    expect(stream.url).toBe("https://googlevideo.example/audio.m4a");
    expect(stream.format).toBe("M4A");
  });

  it("does not retain completed URLs between playback resolutions", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => currentResponse("vid12345"),
    }));

    vi.stubGlobal("fetch", fetchMock);

    await fetchPipedStream("vid12345");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const refreshedStream = await fetchPipedStream("vid12345");
    expect(refreshedStream.url).toBe("https://googlevideo.example/audio.m4a");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces only concurrent requests for the same ID and refresh mode", async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      new Promise<Response>((resolve) => { resolveResponse = resolve; })
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = fetchPipedStream("vidConcurrent");
    const second = fetchPipedStream("vidConcurrent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse(jsonResponse(currentResponse("vidConcurrent")));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    fetchMock.mockImplementation(async () => jsonResponse(currentResponse("vidConcurrent")));
    await fetchPipedStream("vidConcurrent", null, undefined, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/stream?v=vidConcurrent&force_fresh=true");
  });

  it("keeps a shared resolution alive when one caller aborts", async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      new Promise<Response>((resolve) => { resolveResponse = resolve; })
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const cancelled = fetchPipedStream("vidAbortOne", null, controller.signal);
    const surviving = fetchPipedStream("vidAbortOne");

    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    resolveResponse(jsonResponse(currentResponse("vidAbortOne")));
    await expect(surviving).resolves.toMatchObject({ video_id: "vidAbortOne" });
  });

  it("rejects when every returned source is expired, refresh-due, or unsupported", async () => {
    const response = currentResponse("vidInvalid");
    const sources = response.sources as CanonicalStreamCandidate[];
    response.sources = [
      { ...sources[0], refresh_at: Math.floor(Date.now() / 1000) - 1 },
      { ...sources[1], mime_type: "video/mp4" },
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPipedStream("vidInvalid")).rejects.toThrow("no current playable source");
  });

  it("keeps an independently valid proxy when the direct URL is near expiry", async () => {
    const response = currentResponse("vidProxyOnly");
    const now = Math.floor(Date.now() / 1000);
    const sources = response.sources as CanonicalStreamCandidate[];
    sources[0] = {
      ...sources[0],
      expires_at: now + 300,
      refresh_at: now + 200,
      url: `https://googlevideo.example/audio.m4a?expire=${now + 300}`,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal("fetch", fetchMock);

    const stream = await fetchPipedStream("vidProxyOnly");
    expect(stream.status).toBe("DEGRADED");
    expect(stream.url).toContain("/latest_version");
    expect(stream.direct_url).toBeUndefined();
    expect(stream.proxy_url).toContain("/latest_version");
  });

  it("fails closed when the same-origin resolver is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPipedStream("vidFallback")).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/stream?v=vidFallback");
  });

  it("rejects legacy provider payloads instead of accepting audioStreams", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        audioStreams: [{ url: "https://unrelated.example/audio.m4a" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPipedStream("vidLegacyProvider")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("immediately stops and rejects with AbortError when AbortSignal is triggered", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(fetchPipedStream("vidAbort", null, controller.signal)).rejects.toThrow();
  });

  it("reports failure telemetry from explicit candidate metadata", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => currentResponse("vidTelemetry"),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchPipedStream("vidTelemetry");
    await reportStreamFailure("vidTelemetry", "direct", "media_error", {
      providerOrigin: "https://inv.example.test",
      generation: first.generation!,
    });
    const second = await fetchPipedStream("vidTelemetry");

    expect(first.url).toBe("https://googlevideo.example/audio.m4a");
    expect(second.url).toBe(first.url);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/stream/source-failure");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      cache: "no-store",
      keepalive: true,
      body: JSON.stringify({
        video_id: "vidTelemetry",
        mode: "direct",
        provider: "https://inv.example.test",
        generation: 9,
        reason: "media_error",
      }),
    });
  });
});
