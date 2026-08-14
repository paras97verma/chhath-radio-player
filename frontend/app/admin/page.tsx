"use client";

/**
 * Phase 8: Admin Dashboard
 *
 * Shows a login screen if not authenticated.
 * After login, shows the song catalog table with:
 * - Enable/disable toggles
 * - Add song form
 * - Delete button
 */

import { useState, useEffect, useCallback } from "react";
import {
  adminLogin,
  adminFetchSongs,
  adminCreateSong,
  adminUpdateSong,
  adminDeleteSong,
  type Song,
} from "@/lib/api";

const TOKEN_KEY = "chhath_admin_token";

// ─── Login Form ───────────────────────────────────────────────────────────────

function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { access_token } = await adminLogin(email, password);
      localStorage.setItem(TOKEN_KEY, access_token);
      onLogin(access_token);
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 rounded-2xl p-8 w-full max-w-sm space-y-4 shadow-xl"
        aria-label="Admin login"
      >
        <h1 className="text-2xl font-bold text-amber-400 text-center">
          🪔 Chhath Radio Admin
        </h1>

        {error && (
          <p className="text-red-400 text-sm text-center" role="alert">
            {error}
          </p>
        )}

        <div>
          <label htmlFor="email" className="block text-sm text-gray-400 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm text-gray-400 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg py-2 text-sm transition-colors disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}

// ─── Add Song Form ────────────────────────────────────────────────────────────

function AddSongForm({
  token,
  onAdded,
}: {
  token: string;
  onAdded: (song: Song) => void;
}) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const song = await adminCreateSong(token, {
        title,
        artist,
        youtube_url: youtubeUrl,
        sort_order: parseInt(sortOrder, 10),
      });
      onAdded(song);
      setTitle("");
      setArtist("");
      setYoutubeUrl("");
      setSortOrder("0");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add song.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-gray-900 rounded-xl p-4 space-y-3"
      aria-label="Add new song"
    >
      <h2 className="text-sm font-semibold text-amber-400">Add New Song</h2>

      {error && (
        <p className="text-red-400 text-xs" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          aria-label="Song title"
          className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <input
          placeholder="Artist"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          required
          aria-label="Artist name"
          className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <input
          placeholder="YouTube URL"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          required
          aria-label="YouTube URL"
          className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 md:col-span-2"
        />
        <input
          type="number"
          placeholder="Sort order"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          aria-label="Sort order"
          className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
      >
        {loading ? "Adding…" : "Add Song"}
      </button>
    </form>
  );
}

// ─── Song Table ───────────────────────────────────────────────────────────────

function SongTable({
  songs,
  token,
  onUpdate,
  onDelete,
}: {
  songs: Song[];
  token: string;
  onUpdate: (song: Song) => void;
  onDelete: (id: string) => void;
}) {
  const handleToggle = async (song: Song) => {
    const updated = await adminUpdateSong(token, song.id, { enabled: !song.enabled });
    onUpdate(updated);
  };

  const handleDelete = async (song: Song) => {
    if (!confirm(`Delete "${song.title}"? This cannot be undone.`)) return;
    await adminDeleteSong(token, song.id);
    onDelete(song.id);
  };

  return (
    <div className="overflow-x-auto rounded-xl">
      <table className="w-full text-sm" aria-label="Song catalog">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-800">
            <th className="pb-2 pr-4">Title</th>
            <th className="pb-2 pr-4">Artist</th>
            <th className="pb-2 pr-4">Order</th>
            <th className="pb-2 pr-4">Enabled</th>
            <th className="pb-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {songs.map((song) => (
            <tr
              key={song.id}
              className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
            >
              <td className="py-2 pr-4 text-white">{song.title}</td>
              <td className="py-2 pr-4 text-gray-400">{song.artist}</td>
              <td className="py-2 pr-4 text-gray-400">{song.sort_order}</td>
              <td className="py-2 pr-4">
                <button
                  onClick={() => handleToggle(song)}
                  aria-label={`${song.enabled ? "Disable" : "Enable"} ${song.title}`}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                    song.enabled ? "bg-amber-500" : "bg-gray-600"
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      song.enabled ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </td>
              <td className="py-2">
                <button
                  onClick={() => handleDelete(song)}
                  aria-label={`Delete ${song.title}`}
                  className="text-red-400 hover:text-red-300 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-red-400 rounded"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {songs.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-8">
          No songs yet. Add one above.
        </p>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSongs = useCallback(async () => {
    try {
      const data = await adminFetchSongs(token);
      setSongs(data);
    } catch {
      onLogout(); // Token expired or invalid
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-amber-400">🪔 Song Catalog</h1>
          <div className="flex gap-3">
            <a
              href="/"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              ← Back to Radio
            </a>
            <button
              onClick={onLogout}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        <AddSongForm
          token={token}
          onAdded={(song) => setSongs((prev) => [...prev, song])}
        />

        {loading ? (
          <p className="text-gray-500 text-sm text-center py-8">Loading songs…</p>
        ) : (
          <SongTable
            songs={songs}
            token={token}
            onUpdate={(updated) =>
              setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
            }
            onDelete={(id) => setSongs((prev) => prev.filter((s) => s.id !== id))}
          />
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) setToken(stored);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  };

  if (!token) {
    return <LoginForm onLogin={setToken} />;
  }

  return <Dashboard token={token} onLogout={handleLogout} />;
}