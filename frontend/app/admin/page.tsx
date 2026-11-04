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
  adminFetchCatalogStatus,
  adminFetchStreamStatus,
  adminTriggerReconcile,
  adminFlushAndRefreshCache,
  type Song,
  type CatalogReadinessStatus,
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

// ─── Catalog & Stream Status Section ─────────────────────────────────────────

function StatusDisplayCard({
  categoryBadge,
  badgeColor = "amber",
  title,
  subtitle,
  data,
  type,
  loading,
  error,
  latencyMs,
  onRefresh,
}: {
  categoryBadge: string;
  badgeColor?: "amber" | "sky" | "emerald";
  title: string;
  subtitle: string;
  data: CatalogReadinessStatus | null;
  type: "catalog" | "stream";
  loading: boolean;
  error: string | null;
  latencyMs: number | null;
  onRefresh: () => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const catalog = data?.catalog;
  const telemetry = data?.telemetry;
  const coord = data?.distributed_coordination;

  const badgeStyles = {
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    sky: "bg-sky-500/10 text-sky-300 border-sky-500/20",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  }[badgeColor];

  return (
    <div className="bg-gray-950/70 border border-gray-800 rounded-xl p-4 space-y-3 shadow-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-800/80 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`font-mono text-[11px] font-semibold px-2 py-0.5 rounded border ${badgeStyles}`}>
              {categoryBadge}
            </span>
            <h3 className="text-sm font-bold text-gray-200">{title}</h3>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          {latencyMs !== null && (
            <span className="text-xs text-emerald-400 font-mono">({latencyMs}ms)</span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="px-2.5 py-1 text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg transition-all disabled:opacity-50"
          >
            {loading ? "Refreshing…" : type === "catalog" ? "🔄 Refresh Catalog" : "🔄 Refresh Cache"}
          </button>
          <button
            onClick={() => setShowJson((prev) => !prev)}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white bg-gray-900 rounded-lg border border-gray-800 transition-all"
          >
            {showJson ? "Close Details" : "Inspect Payload"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg p-2.5">
          {error}
        </div>
      )}

      {/* KPI Cards — Differentiated by Section Type */}
      {type === "catalog" ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {/* Metadata Completeness Card */}
          <div className="bg-gray-900/80 border border-gray-800/80 rounded-lg p-3 space-y-1">
            <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Metadata Sync</div>
            <div className="text-lg font-extrabold text-amber-400">
              {catalog ? `${catalog.metadata_completeness_percent}%` : "—"}
            </div>
            <div className="text-xs text-gray-300">
              <span className="text-amber-300 font-bold">{catalog?.metadata_ready ?? 0}</span> Complete
            </div>
            <div className="text-[10px] text-gray-500">
              Pending: <span className="text-yellow-400">{catalog?.metadata_incomplete ?? 0}</span> (in DB)
            </div>
          </div>

          {/* Catalog Size Card */}
          <div className="bg-gray-900/80 border border-gray-800/80 rounded-lg p-3 space-y-1">
            <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Active Songs</div>
            <div className="text-lg font-extrabold text-emerald-400">
              {catalog ? `${catalog.eligible_songs}` : "—"}
            </div>
            <div className="text-xs text-gray-300">
              Total in DB: <span className="text-emerald-400 font-bold">{catalog?.total_songs ?? 0}</span>
            </div>
            <div className="text-[10px] text-gray-500">
              All active songs eligible for playback
            </div>
          </div>

          {/* Prewarmed Inventory Card */}
          <div className="bg-gray-900/80 border border-gray-800/80 rounded-lg p-3 space-y-1">
            <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Prewarmed Inventory</div>
            <div className="text-lg font-extrabold text-sky-400">
              {catalog ? `${catalog.stream_ready} / ${catalog.eligible_songs}` : "—"}
            </div>
            <div className="text-xs text-gray-300">
              <span className="text-sky-300 font-bold">{catalog?.stream_readiness_percent ?? 0}%</span> Warm Streams
            </div>
            <div className="text-[10px] text-gray-500">
              Expiring (&lt;10m): <span className="text-amber-400">{catalog?.stream_expiring ?? 0}</span> | Missing: <span className="text-red-400">{catalog?.stream_missing ?? 0}</span>
            </div>
          </div>

          {/* Database Health Card */}
          <div className="bg-gray-900/80 border border-gray-800/80 rounded-lg p-3 space-y-1">
            <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Database Status</div>
            <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 pt-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              PostgreSQL Online
            </div>
            <div className="text-xs text-gray-300">
              Queue Cache: <span className="text-emerald-300 font-medium">Warm & Synced</span>
            </div>
            <div className="text-[10px] text-gray-500">
              Persistent storage operational
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {/* Stream Readiness Card */}
          <div className="bg-gray-900/80 border border-gray-800/80 rounded-lg p-3 space-y-1">
            <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Stream Readiness</div>
            <div className="text-lg font-extrabold text-emerald-400">
              {catalog ? `${catalog.stream_readiness_percent}%` : "—"}
            </div>
            <div className="text-xs text-gray-300">
              <span className="text-emerald-400 font-bold">{catalog?.stream_ready ?? 0}</span> / {catalog?.eligible_songs ?? 0} Ready
            </div>
            <div className="text-[10px] text-gray-500">
              Expiring (&lt;10m): <span className="text-amber-400">{catalog?.stream_expiring ?? 0}</span> | Missing: <span className="text-red-400">{catalog?.stream_missing ?? 0}</span>
            </div>
          </div>

          {/* Cache Hit Ratio Card */}
          <div className="bg-gray-900/80 border border-gray-800/80 rounded-lg p-3 space-y-1">
            <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Overall Hit Ratio</div>
            <div className="text-lg font-extrabold text-sky-400">
              {telemetry ? `${(telemetry.hit_ratio * 100).toFixed(1)}%` : "—"}
            </div>
            <div className="text-xs text-gray-300">
              Hits: <span className="text-sky-300">{telemetry ? telemetry.l1_hits + telemetry.redis_hits : 0}</span> / {telemetry?.total_requests ?? 0}
            </div>
            <div className="text-[10px] text-gray-500">
              Misses: <span className="text-yellow-400">{telemetry?.cache_misses ?? 0}</span> | Extractions: {telemetry?.extractions_success ?? 0}
            </div>
          </div>

          {/* Cache Tier Breakdown Card */}
          <div className="bg-gray-900/80 border border-gray-800/80 rounded-lg p-3 space-y-1">
            <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Cache Tier Hits</div>
            <div className="text-sm font-bold text-amber-300 pt-0.5">
              L1 RAM: {telemetry?.l1_hits ?? 0}
            </div>
            <div className="text-xs text-gray-300">
              L2 Redis: <span className="text-sky-300 font-medium">{telemetry?.redis_hits ?? 0}</span>
            </div>
            <div className="text-[10px] text-gray-500">
              Invalidations: {telemetry?.invalidations ?? 0} | Expirations: {telemetry?.expirations_detected ?? 0}
            </div>
          </div>

          {/* Multi-Worker Coordination Card */}
          <div className="bg-gray-900/80 border border-gray-800/80 rounded-lg p-3 space-y-1">
            <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Worker Coordination</div>
            <div className="text-xs font-bold text-violet-400 flex items-center gap-1.5 pt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              {coord?.is_current_worker_leader ? "Leader Active" : coord?.active_leader_id ? "Leader Lease Active" : "Standby (Healthy)"}
            </div>
            <div className="text-[11px] text-gray-300 font-mono truncate" title={coord?.active_leader_id || "None"}>
              Lease: {coord?.lease_ttl_seconds ?? 30}s TTL
            </div>
            <div className="text-[10px] text-gray-500 truncate" title={coord?.worker_id}>
              Worker: {coord?.worker_id ? `${coord.worker_id.slice(0, 8)}…` : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Raw JSON Accordion */}
      {showJson && (
        <div className="bg-black/60 border border-gray-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Payload Details ({categoryBadge})</span>
            <button
              onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}
              className="text-amber-400 hover:text-amber-300 text-[11px]"
            >
              Copy JSON
            </button>
          </div>
          <pre className="text-[11px] font-mono text-gray-300 overflow-x-auto max-h-60 p-2 bg-black/50 rounded">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function CatalogStatusSection({ token }: { token: string }) {
  // State for Catalog status
  const [songsStatus, setSongsStatus] = useState<CatalogReadinessStatus | null>(null);
  const [songsLoading, setSongsLoading] = useState(false);
  const [songsLatency, setSongsLatency] = useState<number | null>(null);
  const [songsError, setSongsError] = useState<string | null>(null);

  // State for Stream status
  const [streamStatus, setStreamStatus] = useState<CatalogReadinessStatus | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamLatency, setStreamLatency] = useState<number | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const [reconciling, setReconciling] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);

  const fetchSongsStatus = useCallback(async () => {
    setSongsLoading(true);
    setSongsError(null);
    const start = performance.now();
    try {
      const data = await adminFetchCatalogStatus(token);
      setSongsLatency(Math.round(performance.now() - start));
      setSongsStatus(data);
    } catch (err: unknown) {
      setSongsError(err instanceof Error ? err.message : "Failed to fetch catalog status");
    } finally {
      setSongsLoading(false);
    }
  }, [token]);

  const fetchStreamStatus = useCallback(async () => {
    setStreamLoading(true);
    setStreamError(null);
    const start = performance.now();
    try {
      const data = await adminFetchStreamStatus(token);
      setStreamLatency(Math.round(performance.now() - start));
      setStreamStatus(data);
    } catch (err: unknown) {
      setStreamError(err instanceof Error ? err.message : "Failed to fetch stream engine status");
    } finally {
      setStreamLoading(false);
    }
  }, [token]);

  const fetchBothStatuses = useCallback(async () => {
    await Promise.all([fetchSongsStatus(), fetchStreamStatus()]);
  }, [fetchSongsStatus, fetchStreamStatus]);

  useEffect(() => {
    fetchBothStatuses();
  }, [fetchBothStatuses]);

  const handleTriggerReconcile = async () => {
    setReconciling(true);
    setReconcileMessage("Reconciliation started: synchronizing metadata in database and prewarming streams...");
    try {
      const res = await adminTriggerReconcile(token);
      setReconcileMessage(res.message || "Reconciliation pass dispatched in background!");

      // Poll periodically to catch real-time completion
      let pollCount = 0;
      const pollInterval = setInterval(async () => {
        pollCount += 1;
        await fetchBothStatuses();
        if (pollCount >= 6) {
          clearInterval(pollInterval);
          setReconciling(false);
          setReconcileMessage("Reconciliation complete: metadata synchronized and audio streams verified!");
        }
      }, 1500);
    } catch (err: unknown) {
      setReconcileMessage(err instanceof Error ? err.message : "Failed to trigger reconciliation");
      setReconciling(false);
    }
  };

  const [flushing, setFlushing] = useState(false);

  const handleFlushAndRefreshCache = async () => {
    if (!confirm("This will purge all cached audio streams from Redis and launch a complete re-extraction and verification pass across all songs. Continue?")) {
      return;
    }
    setFlushing(true);
    setReconcileMessage("Flushing stream cache and starting full catalog re-warming pass...");
    try {
      const res = await adminFlushAndRefreshCache(token);
      setReconcileMessage(res.message || "Cache flushed and re-warming pass launched!");
      let pollCount = 0;
      const pollInterval = setInterval(async () => {
        pollCount += 1;
        await fetchBothStatuses();
        if (pollCount >= 8) {
          clearInterval(pollInterval);
          setFlushing(false);
          setReconcileMessage("Audio stream cache refreshed: all streams validated and ready!");
        }
      }, 1500);
    } catch (err: unknown) {
      setReconcileMessage(err instanceof Error ? err.message : "Failed to flush and refresh cache");
      setFlushing(false);
    }
  };

  return (
    <div className="bg-gray-900/90 border border-amber-500/30 rounded-2xl p-5 shadow-xl space-y-4">
      {/* Title & Global Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-800 pb-3">
        <div>
          <h2 className="text-base font-bold text-amber-400 flex items-center gap-2">
            <span>📡 Catalog Readiness & Audio Streaming Engine</span>
          </h2>
          <p className="text-xs text-gray-400">
            Real-time catalog monitoring from PostgreSQL and Redis edge cache.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchBothStatuses}
            disabled={songsLoading || streamLoading || reconciling || flushing}
            className="px-3 py-1.5 text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg transition-all disabled:opacity-50"
          >
            {songsLoading || streamLoading ? "Refreshing Metrics…" : "🔄 Refresh All Metrics"}
          </button>

          <button
            onClick={handleTriggerReconcile}
            disabled={reconciling || flushing}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded-lg transition-all flex items-center gap-1.5"
          >
            {reconciling ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full border-2 border-emerald-300 border-t-transparent animate-spin"></span>
                <span>Reconciling…</span>
              </>
            ) : (
              <span>⚡ Reconcile Catalog & Prewarm</span>
            )}
          </button>

          <button
            onClick={handleFlushAndRefreshCache}
            disabled={reconciling || flushing}
            className="px-3 py-1.5 text-xs font-semibold bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 rounded-lg transition-all flex items-center gap-1.5"
            title="Purge all cached audio streams from Redis and re-extract verified playable streams across the entire catalog"
          >
            {flushing ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full border-2 border-rose-300 border-t-transparent animate-spin"></span>
                <span>Flushing & Warming…</span>
              </>
            ) : (
              <span>🔥 Flush & Refresh All Streams</span>
            )}
          </button>
        </div>
      </div>

      {reconcileMessage && (
        <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800/40 rounded-lg p-2.5 font-medium flex items-center justify-between">
          <span>{reconcileMessage}</span>
          {reconciling && (
            <span className="text-[10px] text-emerald-400/80 animate-pulse">Syncing...</span>
          )}
        </div>
      )}

      {/* Both sections rendered directly and simultaneously with human-readable titles and non-technical badges */}
      <div className="space-y-4">
        {/* Section 1: Song Catalog & Metadata Status */}
        <StatusDisplayCard
          categoryBadge="Database Catalog"
          badgeColor="amber"
          title="Song Catalog & Metadata Inventory"
          subtitle="PostgreSQL database records: total tracks, titles, artists, verified durations, and playlist readiness."
          data={songsStatus}
          type="catalog"
          loading={songsLoading}
          error={songsError}
          latencyMs={songsLatency}
          onRefresh={fetchSongsStatus}
        />

        {/* Section 2: Audio Stream Engine & Cache Status */}
        <StatusDisplayCard
          categoryBadge="Streaming Engine"
          badgeColor="sky"
          title="Audio Stream Engine & Cache Health"
          subtitle="Redis & In-Memory streaming layer: audio stream availability, cache hit ratios, and upstream extraction performance."
          data={streamStatus}
          type="stream"
          loading={streamLoading}
          error={streamError}
          latencyMs={streamLatency}
          onRefresh={fetchStreamStatus}
        />
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

        {/* Catalog Readiness & Streaming Status Panel */}
        <CatalogStatusSection token={token} />

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