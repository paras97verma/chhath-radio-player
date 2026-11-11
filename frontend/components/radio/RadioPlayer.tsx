"use client";

/**
 * RadioPlayer — Modern glassmorphic music player pill.
 *
 * Design: Framer-inspired modern player with dominant album art, spectrogram,
 * integrated ReactionBar, and strong visual hierarchy.
 * Features:
 * - Large rotating vinyl record album art (w-16 h-16) with glow ring
 * - Animated spectrogram bars (5 bars, only when playing)
 * - Song title + artist with live indicator dot
 * - Prev / Play-Pause / Next controls (hero play button)
 * - Always-visible inline volume slider
 * - Progress bar with seek (taller, always-visible thumb)
 * - Playlist drawer with clickable songs
 * - Integrated ReactionBar 🪔 on the right end
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRadioStore, getFavoriteSongs } from "@/lib/radio-store";
import {
  updateMediaSessionPositionState,
  updateMediaSessionMetadata,
  setMediaSessionPlaybackState,
} from "@/lib/media-session";
import { onPlaybackStateChange } from "@/lib/wake-lock";
import type { Song } from "@/lib/api";
import PlayerRecoveryPanel from "./PlayerRecoveryPanel";
import PlayerControls, { PlayerStatus, type PlayerControlFlash } from "./PlayerControls";

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconVolumeMute = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
  </svg>
);
const IconVolumeLow = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
  </svg>
);
const IconVolumeHigh = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
);
const IconList = () => (
  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
  </svg>
);
const IconClose = () => (
  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);
const IconShuffle = () => (
  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.45 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
  </svg>
);

// ─── Vinyl Album Art ──────────────────────────────────────────────────────────

function VinylArt({
  src,
  fallbackSrc,
  isPlaying,
}: {
  src: string | null;
  fallbackSrc: string | null;
  isPlaying: boolean;
}) {
  const [imageFailures, setImageFailures] = useState<{
    source: string | null;
    failed: Set<string>;
  }>({ source: null, failed: new Set() });
  const failedSources = imageFailures.source === src ? imageFailures.failed : new Set<string>();
  const imageSrc = src && !failedSources.has(src)
    ? src
    : fallbackSrc && !failedSources.has(fallbackSrc)
      ? fallbackSrc
      : null;

  return (
    <div
      className="relative w-14 h-14 sm:w-20 sm:h-20 shrink-0 rounded-full"
      style={{
        boxShadow: isPlaying
          ? "0 0 40px rgba(255, 107, 53, 0.7), 0 0 18px rgba(255, 138, 80, 0.4)"
          : "0 2px 18px rgba(0,0,0,0.7)",
        transition: "box-shadow 0.6s ease",
      }}
    >
      {/* Outer vinyl ring */}
      <div
        className="radio-player-vinyl absolute inset-0 rounded-full"
        style={{
          background: "conic-gradient(from 0deg, #1a0a00, #3a1a00, #1a0a00, #2a1200, #1a0a00)",
          animation: isPlaying ? "vinylSpin 4s linear infinite" : "none",
        }}
      />
      {/* Grooves */}
      {[0.85, 0.70, 0.55].map((r, i) => (
        <div
          key={i}
          className="radio-player-vinyl absolute rounded-full border border-white/5"
          style={{
            inset: `${(1 - r) * 50}%`,
            animation: isPlaying ? "vinylSpin 4s linear infinite" : "none",
          }}
        />
      ))}
      {/* Album art center */}
      <div
        className="radio-player-vinyl absolute rounded-full overflow-hidden"
        style={{
          inset: "18%",
          animation: isPlaying ? "vinylSpin 4s linear infinite" : "none",
        }}
      >
        {imageSrc ? (
          <img
            key={imageSrc}
            src={imageSrc}
            alt=""
            className="w-full h-full object-cover"
            loading="eager"
            decoding="async"
            onError={() => setImageFailures((current) => {
              const failed = current.source === src ? new Set(current.failed) : new Set<string>();
              failed.add(imageSrc);
              return { source: src, failed };
            })}
          />
        ) : (
          <div className="w-full h-full bg-[#3a1a08] flex items-center justify-center text-orange-400/70 text-[10px]">
            🪔
          </div>
        )}
      </div>
      {/* Center spindle */}
      <div
        className="absolute w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-orange-500 shadow"
        style={{ top: "50%", left: "50%", transform: "translate(-50%,-50%)", boxShadow: "0 0 8px rgba(255, 138, 80, 0.6)" }}
      />
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({
  isPlaying,
  isBuffering,
}: {
  isPlaying: boolean;
  isBuffering: boolean;
}) {
  const adapter = useRadioStore((s) => s.adapter);
  const storeTime = useRadioStore((s) => s.currentTime);
  const storeDuration = useRadioStore((s) => s.duration);
  const seekTo = useRadioStore((s) => s.seekTo);

  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(storeDuration);
  const [currentTime, setCurrentTime] = useState(storeTime);
  const rafRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  // After a seek, freeze the displayed position for a grace period so the
  // YouTube player has time to settle before getCurrentTime() is trusted again.
  const seekFreezeUntilRef = useRef<number>(0);

  // Sync with store when duration/currentTime updates externally
  useEffect(() => {
    if (!isDraggingRef.current && Date.now() >= seekFreezeUntilRef.current) {
      if (storeDuration > 0) {
        setDuration(storeDuration);
        setCurrentTime(storeTime);
        setProgress(storeTime / storeDuration);
      }
    }
  }, [storeTime, storeDuration]);

  useEffect(() => {
    // Run the rAF loop while playing OR buffering (e.g. after a seek).
    if (!isPlaying && !isBuffering) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      if (adapter && !isDraggingRef.current) {
        // During the seek grace period, skip reading from the adapter so the
        // bar stays frozen at the seeked position instead of flashing to 0.
        if (Date.now() < seekFreezeUntilRef.current) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const dur = adapter.getDuration();
        const cur = adapter.getCurrentTime();
        if (dur > 0) {
          setDuration(dur);
          setCurrentTime(cur);
          setProgress(cur / dur);
          updateMediaSessionPositionState(cur, dur);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [adapter, isPlaying, isBuffering]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleSeekStart = () => { isDraggingRef.current = true; };

  const commitSeek = (value: number) => {
    if (!isDraggingRef.current || !adapter || duration <= 0) return;
    isDraggingRef.current = false;
    const seekTime = (Math.max(0, Math.min(1000, value)) / 1000) * duration;
    seekFreezeUntilRef.current = Date.now() + 600;
    seekTo(seekTime);
    if (!isPlaying) {
      setTimeout(() => { adapter.pause(); }, 150);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.currentTarget.value);
    const val = Math.max(0, Math.min(1000, value)) / 1000;
    setProgress(val);
    setCurrentTime(val * duration);
    // Fallback for browsers that update a range without pointer/touch events.
    if (!isDraggingRef.current && duration > 0) {
      isDraggingRef.current = true;
      commitSeek(value);
    }
  };

  const handleSeekKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) {
      isDraggingRef.current = true;
    }
  };

  const handleSeekKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) return;
    commitSeek(Number(e.currentTarget.value));
  };

  return (
    <div className="flex items-center gap-2 w-full px-3.5 sm:px-5 pb-2">
      <span className="text-white/50 text-[9px] w-6 text-right shrink-0 tabular-nums">{fmt(currentTime)}</span>
      {/* Outer container is taller (h-4 = 16px) for a larger touch target on mobile */}
      <div
        className="relative flex-1 h-4 group cursor-pointer flex items-center"
      >
        {/* Visual track — h-1.5, centered inside the taller hit area */}
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full"
          style={{ boxShadow: "inset 2px 2px 5px rgba(0,0,0,0.55), inset -1px -1px 3px rgba(60,30,10,0.18)" }}
        >
          <div className="absolute inset-0 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }} />
          {/* Fill — no transition so it stays in sync with the thumb */}
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${progress * 100}%`,
              background: "linear-gradient(90deg, #ffa726, #ff7043)",
              filter: "drop-shadow(0 0 6px rgba(255, 112, 67, 0.7))",
            }}
          />
          {/* Thumb dot — always visible, centered on the progress percentage */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-orange-400 shadow-sm"
            style={{
              left: `calc(${progress * 100}% - 6px)`,
              boxShadow: "0 0 8px rgba(255, 138, 80, 0.8)",
            }}
          />
        </div>
        {/* Invisible range input covers the full h-4 area for easy touch/click */}
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={handleSeek}
          onPointerDown={handleSeekStart}
          onPointerUp={(e) => commitSeek(Number(e.currentTarget.value))}
          onPointerCancel={(e) => commitSeek(Number(e.currentTarget.value))}
          onMouseDown={handleSeekStart}
          onMouseUp={(e) => commitSeek(Number(e.currentTarget.value))}
          onTouchStart={handleSeekStart}
          onTouchEnd={(e) => commitSeek(Number(e.currentTarget.value))}
          onKeyDown={handleSeekKeyDown}
          onKeyUp={handleSeekKeyUp}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full touch-none"
          aria-label="Seek"
          aria-valuetext={`${fmt(currentTime)} of ${fmt(duration)}`}
        />
      </div>
      <span className="text-white/50 text-[9px] w-6 shrink-0 tabular-nums">{fmt(duration)}</span>
    </div>
  );
}

// ─── Inline Volume Control (pure controlled component — connected to store) ───

function VolumeControl() {
  const volume = useRadioStore((s) => s.volume);
  const isMuted = useRadioStore((s) => s.isMuted);
  const setVolume = useRadioStore((s) => s.setVolume);
  const toggleMute = useRadioStore((s) => s.toggleMute);

  const VolumeIcon = isMuted || volume === 0 ? IconVolumeMute : volume < 50 ? IconVolumeLow : IconVolumeHigh;
  const displayVol = isMuted ? 0 : volume;

  return (
    <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
      <button
        onClick={toggleMute}
        aria-label={isMuted ? "Unmute" : `Volume ${volume}%`}
        className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-white/40 hover:text-orange-400 transition-colors"
      >
        <VolumeIcon />
      </button>
      {/* Volume slider — hidden on mobile to save space, mute button stays visible */}
      <div className="relative w-12 h-1.5 group hidden sm:block">
        <div className="absolute inset-0 rounded-full bg-white/10" />
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${displayVol}%`,
            background: "linear-gradient(90deg, #ffa726, #ff7043)",
          }}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={displayVol}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
          style={{ accentColor: "#f97316" }}
        />
      </div>
    </div>
  );
}

// ─── Playlist Drawer ──────────────────────────────────────────────────────────

function PlaylistDrawer({
  onClose,
  onPlaySong,
}: {
  onClose: () => void;
  onPlaySong: (songsList: Song[], index: number, song: Song) => void;
}) {
  const allSongs = useRadioStore((s) => s.allSongs);
  const favorites = useRadioStore((s) => s.favorites);
  const activeFilter = useRadioStore((s) => s.activeFilter);
  const toggleFavorite = useRadioStore((s) => s.toggleFavorite);
  const isFavorite = useRadioStore((s) => s.isFavorite);
  const setFilter = useRadioStore((s) => s.setFilter);
  const currentSong = useRadioStore((s) => s.currentSong());

  const favSongs = useMemo(() => getFavoriteSongs(allSongs, favorites), [allSongs, favorites]);
  const favoritedCount = favSongs.length;
  const activeItemRef = useRef<HTMLDivElement | null>(null);

  const displaySongs = activeFilter === "favorites" ? favSongs : allSongs;

  // Auto-scroll active song into view when playlist opens or tab switches
  useEffect(() => {
    if (activeItemRef.current && typeof activeItemRef.current.scrollIntoView === "function") {
      activeItemRef.current.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }, [activeFilter]);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-3 z-30">
      <div
        className="rounded-2xl overflow-hidden border"
        style={{
          background: "rgba(18, 10, 6, 0.96)",
          borderColor: "rgba(255, 138, 80, 0.22)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,229,208,0.12)",
          backdropFilter: "blur(32px)",
          WebkitBackdropFilter: "blur(32px)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-orange-500/20">
          <span className="text-orange-400 font-semibold text-xs tracking-wide">
            🎵 {activeFilter === "favorites" ? "Favorites" : "Playlist"} ({displaySongs.length})
          </span>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors p-1" aria-label="Close playlist">
            <IconClose />
          </button>
        </div>

        {/* Tab Switcher: Appears ONLY when user has favorited at least 1 song */}
        {favoritedCount > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-orange-500/12 bg-black/50">
            <button
              onClick={() => setFilter("all")}
              className={`flex-1 py-1 px-2.5 rounded-lg text-[11px] font-semibold transition-all ${activeFilter === "all"
                ? "bg-orange-500/25 text-orange-400 border border-orange-500/40"
                : "text-amber-200/50 hover:text-amber-200 hover:bg-white/5"
                }`}
            >
              All Songs ({allSongs.length})
            </button>
            <button
              onClick={() => setFilter("favorites")}
              className={`flex-1 py-1 px-2.5 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5 ${activeFilter === "favorites"
                ? "bg-orange-500/25 text-orange-400 border border-orange-500/40"
                : "text-amber-200/50 hover:text-amber-200 hover:bg-white/5"
                }`}
            >
              <span>❤️ Favorites</span>
              <span>({favoritedCount})</span>
            </button>
          </div>
        )}

        {/* Song List */}
        <div className="max-h-56 overflow-y-auto chat-scrollbar">
          {displaySongs.length === 0 ? (
            <div className="py-6 text-center text-white/30 text-xs">
              No favorite songs yet. Tap ♡ on any song to add!
            </div>
          ) : (
            displaySongs.map((song, i) => {
              const favorited = isFavorite(song.id);
              const isPlaying =
                Boolean(currentSong) &&
                (currentSong?.id === song.id ||
                  (Boolean(currentSong?.youtube_video_id) &&
                    currentSong?.youtube_video_id === song.youtube_video_id));

              return (
                <div
                  key={song.id}
                  ref={isPlaying ? activeItemRef : null}
                  className={`flex items-center gap-1 transition-colors ${isPlaying ? "bg-orange-500/20" : "hover:bg-white/5"
                    }`}
                >
                  <button
                    onClick={() => onPlaySong(displaySongs, i, song)}
                    className="flex items-center gap-3 px-4 py-2 text-left flex-1 min-w-0"
                  >
                    <span className={`text-[10px] w-4 text-right shrink-0 font-bold ${isPlaying ? "text-orange-400" : "text-white/30"}`}>
                      {isPlaying ? "▶" : i + 1}
                    </span>
                    <img
                      src={`https://i.ytimg.com/vi/${song.youtube_video_id}/default.jpg`}
                      alt=""
                      className="w-7 h-7 rounded object-cover shrink-0 opacity-80"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs truncate font-medium ${isPlaying ? "text-orange-400" : "text-white/80"}`}>{song.title}</p>
                      <p className="text-amber-200/50 text-[10px] truncate">{song.artist}</p>
                    </div>
                  </button>

                  {/* Heart Favorite toggle button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(song.id);
                    }}
                    aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
                    title={favorited ? "Remove from favorites" : "Add to favorites"}
                    className="shrink-0 mr-3 w-7 h-7 flex items-center justify-center rounded-full transition-all"
                    style={{
                      color: favorited ? "#ef4444" : "rgba(255,255,255,0.3)",
                      background: favorited ? "rgba(239,68,68,0.12)" : "transparent",
                      fontSize: 13,
                      border: favorited ? "1px solid rgba(239,68,68,0.3)" : "1px solid transparent",
                    }}
                  >
                    {favorited ? "❤️" : "♡"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main RadioPlayer ─────────────────────────────────────────────────────────

export default function RadioPlayer({
  hasTunedIn: hasTunedInProp,
  showPlaylist: showPlaylistProp,
  onPlaylistToggle,
}: {
  hasTunedIn?: boolean;
  /** Lifted state — controlled by PageClient so it can hide side elements when playlist is open */
  showPlaylist?: boolean;
  onPlaylistToggle?: () => void;
}) {
  const storeHasTunedIn = useRadioStore((s) => s.hasTunedIn);
  const hasTunedIn = hasTunedInProp ?? storeHasTunedIn;
  const isReady = useRadioStore((s) => s.isReady);
  const volume = useRadioStore((s) => s.volume);
  const isMuted = useRadioStore((s) => s.isMuted);
  const error = useRadioStore((s) => s.error);
  const setVolume = useRadioStore((s) => s.setVolume);
  const toggleMute = useRadioStore((s) => s.toggleMute);
  const adapter = useRadioStore((s) => s.adapter);

  const showPlaylist = showPlaylistProp ?? false;
  const showPlaylistRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [hasMediaProgress, setHasMediaProgress] = useState(false);

  useEffect(() => {
    setMounted(true);
    showPlaylistRef.current = showPlaylist;
  }, [showPlaylist]);

  const [keyFlash, setKeyFlash] = useState<PlayerControlFlash>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use a ref so the keyboard handler always calls the latest version
  const triggerFlash = useCallback((btn: PlayerControlFlash) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setKeyFlash(btn);
    flashTimer.current = setTimeout(() => setKeyFlash(null), 220);
  }, []);

  const queue = useRadioStore((s) => s.queue);
  const currentIndex = useRadioStore((s) => s.currentIndex);
  const playState = useRadioStore((s) => s.playState);
  const favorites = useRadioStore((s) => s.favorites);
  const startPlayback = useRadioStore((s) => s.startPlayback);
  const pausePlayback = useRadioStore((s) => s.pausePlayback);
  const nextSong = useRadioStore((s) => s.nextSong);
  const prevSong = useRadioStore((s) => s.prevSong);
  const toggleFavorite = useRadioStore((s) => s.toggleFavorite);
  const isFavorite = useRadioStore((s) => s.isFavorite);
  const isShuffleEnabled = useRadioStore((s) => s.isShuffleEnabled);
  const toggleShuffle = useRadioStore((s) => s.toggleShuffle);

  const currentSong = queue[currentIndex] ?? null;
  const isPlaying = playState === "PLAYING";
  const isBuffering = playState === "BUFFERING";
  const isActuallyPlaying = isPlaying && hasMediaProgress;
  const hasPlaybackError = playState === "ERROR" || Boolean(error);
  const statusLabel = hasPlaybackError
    ? "Playback interrupted"
    : isBuffering
      ? "Connecting to audio"
      : isActuallyPlaying
        ? "On air"
        : isPlaying
          ? "Starting audio"
          : playState === "PAUSED"
            ? "Paused"
            : currentSong
              ? "Ready to play"
              : isReady
                ? "Choose a song"
                : "Loading your station";
  const isCurrentSongFavorite = currentSong ? isFavorite(currentSong.id) : false;

  useEffect(() => {
    setHasMediaProgress(false);
    if (!isPlaying || !adapter || !currentSong) return;

    let previousTime = adapter.getCurrentTime();
    const interval = window.setInterval(() => {
      const currentTime = adapter.getCurrentTime();
      if (currentTime > previousTime + 0.03) {
        setHasMediaProgress(true);
        window.clearInterval(interval);
      }
      previousTime = currentTime;
    }, 250);

    return () => window.clearInterval(interval);
  }, [adapter, currentSong?.youtube_video_id, isPlaying]);

  // Keyboard controls
  useEffect(() => {
    const handleKey = async (e: KeyboardEvent) => {
      // Allow keyboard shortcuts even when range inputs (seek/volume) are focused;
      // only bail for text-entry elements.
      const target = e.target as HTMLElement;
      if (
        (target instanceof HTMLInputElement && target.type !== "range") ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) return;
      const state = useRadioStore.getState();
      if (!state.adapter) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (state.playState === "PLAYING") state.pausePlayback();
        else state.startPlayback();
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        state.setVolume(Math.min(100, state.volume + 5));
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        state.setVolume(Math.max(0, state.volume - 5));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) { state.nextSong(); triggerFlash("next"); }
        else { state.seekTo(state.currentTime + 10); triggerFlash("seekFwd"); }
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) {
          triggerFlash("prev");
          await state.prevSong();
        } else {
          state.seekTo(Math.max(0, state.currentTime - 10));
          triggerFlash("seekBack");
        }
      } else if (e.code === "KeyM") {
        e.preventDefault();
        state.toggleMute();
      } else if (e.code === "KeyP") {
        e.preventDefault();
        onPlaylistToggle?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [triggerFlash, onPlaylistToggle]);

  // Dynamic page title
  useEffect(() => {
    if (!isReady || !currentSong || playState === "IDLE") {
      document.title = "Chhath Radio — छठ के गीत, बिना रुके";
      return;
    }
    if (isPlaying) {
      document.title = `🪔 ${currentSong.title} — Chhath Radio`;
    } else {
      document.title = `⏸ ${currentSong.title} — Chhath Radio`;
    }
    return () => {
      document.title = "Chhath Radio — छठ के गीत, बिना रुके";
    };
  }, [currentSong, isPlaying, isReady, playState]);

  const handlePrev = useCallback(async () => {
    const state = useRadioStore.getState();
    if (!state.adapter) return;
    triggerFlash("prev");
    await state.prevSong();
  }, [triggerFlash]);

  const handleNext = useCallback(() => {
    triggerFlash("next");
    void nextSong();
  }, [nextSong, triggerFlash]);

  const handlePlaySong = useCallback(async (songsList: Song[], index: number, song: Song) => {
    const state = useRadioStore.getState();
    if (!state.adapter) return;
    const wasPlaying = state.userIntent === "playing";
    state.adapter.primeAudio?.();
    useRadioStore.setState({
      queue: songsList,
      currentIndex: index,
      playState: "BUFFERING",
      userIntent: "playing",
      error: null,
    });
    updateMediaSessionMetadata(song, wasPlaying);
    try {
      await state.adapter.loadVideo(song.youtube_video_id);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        useRadioStore.setState({ playState: "ERROR", userIntent: "idle", error: "Could not play track" });
        onPlaybackStateChange(false);
        setMediaSessionPlaybackState("none");
      }
    }
  }, []);

  const albumArt = currentSong
    ? `/yt-thumb?v=${encodeURIComponent(currentSong.youtube_video_id)}`
    : null;
  const fallbackAlbumArt = currentSong
    ? `https://i.ytimg.com/vi/${encodeURIComponent(currentSong.youtube_video_id)}/mqdefault.jpg`
    : null;

  return (
    <>
      {/* Vinyl spin keyframe */}
      <style>{`
        @keyframes vinylSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      <div className="radio-player relative w-full" role="region" aria-label="Radio player">
        {/* Playlist drawer */}
        {showPlaylist && isReady && (
          <PlaylistDrawer onClose={() => onPlaylistToggle?.()} onPlaySong={handlePlaySong} />
        )}

        {/* ── Modern minimal glassmorphic pill ── */}
        <div
          className="flex flex-col rounded-[26px] overflow-hidden"
          style={{
            background: "linear-gradient(145deg, rgba(25, 14, 8, 0.94) 0%, rgba(18, 10, 6, 0.90) 100%)",
            backdropFilter: "blur(32px)",
            WebkitBackdropFilter: "blur(32px)",
            border: "1px solid rgba(255, 138, 80, 0.25)",
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 167, 38, 0.08), inset 0 1px 0 rgba(255, 229, 208, 0.12), 0 0 30px rgba(255, 112, 67, 0.15)",
          }}
        >
          <PlayerStatus
            song={currentSong}
            isFavorite={isCurrentSongFavorite}
            emptyLabel={isReady ? "Choose a song to begin" : "Loading your station…"}
            statusLabel={statusLabel}
            hasPlaybackError={hasPlaybackError}
            isActuallyPlaying={isActuallyPlaying}
            isBuffering={isBuffering}
            isPlaying={isPlaying}
          />

          {hasPlaybackError && (
            <PlayerRecoveryPanel
              error={error}
              canRetry={Boolean(currentSong) && !isBuffering}
              canSkip={isReady && queue.length > 1}
              onRetry={() => void startPlayback()}
              onSkip={() => void nextSong()}
            />
          )}

          {/* Main row */}
          <div className="flex items-center justify-between gap-1.5 sm:gap-3 px-3.5 sm:px-5 pt-2.5 sm:pt-3 pb-2 min-w-0">
            {/* Vinyl art */}
              <VinylArt src={albumArt} fallbackSrc={fallbackAlbumArt} isPlaying={isActuallyPlaying} />

            {/* Controls */}
            <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
              <PlayerControls
                isReady={isReady}
                hasSongs={queue.length > 0}
                isPlaying={isPlaying}
                isBuffering={isBuffering}
                keyFlash={keyFlash}
                onPrevious={() => void handlePrev()}
                onPlayPause={isPlaying ? pausePlayback : startPlayback}
                onNext={handleNext}
              />

              {/* Shuffle button */}
              {(() => {
                const shuffleActive = mounted && isShuffleEnabled;
                return (
                  <button
                    onClick={toggleShuffle}
                    suppressHydrationWarning
                    aria-label={shuffleActive ? "Disable shuffle" : "Enable shuffle"}
                    title={shuffleActive ? "Shuffle is ON" : "Shuffle is OFF"}
                    className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-all hover:scale-110"
                    style={{
                      color: shuffleActive ? "#ffa726" : "rgba(255,255,255,0.4)",
                      background: shuffleActive ? "rgba(255, 138, 80, 0.22)" : "transparent",
                      boxShadow: shuffleActive ? "0 0 16px rgba(255, 138, 80, 0.4)" : "none",
                    }}
                  >
                    <IconShuffle />
                  </button>
                );
              })()}

              {/* Divider */}
              <div className="hidden sm:block w-px h-4 sm:h-5 bg-white/8 mx-0.5 sm:mx-1" />

              {/* Volume — always visible inline */}
              {isReady && <VolumeControl />}

              {/* Playlist toggle */}
              <button
                onClick={() => onPlaylistToggle?.()}
                disabled={!isReady}
                aria-label="Toggle playlist"
                aria-expanded={showPlaylist}
                className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-full transition-all disabled:opacity-20 disabled:cursor-not-allowed ml-0.5 shrink-0 ${showPlaylist
                  ? "text-orange-400 bg-orange-500/20"
                  : "text-white/35 hover:text-white/70 hover:bg-white/8"
                  }`}
              >
                <IconList />
              </button>
            </div>
          </div>

          {/* Progress bar row — always rendered for constant height stability */}
          <ProgressBar isPlaying={isPlaying} isBuffering={isBuffering} />
        </div>
      </div>
    </>
  );
}
