/**
 * API client for the Chhath Radio backend.
 * All fetch calls go through this module.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

// ─── Public API ──────────────────────────────────────────────────────────────

export async function fetchRadioQueue(): Promise<Song[]> {
  const res = await fetch(`${API_BASE}/api/radio/queue`, { cache: "no-store" });
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

// ─── Admin API ────────────────────────────────────────────────────────────────

export async function adminLogin(
  email: string,
  password: string
): Promise<{ access_token: string; token_type: string }> {
  const res = await fetch(`${API_BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
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
  data: { title: string; artist: string; youtube_url: string; category?: string; sort_order?: number }
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

export async function adminUpdateSong(
  token: string,
  songId: string,
  data: Partial<{ title: string; artist: string; enabled: boolean; sort_order: number; youtube_url: string }>
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