/**
 * API client for the Chhath Radio backend.
 * All fetch calls go through this module.
 */

// Use relative URLs so Next.js rewrites proxy /api/* → backend.
// NEXT_PUBLIC_API_URL can override for direct backend access (e.g. production).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface Song {
  id: string;
  title: string;
  artist: string;
  youtube_video_id: string;
  youtube_url: string | null;
  category: string | null;
  enabled: boolean;
  sort_order: number;
}

export interface Channel {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  songs: Song[];
}

export interface FestivalDay {
  id: string;
  date: string;
  state: string;
  title: string;
}

export interface ListenerCount {
  count: number;
}

export interface ChhathFact {
  id: number;
  fact: string;
  category: string;
  status: string;
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  ts: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function fetchRadioQueue(): Promise<Song[]> {
  // 7-day revalidation — safe because the backend Redis cache is explicitly
  // invalidated on every admin write (create/update/delete). The Next.js cache
  // will be stale at most until the next deployment or manual revalidation.
  const res = await fetch(`${API_BASE}/api/radio/queue`, { next: { revalidate: 604_800 } });
  if (!res.ok) throw new Error("Failed to fetch radio queue");
  return res.json();
}

export async function fetchSongs(): Promise<Song[]> {
  const res = await fetch(`${API_BASE}/api/songs`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch songs");
  return res.json();
}

export async function fetchChannel(slug: string): Promise<Channel> {
  const res = await fetch(`${API_BASE}/api/channels/${slug}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch channel: ${slug}`);
  return res.json();
}

export async function fetchCurrentFestival(): Promise<FestivalDay | null> {
  const res = await fetch(`${API_BASE}/api/festival/current`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchFacts(): Promise<ChhathFact[]> {
  const res = await fetch(`${API_BASE}/api/facts`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchListenerCount(): Promise<number> {
  const res = await fetch(`${API_BASE}/api/presence/listeners`, { cache: "no-store" });
  if (!res.ok) return 0;
  const data: ListenerCount = await res.json();
  return data.count;
}

export async function sendHeartbeat(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/api/presence/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

// ─── Chat HTTP API (fallback / admin use) ─────────────────────────────────────

export async function fetchChatHistory(limit = 50): Promise<ChatMessage[]> {
  try {
    const res = await fetch(`${API_BASE}/api/chat/messages?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function postChatMessage(name: string, text: string): Promise<ChatMessage> {
  const res = await fetch(`${API_BASE}/api/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? "Failed to send message");
  }
  return res.json();
}

// ─── Chat WebSocket ────────────────────────────────────────────────────────────
//
// Primary real-time chat transport. Replaces the SSE-based chat relay.
//
// Server → Client events:
//   {"type": "history",      "messages": ChatMessage[]}   — on connect
//   {"type": "chat_message", "id": string, "name": string, "text": string, "ts": number}
//   {"type": "error",        "detail": string}            — rate limit / validation
//
// Client → Server:
//   {"name": string, "text": string}

export type ChatWsEvent =
  | { type: "history"; messages: ChatMessage[] }
  | { type: "chat_message"; id: string; name: string; text: string; ts: number; _nonce?: string }
  | { type: "error"; detail: string };

/**
 * Open a WebSocket connection to the chat endpoint.
 * Returns the WebSocket instance so the caller can close it on unmount.
 *
 * Usage in a React component:
 *   useEffect(() => {
 *     const ws = connectChatWebSocket(sessionId, (event) => {
 *       if (event.type === "history")      setMessages(event.messages);
 *       if (event.type === "chat_message") setMessages((prev) => [...prev, event]);
 *     });
 *     return () => ws.close();
 *   }, [sessionId]);
 */
export function connectChatWebSocket(
  sessionId: string,
  onEvent: (event: ChatWsEvent) => void,
): WebSocket {
  // Convert https:// → wss://, http:// → ws:// for the backend URL.
  // Falls back to a relative ws:// path when NEXT_PUBLIC_API_URL is not set
  // (Next.js dev server proxies /api/* to the backend).
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "")
    .replace(/^https:\/\//, "wss://")
    .replace(/^http:\/\//, "ws://");

  const ws = new WebSocket(`${base}/api/ws/chat?session_id=${sessionId}`);

  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data) as ChatWsEvent);
    } catch {
      // ignore malformed frames
    }
  };

  return ws;
}

/**
 * Send a chat message over an open WebSocket connection.
 * No-op if the socket is not in OPEN state.
 */
export function sendChatMessageWs(ws: WebSocket, name: string, text: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ name, text }));
  }
}

// ─── Admin API ────────────────────────────────────────────────────────────────

export async function adminLogin(
  email: string,
  password: string
): Promise<{ access_token: string; token_type: string }> {
  // Obfuscate password in Network tab payload using Base64
  const obfuscatedPassword =
    typeof btoa !== "undefined"
      ? btoa(unescape(encodeURIComponent(password)))
      : password;

  const res = await fetch(`${API_BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: obfuscatedPassword }),
  });
  if (!res.ok) throw new Error("Invalid credentials");
  return res.json();
}

export async function adminFetchSongs(token: string): Promise<Song[]> {
  const res = await fetch(`${API_BASE}/api/admin/songs`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Unauthorized");
  return res.json();
}

export async function adminCreateSong(
  token: string,
  data: { title?: string; artist?: string; youtube_url: string; category?: string }
): Promise<Song> {
  const res = await fetch(`${API_BASE}/api/admin/songs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "Failed to create song");
  }
  return res.json();
}

export async function adminCreateSongsBatch(
  token: string,
  urls: string
): Promise<Song[]> {
  const res = await fetch(`${API_BASE}/api/admin/songs/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "Failed to batch upload songs");
  }
  return res.json();
}

export async function adminUpdateSong(
  token: string,
  songId: string,
  data: Partial<{ title: string; artist: string; category: string; enabled: boolean; sort_order: number; youtube_url: string }>
): Promise<Song> {
  const res = await fetch(`${API_BASE}/api/admin/songs/${songId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update song");
  return res.json();
}

export async function adminDeleteSong(token: string, songId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/songs/${songId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to delete song");
}