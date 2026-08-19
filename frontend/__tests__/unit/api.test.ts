/**
 * Unit tests for lib/api.ts
 *
 * Uses vi.stubGlobal('fetch', ...) to mock the global fetch function.
 * No real network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchRadioQueue,
  fetchListenerCount,
  sendHeartbeat,
  fetchChatHistory,
  postChatMessage,
  adminLogin,
} from "../../lib/api";
import type { Song, ChatMessage } from "../../lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-id-1",
    title: "Kaanch Hi Baans",
    artist: "Sharda Sinha",
    youtube_video_id: "dQw4w9WgXcQ",
    youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    category: "chhath",
    enabled: true,
    sort_order: 0,
    ...overrides,
  };
}

function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-id-1",
    name: "Bhakt",
    text: "Jai Chhathi Maiya!",
    ts: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new Error("Network error"));
}

// ─── TestFetchRadioQueue ───────────────────────────────────────────────────────

describe("TestFetchRadioQueue", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("successful fetch returns Song[]", async () => {
    const songs = [makeSong(), makeSong({ id: "song-2", title: "Kelwa" })];
    vi.stubGlobal("fetch", mockFetch(songs));

    const result = await fetchRadioQueue();

    expect(result).toEqual(songs);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/radio/queue"),
      expect.any(Object)
    );
  });

  it("non-ok response throws Error", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false, 500));

    await expect(fetchRadioQueue()).rejects.toThrow("Failed to fetch radio queue");
  });
});

// ─── TestFetchListenerCount ────────────────────────────────────────────────────

describe("TestFetchListenerCount", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("successful fetch returns count number", async () => {
    vi.stubGlobal("fetch", mockFetch({ count: 42 }));

    const count = await fetchListenerCount();

    expect(count).toBe(42);
  });

  it("non-ok response returns 0", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false, 503));

    const count = await fetchListenerCount();

    expect(count).toBe(0);
  });
});

// ─── TestSendHeartbeat ────────────────────────────────────────────────────────

describe("TestSendHeartbeat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls POST /api/presence/heartbeat with correct body", async () => {
    const fetchMock = mockFetch({}, true, 204);
    vi.stubGlobal("fetch", fetchMock);

    await sendHeartbeat("my-session-id");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/presence/heartbeat"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ session_id: "my-session-id" }),
      })
    );
  });
});

// ─── TestFetchChatHistory ─────────────────────────────────────────────────────

describe("TestFetchChatHistory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("successful fetch returns ChatMessage[]", async () => {
    const messages = [makeChatMessage(), makeChatMessage({ id: "msg-2", text: "Jai!" })];
    vi.stubGlobal("fetch", mockFetch(messages));

    const result = await fetchChatHistory();

    expect(result).toEqual(messages);
  });

  it("non-ok response returns empty array", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false, 500));

    const result = await fetchChatHistory();

    expect(result).toEqual([]);
  });

  it("network error returns empty array", async () => {
    vi.stubGlobal("fetch", mockFetchNetworkError());

    const result = await fetchChatHistory();

    expect(result).toEqual([]);
  });
});

// ─── TestPostChatMessage ──────────────────────────────────────────────────────

describe("TestPostChatMessage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("successful POST returns ChatMessage", async () => {
    const msg = makeChatMessage();
    vi.stubGlobal("fetch", mockFetch(msg, true, 201));

    const result = await postChatMessage("Bhakt", "Jai Chhathi!");

    expect(result).toEqual(msg);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/chat/messages"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Bhakt", text: "Jai Chhathi!" }),
      })
    );
  });

  it("non-ok response throws Error with detail from response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({ detail: "Please wait 3 seconds between messages." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(postChatMessage("Bhakt", "Too fast!")).rejects.toThrow(
      "Please wait 3 seconds between messages."
    );
  });

  it("non-ok response with no detail throws generic error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(postChatMessage("Bhakt", "Hello")).rejects.toThrow("Failed to send message");
  });
});

// ─── TestAdminLogin ───────────────────────────────────────────────────────────

describe("TestAdminLogin", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("successful POST returns access_token and token_type", async () => {
    const tokenResponse = { access_token: "jwt-token-abc", token_type: "bearer" };
    vi.stubGlobal("fetch", mockFetch(tokenResponse));

    const result = await adminLogin("admin@test.com", "password123");

    expect(result).toEqual(tokenResponse);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/login"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "admin@test.com", password: btoa("password123") }),
      })
    );
  });

  it("non-ok response throws 'Invalid credentials'", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false, 401));

    await expect(adminLogin("wrong@test.com", "wrongpass")).rejects.toThrow("Invalid credentials");
  });
});