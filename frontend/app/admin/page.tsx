"use client";

/**
 * Phase 8: Admin Dashboard
 *
 * Shows a login screen if not authenticated.
 * After login, shows the song catalog table with:
 * - Full page vertical scrolling (h-screen overflow-y-auto)
 * - Auto-populated sort order on Add Song form (from max sort_order + 1)
 * - HTML5 Drag & Drop row reordering for easy custom sort order adjustment
 * - Live search filter (title / artist)
 * - Status filter tabs (All / Enabled / Disabled)
 * - Bulk select (select all / select individual)
 * - Bulk delete and bulk enable/disable actions
 * - Single item enable/disable toggles & delete actions
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  adminLogin,
  adminFetchSongs,
  adminCreateSong,
  adminCreateSongsBatch,
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
    <div className="fixed inset-0 bg-gray-950 flex items-center justify-center px-4 overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-sm space-y-4 shadow-2xl my-auto"
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
          <label htmlFor="email" className="block text-sm text-gray-400 mb-1 font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm text-gray-400 mb-1 font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg py-2.5 text-sm transition-all shadow-md active:scale-[0.99] disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}

// ─── Add Song Form ────────────────────────────────────────────────────────────

// ─── Add Song Form (Multi-URL Upload) ──────────────────────────────────────────

function AddSongForm({
  token,
  onAddedBatch,
}: {
  token: string;
  onAddedBatch: (newSongs: Song[]) => void;
}) {
  const [urlsText, setUrlsText] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    if (!urlsText.trim()) return;

    setLoading(true);
    try {
      const addedSongs = await adminCreateSongsBatch(token, urlsText);
      onAddedBatch(addedSongs);
      setSuccessMsg(`Successfully processed ${addedSongs.length} song(s)! Existing duplicates skipped.`);
      setUrlsText("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload songs.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4 shadow-md"
      aria-label="Upload YouTube songs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-800 pb-3">
        <h2 className="text-base font-semibold text-amber-400 flex items-center gap-2">
          <span>➕ Upload YouTube Songs</span>
        </h2>
        <span className="text-xs text-amber-300/80 font-normal bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20">
          💡 Paste single or multiple YouTube links — Titles, Artists, & Sort Orders auto-populate cleanly!
        </span>
      </div>

      {error && (
        <p className="text-red-400 text-xs bg-red-950/50 border border-red-800/50 p-2.5 rounded-lg" role="alert">
          {error}
        </p>
      )}

      {successMsg && (
        <p className="text-emerald-400 text-xs bg-emerald-950/50 border border-emerald-800/50 p-2.5 rounded-lg">
          ✓ {successMsg}
        </p>
      )}

      <div>
        <label className="block text-xs font-semibold text-amber-300 mb-1.5">
          YouTube URL(s) <span className="text-red-400">*</span>
        </label>
        <textarea
          rows={3}
          placeholder="Paste one or multiple YouTube links here (one per line, or comma-separated)...&#10;https://www.youtube.com/watch?v=...&#10;https://youtu.be/..."
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          required
          aria-label="YouTube URLs"
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono text-xs"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !urlsText.trim()}
        className="bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg px-5 py-2.5 text-sm transition-all shadow-md active:scale-[0.99] disabled:opacity-50"
      >
        {loading ? "Processing & Uploading…" : "Upload Songs to Catalog"}
      </button>
    </form>
  );
}

// ─── Edit Song Modal ──────────────────────────────────────────────────────────

function EditSongModal({
  song,
  token,
  onClose,
  onUpdated,
}: {
  song: Song;
  token: string;
  onClose: () => void;
  onUpdated: (updated: Song) => void;
}) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [category, setCategory] = useState(song.category ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const updated = await adminUpdateSong(token, song.id, {
        title: title.trim(),
        artist: artist.trim(),
        category: category.trim() || undefined,
      });
      onUpdated(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update song metadata.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-5 text-white">
        <div className="flex items-center justify-between border-b border-gray-800 pb-3">
          <h3 className="text-lg font-bold text-amber-400 flex items-center gap-2">
            <span>✏️ Edit Song Metadata</span>
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg px-2 rounded-lg hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="text-red-400 text-xs bg-red-950/50 border border-red-800/50 p-2.5 rounded-lg">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-amber-300 mb-1">
              Song Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-amber-300 mb-1">
              Artist Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Category</label>
              <input
                type="text"
                placeholder="e.g. Bhajan / Arghya"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Sort Order</label>
              <input
                type="text"
                disabled
                value={`${song.sort_order} (Auto)`}
                className="w-full bg-gray-800/50 border border-gray-800 text-gray-400 rounded-lg px-3 py-2 text-sm cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              YouTube URL <span className="text-gray-500 font-normal">(Read-only)</span>
            </label>
            <input
              type="text"
              disabled
              value={song.youtube_url ?? `https://www.youtube.com/watch?v=${song.youtube_video_id}`}
              className="w-full bg-gray-800/50 border border-gray-800 text-gray-400 rounded-lg px-3 py-2 text-sm cursor-not-allowed font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white rounded-lg hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-lg transition-all shadow-md active:scale-95 disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Dashboard Main ───────────────────────────────────────────────────────────

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSong, setEditingSong] = useState<Song | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);

  // Drag & Drop State
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  // Compute next sort order auto-increment value
  const nextSortOrder = useMemo(() => {
    if (songs.length === 0) return 1;
    const maxOrder = Math.max(...songs.map((s) => s.sort_order ?? 0));
    return maxOrder + 1;
  }, [songs]);

  // Filtered songs
  const filteredSongs = useMemo(() => {
    return songs.filter((s) => {
      const matchesSearch =
        searchQuery.trim() === "" ||
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.artist.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "enabled"
          ? s.enabled
          : !s.enabled;

      return matchesSearch && matchesStatus;
    });
  }, [songs, searchQuery, statusFilter]);

  // Bulk Selection Handlers
  const isAllSelected =
    filteredSongs.length > 0 &&
    filteredSongs.every((s) => selectedIds.has(s.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSongs.map((s) => s.id)));
    }
  };

  const toggleSelectSong = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Bulk Actions
  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (
      !confirm(
        `Are you sure you want to delete ${count} selected song(s)? This action CANNOT be undone.`
      )
    )
      return;

    setIsProcessingBulk(true);
    try {
      const idsArray = Array.from(selectedIds);
      await Promise.all(idsArray.map((id) => adminDeleteSong(token, id)));
      setSongs((prev) => prev.filter((s) => !selectedIds.has(s.id)));
      setSelectedIds(new Set());
    } catch {
      alert("Failed to delete some selected songs. Please try again.");
    } finally {
      setIsProcessingBulk(false);
    }
  };

  const handleBulkToggleEnabled = async (enabled: boolean) => {
    const count = selectedIds.size;
    if (count === 0) return;

    setIsProcessingBulk(true);
    try {
      const idsArray = Array.from(selectedIds);
      const updatedList = await Promise.all(
        idsArray.map((id) => adminUpdateSong(token, id, { enabled }))
      );
      const updatedMap = new Map(updatedList.map((s) => [s.id, s]));
      setSongs((prev) => prev.map((s) => updatedMap.get(s.id) ?? s));
      setSelectedIds(new Set());
    } catch {
      alert("Failed to update some selected songs.");
    } finally {
      setIsProcessingBulk(false);
    }
  };

  // Drag & Drop Reordering Handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const reordered = [...filteredSongs];
    const [movedSong] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, movedSong);

    // Assign new sequential sort_order (1-indexed)
    const updatedSongsWithOrder = reordered.map((song, idx) => ({
      ...song,
      sort_order: idx + 1,
    }));

    // Update local state immediately
    setSongs((prev) => {
      const updatedMap = new Map(updatedSongsWithOrder.map((s) => [s.id, s]));
      return prev.map((s) => updatedMap.get(s.id) ?? s);
    });

    setDraggedIndex(null);
    setDragOverIndex(null);

    // Persist updated sort orders to backend
    try {
      const changed = updatedSongsWithOrder.filter((s) => {
        const original = songs.find((o) => o.id === s.id);
        return original && original.sort_order !== s.sort_order;
      });
      await Promise.all(
        changed.map((s) => adminUpdateSong(token, s.id, { sort_order: s.sort_order }))
      );
    } catch {
      alert("Failed to save new song order to server. Please refresh.");
    }
  };

  // Single Item Actions
  const handleSingleToggle = async (song: Song) => {
    try {
      const updated = await adminUpdateSong(token, song.id, {
        enabled: !song.enabled,
      });
      setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch {
      alert("Failed to toggle song status.");
    }
  };

  const handleSingleDelete = async (song: Song) => {
    if (!confirm(`Delete "${song.title}"? This cannot be undone.`)) return;
    try {
      await adminDeleteSong(token, song.id);
      setSongs((prev) => prev.filter((s) => s.id !== song.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(song.id);
        return next;
      });
    } catch {
      alert("Failed to delete song.");
    }
  };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-gray-950 text-white px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-6 pb-20">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-800 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-amber-400 flex items-center gap-2">
              <span>🪔 Song Catalog</span>
              <span className="text-xs bg-amber-500/20 text-amber-300 font-medium px-2.5 py-0.5 rounded-full border border-amber-500/30">
                {songs.length} Total
              </span>
            </h1>
            <p className="text-xs text-gray-400 mt-1">
              Manage Chhath Radio songs — Drag rows by handle <span className="text-amber-400 font-bold">⠿</span> to reorder
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/"
              className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors"
            >
              ← Back to Radio
            </a>
            <button
              onClick={onLogout}
              className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-900/40 hover:border-red-800/60 bg-red-950/30 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Add Song Form */}
        <AddSongForm
          token={token}
          onAddedBatch={() => loadSongs()}
        />

        {/* Catalog Section */}
        <div className="space-y-4">
          {/* Controls Bar: Search & Status Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-gray-900 border border-gray-800 rounded-xl p-3">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Search title or artist…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <span className="absolute left-3 top-2.5 text-gray-400 text-xs pointer-events-none">🔍</span>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-300 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center bg-gray-800 p-1 rounded-lg border border-gray-700 shrink-0 text-xs">
              <button
                onClick={() => setStatusFilter("all")}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                  statusFilter === "all"
                    ? "bg-amber-500 text-black shadow"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                All ({songs.length})
              </button>
              <button
                onClick={() => setStatusFilter("enabled")}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                  statusFilter === "enabled"
                    ? "bg-amber-500 text-black shadow"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Enabled ({songs.filter((s) => s.enabled).length})
              </button>
              <button
                onClick={() => setStatusFilter("disabled")}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                  statusFilter === "disabled"
                    ? "bg-amber-500 text-black shadow"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Disabled ({songs.filter((s) => !s.enabled).length})
              </button>
            </div>
          </div>

          {/* Bulk Actions Toolbar (Sticky when items selected) */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-950/40 border border-amber-500/30 rounded-xl p-3 animate-fadeIn">
              <div className="flex items-center gap-2">
                <span className="bg-amber-500 text-black text-xs font-bold px-2 py-0.5 rounded-full">
                  {selectedIds.size} Selected
                </span>
                <span className="text-xs text-amber-200/80 hidden sm:inline">
                  Select bulk actions below to apply:
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleBulkToggleEnabled(true)}
                  disabled={isProcessingBulk}
                  className="bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow disabled:opacity-50"
                >
                  Enable Selected
                </button>
                <button
                  onClick={() => handleBulkToggleEnabled(false)}
                  disabled={isProcessingBulk}
                  className="bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow disabled:opacity-50"
                >
                  Disable Selected
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={isProcessingBulk}
                  className="bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow disabled:opacity-50"
                >
                  Delete Selected
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          {/* Table Container */}
          {loading ? (
            <p className="text-gray-500 text-sm text-center py-12">Loading song catalog…</p>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-lg">
              <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
                <table className="w-full text-left text-xs" aria-label="Song catalog">
                  <thead className="sticky top-0 bg-gray-950 border-b border-gray-800 text-gray-400 select-none z-10">
                    <tr>
                      <th className="py-3 px-2 w-8 text-center" title="Drag handle"></th>
                      <th className="py-3 px-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={toggleSelectAll}
                          aria-label="Select all visible songs"
                          className="rounded border-gray-700 bg-gray-800 text-amber-500 focus:ring-amber-400 cursor-pointer accent-amber-500 w-4 h-4"
                        />
                      </th>
                      <th className="py-3 px-3">Title</th>
                      <th className="py-3 px-3">Artist</th>
                      <th className="py-3 px-3 w-20 text-center">Order</th>
                      <th className="py-3 px-3 w-24 text-center">Status</th>
                      <th className="py-3 px-4 w-24 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {filteredSongs.map((song, index) => {
                      const isSelected = selectedIds.has(song.id);
                      const isDragging = draggedIndex === index;
                      const isDragOver = dragOverIndex === index;

                      return (
                        <tr
                          key={song.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDrop={(e) => handleDrop(e, index)}
                          onDragEnd={() => {
                            setDraggedIndex(null);
                            setDragOverIndex(null);
                          }}
                          className={`transition-all ${
                            isDragging
                              ? "opacity-30 bg-amber-950/40"
                              : isDragOver
                              ? "bg-amber-900/40 border-y-2 border-amber-400"
                              : isSelected
                              ? "bg-amber-950/25 hover:bg-amber-900/30"
                              : "hover:bg-gray-800/40"
                          }`}
                        >
                          {/* Drag Handle */}
                          <td
                            className="py-3 px-2 text-center text-gray-500 hover:text-amber-400 cursor-grab active:cursor-grabbing select-none text-sm"
                            title="Drag to reorder"
                          >
                            ⠿
                          </td>

                          {/* Select Checkbox */}
                          <td className="py-3 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectSong(song.id)}
                              aria-label={`Select ${song.title}`}
                              className="rounded border-gray-700 bg-gray-800 text-amber-500 focus:ring-amber-400 cursor-pointer accent-amber-500 w-4 h-4"
                            />
                          </td>

                          {/* Title */}
                          <td className="py-3 px-3 text-white font-medium">
                            <div className="truncate max-w-[220px] sm:max-w-[300px]" title={song.title}>
                              {song.title}
                            </div>
                          </td>

                          {/* Artist */}
                          <td className="py-3 px-3 text-gray-400">
                            <div className="truncate max-w-[150px] sm:max-w-[200px]" title={song.artist}>
                              {song.artist}
                            </div>
                          </td>

                          {/* Sort Order */}
                          <td className="py-3 px-3 text-gray-400 text-center font-mono font-medium">
                            <span className="inline-block bg-gray-800/80 px-2 py-0.5 rounded border border-gray-700/50">
                              {song.sort_order}
                            </span>
                          </td>

                          {/* Enable/Disable Toggle */}
                          <td className="py-3 px-3 text-center">
                            <button
                              onClick={() => handleSingleToggle(song)}
                              aria-label={`${song.enabled ? "Disable" : "Enable"} ${song.title}`}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                                song.enabled ? "bg-amber-500" : "bg-gray-700"
                              }`}
                            >
                              <span
                                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                  song.enabled ? "translate-x-5" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </td>

                          {/* Edit & Delete Actions */}
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              onClick={() => setEditingSong(song)}
                              aria-label={`Edit ${song.title}`}
                              className="text-amber-400 hover:text-amber-300 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 rounded px-2 py-0.5 hover:bg-amber-950/40 mr-1.5 text-xs"
                            >
                              ✏️ Edit
                            </button>
                            <button
                              onClick={() => handleSingleDelete(song)}
                              aria-label={`Delete ${song.title}`}
                              className="text-red-400 hover:text-red-300 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-400 rounded px-2 py-0.5 hover:bg-red-950/40 text-xs"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {filteredSongs.length === 0 && (
                  <div className="py-12 text-center text-gray-500 text-sm">
                    {songs.length === 0
                      ? "No songs in catalog yet. Add one above."
                      : "No songs match your search or filter."}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {editingSong && (
        <EditSongModal
          song={editingSong}
          token={token}
          onClose={() => setEditingSong(null)}
          onUpdated={(updated) => {
            setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
          }}
        />
      )}
    </div>
  );
}

// ─── Page Root ────────────────────────────────────────────────────────────────

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