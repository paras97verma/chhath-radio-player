import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/stream/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stream metadata route", () => {
  it("passes backend metadata through without caching and uses a five-second deadline", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"video_id":"abcdefghijk","generation":3}', {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/api/stream?v=abcdefghijk"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(await response.text()).toBe('{"video_id":"abcdefghijk","generation":3}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(timeout).toHaveBeenCalledWith(5000);
  });

  it("passes backend unavailable responses through without trying another provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"error":"stream_unavailable","retryable":true}', {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/api/stream?v=abcdefghijk"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns no-store retryable failure when the backend request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("backend timeout"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/api/stream?v=abcdefghijk"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(await response.json()).toEqual({ error: "stream_unavailable", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid IDs before contacting the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/api/stream?v=bad%2Fid"));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
