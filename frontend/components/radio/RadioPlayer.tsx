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

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchRadioQueue } from "@/lib/api";
import { YouTubeIFramePlayerAdapter } from "@/lib/youtube-adapter";
import { useRadioStore } from "@/lib/radio-store";
import { useUserStore } from "@/lib/user-store";
import type { Song } from "@/lib/api";

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconPrev = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
  </svg>
);
const IconNext = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
  </svg>
);
const IconPlay = () => (
  <svg className="w-7 h-7 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IconPause = () => (
  <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);
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
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
  </svg>
);
const IconClose = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);

// ─── Spectrogram Bars ─────────────────────────────────────────────────────────

const SPEC_BARS = [
  { dur: "0.7s", delay: "0s",    h: 14 },
  { dur: "0.9s", delay: "0.15s", h: 20 },
  { dur: "0.6s", delay: "0.3s",  h: 16 },
  { dur: "1.1s", delay: "0.1s",  h: 22 },
  { dur: "0.8s", delay: "0.25s", h: 12 },
];

function Spectrogram({ isPlaying }: { isPlaying: boolean }) {
  if (!isPlaying) return null;
  return (
    <div className="flex items-end gap-[3px] h-6 shrink-0 self-center">
      {SPEC_BARS.map((b, i) => (
        <div
          key={i}
          className="spec-bar spec-bar-animated rounded-sm"
          style={{
            height: b.h,
            "--dur": b.dur,
            "--delay": b.delay,
            background: "linear-gradient(to top, #f97316, #fb923c88)",
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

// ─── Vinyl Album Art ──────────────────────────────────────────────────────────

function VinylArt({ src, isPlaying }: { src: string | null; isPlaying: boolean }) {
  return (
    <div
      className="relative w-20 h-20 shrink-0 rounded-full"
      style={{
        boxShadow: isPlaying
          ? "0 0 32px rgba(249,115,22,0.65), 0 0 14px rgba(249,115,22,0.35)"
          : "0 2px 14px rgba(0,0,0,0.6)",
        transition: "box-shadow 0.6s ease",
      }}
    >
      {/* Outer vinyl ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "conic-gradient(from 0deg, #1a0a00, #3a1a00, #1a0a00, #2a1200, #1a0a00)",
          animation: isPlaying ? "vinylSpin 4s linear infinite" : "none",
        }}
      />
      {/* Grooves */}
      {[0.85, 0.70, 0.55].map((r, i) => (
        <div
          key={i}
          className="absolute rounded-full border border-white/5"
          style={{
            inset: `${(1 - r) * 50}%`,
            animation: isPlaying ? "vinylSpin 4s linear infinite" : "none",
          }}
        />
      ))}
      {/* Album art center */}
      <div
        className="absolute rounded-full overflow-hidden"
        style={{
          inset: "18%",
          animation: isPlaying ? "vinylSpin 4s linear infinite" : "none",
        }}
      >
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-[#2a1005] flex items-center justify-center text-orange-400/60 text-[10px]">
            🪔
          </div>
        )}
      </div>
      {/* Center spindle */}
      <div
        className="absolute w-3 h-3 rounded-full bg-orange-500/90 shadow"
        style={{ top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}
      />
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({
  adapterRef,
  isPlaying,
}: {
  adapterRef: React.MutableRefObject<YouTubeIFramePlayerAdapter | null>;
  isPlaying: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const rafRef = useRef<number>(0);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const adapter = adapterRef.current;
      if (adapter && !isDraggingRef.current) {
        const dur = adapter.getDuration();
        const cur = adapter.getCurrentTime();
        if (dur > 0) {
          setDuration(dur);
          setCurrentTime(cur);
          setProgress(cur / dur);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [adapterRef]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleSeekStart = () => { isDraggingRef.current = true; };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value) / 1000;
    setProgress(val);
    setCurrentTime(val * duration);
  };

  const handleSeekEnd = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    isDraggingRef.current = false;
    const val = Number((e.target as HTMLInputElement).value) / 1000;
    const seekTime = val * duration;
    const adapter = adapterRef.current;
    if (!adapter) return;
    adapter.seekTo(seekTime);
    if (!isPlaying) {
      setTimeout(() => { adapter.pause(); }, 150);
    }
  };

  return (
    <div className="flex items-center gap-2 w-full px-5 pb-2">
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
              background: "linear-gradient(90deg, #fb923c, #f97316)",
              filter: "drop-shadow(0 0 4px rgba(249,115,22,0.6))",
            }}
          />
          {/* Thumb dot — always visible, centered on the progress percentage */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-orange-400 shadow-sm"
            style={{
              left: `calc(${progress * 100}% - 6px)`,
              boxShadow: "0 0 6px rgba(249,115,22,0.7)",
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
          onMouseDown={handleSeekStart}
          onTouchStart={handleSeekStart}
          onMouseUp={handleSeekEnd}
          onTouchEnd={handleSeekEnd}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
          aria-label="Seek"
        />
      </div>
      <span className="text-white/50 text-[9px] w-6 shrink-0 tabular-nums">{fmt(duration)}</span>
    </div>
  );
}

// ─── Inline Volume Control ────────────────────────────────────────────────────

function VolumeControl({
  adapterRef,
  externalMuted,
  externalVolume,
  onMuteChange,
  onVolumeChange,
}: {
  adapterRef: React.MutableRefObject<YouTubeIFramePlayerAdapter | null>;
  externalMuted?: boolean;
  externalVolume?: number;
  onMuteChange?: (muted: boolean) => void;
  onVolumeChange?: (v: number) => void;
}) {
  const [volume, setVolume] = useState(externalVolume ?? 80);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (externalMuted !== undefined && externalMuted !== isMuted) {
      setIsMuted(externalMuted);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalMuted]);

  useEffect(() => {
    if (externalVolume !== undefined && externalVolume !== volume) {
      setVolume(externalVolume);
      if (externalVolume > 0 && isMuted) {
        setIsMuted(false);
        onMuteChange?.(false);
      }
      adapterRef.current?.setVolume(externalVolume);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalVolume]);

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    onVolumeChange?.(v);
    if (v === 0) {
      setIsMuted(true);
      onMuteChange?.(true);
      adapterRef.current?.mute();
    } else {
      setIsMuted(false);
      onMuteChange?.(false);
      adapterRef.current?.unMute();
      adapterRef.current?.setVolume(v);
    }
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      adapterRef.current?.unMute();
      adapterRef.current?.setVolume(volume || 80);
      setIsMuted(false);
      onMuteChange?.(false);
    } else {
      adapterRef.current?.mute();
      setIsMuted(true);
      onMuteChange?.(true);
    }
  };

  const VolumeIcon = isMuted || volume === 0 ? IconVolumeMute : volume < 50 ? IconVolumeLow : IconVolumeHigh;
  const displayVol = isMuted ? 0 : volume;

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        onClick={handleMuteToggle}
        aria-label={isMuted ? "Unmute" : `Volume ${volume}%`}
        className="text-white/40 hover:text-orange-400 transition-colors"
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
            background: "linear-gradient(90deg, #fb923c, #f97316)",
          }}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={displayVol}
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
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
  onPlaySong: (index: number, song: Song) => void;
}) {
  const queue = useRadioStore((s) => s.queue);
  const currentIndex = useRadioStore((s) => s.currentIndex);
  const toggleFavorite = useUserStore((s) => s.toggleFavorite);
  const favorites = useUserStore((s) => s.favorites);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-3">
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "rgba(10, 4, 2, 0.97)",
          boxShadow: "10px 10px 28px rgba(0,0,0,0.80), -5px -5px 16px rgba(60,30,10,0.28), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
          <span className="text-orange-400/80 text-xs font-semibold tracking-wide">
            🎵 Playlist ({queue.length})
          </span>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors p-1" aria-label="Close playlist">
            <IconClose />
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto">
          {queue.map((song, i) => {
            const isFav = favorites.includes(song.youtube_video_id);
            return (
              <div
                key={song.id}
                className={`flex items-center gap-1 transition-colors ${
                  i === currentIndex ? "bg-orange-500/10" : "hover:bg-white/4"
                }`}
              >
                <button
                  onClick={() => onPlaySong(i, song)}
                  className="flex items-center gap-3 px-4 py-2 text-left flex-1 min-w-0"
                >
                  <span className={`text-[10px] w-4 text-right shrink-0 ${i === currentIndex ? "text-orange-400" : "text-white/25"}`}>
                    {i === currentIndex ? "▶" : i + 1}
                  </span>
                  <img
                    src={`https://i.ytimg.com/vi/${song.youtube_video_id}/default.jpg`}
                    alt=""
                    className="w-7 h-7 rounded object-cover shrink-0 opacity-70"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs truncate ${i === currentIndex ? "text-orange-400" : "text-white/70"}`}>{song.title}</p>
                    <p className="text-white/30 text-[10px] truncate">{song.artist}</p>
                  </div>
                </button>
                {/* ❤️ Favorite toggle */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(song.youtube_video_id); }}
                  aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                  title={isFav ? "Remove from favorites" : "Add to favorites"}
                  className="shrink-0 mr-2 w-7 h-7 flex items-center justify-center rounded-full transition-all"
                  style={{
                    color: isFav ? "#f97316" : "rgba(255,255,255,0.25)",
                    background: isFav ? "rgba(249,115,22,0.12)" : "transparent",
                    fontSize: 13,
                    border: isFav ? "1px solid rgba(249,115,22,0.3)" : "1px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isFav) {
                      e.currentTarget.style.color = "rgba(249,115,22,0.7)";
                      e.currentTarget.style.background = "rgba(249,115,22,0.08)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isFav) {
                      e.currentTarget.style.color = "rgba(255,255,255,0.25)";
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  {isFav ? "❤️" : "♡"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main RadioPlayer ─────────────────────────────────────────────────────────

export default function RadioPlayer({
  hasTunedIn = false,
  showPlaylist: showPlaylistProp,
  onPlaylistToggle,
}: {
  hasTunedIn?: boolean;
  /** Lifted state — controlled by PageClient so it can hide side elements when playlist is open */
  showPlaylist?: boolean;
  onPlaylistToggle?: () => void;
}) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<YouTubeIFramePlayerAdapter | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showPlaylist = showPlaylistProp ?? false;
  const showPlaylistRef = useRef(false);
  const [playlistFocusIdx, setPlaylistFocusIdx] = useState<number>(-1);

  useEffect(() => { showPlaylistRef.current = showPlaylist; }, [showPlaylist]);

  const [keyFlash, setKeyFlash] = useState<"prev" | "next" | "seekBack" | "seekFwd" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerFlash = (btn: typeof keyFlash) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setKeyFlash(btn);
    flashTimer.current = setTimeout(() => setKeyFlash(null), 220);
  };

  const loadQueue = useRadioStore((s) => s.loadQueue);
  const queue = useRadioStore((s) => s.queue);
  const currentIndex = useRadioStore((s) => s.currentIndex);
  const playState = useRadioStore((s) => s.playState);
  const startPlayback = useRadioStore((s) => s.startPlayback);
  const pausePlayback = useRadioStore((s) => s.pausePlayback);
  const nextSong = useRadioStore((s) => s.nextSong);

  const currentSong = queue[currentIndex] ?? null;
  const isPlaying = playState === "PLAYING";
  const isBuffering = playState === "BUFFERING";

  // Keyboard controls
  useEffect(() => {
    const handleKey = async (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const state = useRadioStore.getState();
      if (!state.adapter) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (state.playState === "PLAYING") state.pausePlayback();
        else state.startPlayback();
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        if (showPlaylistRef.current) {
          setPlaylistFocusIdx((prev) => Math.max(0, prev <= 0 ? state.currentIndex - 1 : prev - 1));
        } else {
          setVolume((prev) => {
            const next = Math.min(100, prev + 5);
            state.adapter!.unMute();
            state.adapter!.setVolume(next);
            setIsMuted(false);
            return next;
          });
        }
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        if (showPlaylistRef.current) {
          setPlaylistFocusIdx((prev) => Math.min(state.queue.length - 1, prev < 0 ? state.currentIndex + 1 : prev + 1));
        } else {
          setVolume((prev) => {
            const next = Math.max(0, prev - 5);
            if (next === 0) { state.adapter!.mute(); setIsMuted(true); }
            else { state.adapter!.setVolume(next); }
            return next;
          });
        }
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) { state.nextSong(); triggerFlash("next"); }
        else { state.adapter.seekTo(state.adapter.getCurrentTime() + 10); triggerFlash("seekFwd"); }
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) {
          if (state.currentIndex > 0) {
            const prevIdx = state.currentIndex - 1;
            const prevSong = state.queue[prevIdx];
            if (prevSong) {
              useRadioStore.setState({ currentIndex: prevIdx, playState: "BUFFERING" });
              await state.adapter.loadVideo(prevSong.youtube_video_id);
              triggerFlash("prev");
            }
          }
        } else {
          state.adapter.seekTo(Math.max(0, state.adapter.getCurrentTime() - 10));
          triggerFlash("seekBack");
        }
      } else if (e.code === "KeyM") {
        e.preventDefault();
        setIsMuted((prev) => {
          const next = !prev;
          if (next) state.adapter!.mute();
          else state.adapter!.unMute();
          return next;
        });
      } else if (e.code === "KeyP") {
        e.preventDefault();
        onPlaylistToggle?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Dynamic page title
  useEffect(() => {
    if (!isReady || !currentSong) {
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
  }, [currentSong, isPlaying, isReady]);

  const handlePrev = useCallback(async () => {
    const state = useRadioStore.getState();
    if (!state.adapter || state.currentIndex <= 0) return;
    const prevIdx = state.currentIndex - 1;
    const prevSong = state.queue[prevIdx];
    if (!prevSong) return;
    useRadioStore.setState({ currentIndex: prevIdx, playState: "BUFFERING" });
    await state.adapter.loadVideo(prevSong.youtube_video_id);
  }, []);

  const handlePlaySong = useCallback(async (index: number, song: Song) => {
    const state = useRadioStore.getState();
    if (!state.adapter) return;
    useRadioStore.setState({ currentIndex: index, playState: "BUFFERING" });
    await state.adapter.loadVideo(song.youtube_video_id);
    if (showPlaylistRef.current) onPlaylistToggle?.();
  }, [onPlaylistToggle]);

  useEffect(() => {
    if (!hasTunedIn) return;
    let cancelled = false;

    async function init() {
      try {
        const songs = await fetchRadioQueue();
        if (cancelled || songs.length === 0) return;

        const adapter = new YouTubeIFramePlayerAdapter();
        adapterRef.current = adapter;

        if (playerContainerRef.current) {
          await adapter.initialize(playerContainerRef.current, songs[0].youtube_video_id);
        }

        if (cancelled) { adapter.destroy(); return; }

        await loadQueue(songs, adapter);
        setIsReady(true);

        try { await adapter.play(); } catch { /* user can click play manually */ }
      } catch (err) {
        if (!cancelled) {
          setError("Could not load radio. Please refresh.");
          console.error("[RadioPlayer] Init error:", err);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      const adapter = adapterRef.current;
      if (adapter) { adapter.destroy(); adapterRef.current = null; }
    };
  }, [loadQueue, hasTunedIn]);

  const albumArt = currentSong
    ? `https://i.ytimg.com/vi/${currentSong.youtube_video_id}/mqdefault.jpg`
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

      <div className="relative w-full" role="region" aria-label="Radio player">
        {/* Hidden YouTube iframe */}
        <div
          ref={playerContainerRef}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", top: 0, left: 0 }}
          aria-hidden="true"
        />

        {/* Playlist drawer */}
        {showPlaylist && isReady && (
          <PlaylistDrawer onClose={() => onPlaylistToggle?.()} onPlaySong={handlePlaySong} />
        )}

        {/* ── Modern glassmorphic pill ── */}
        <div
          className="flex flex-col rounded-[28px]"
          style={{
            background: "linear-gradient(165deg, rgba(22, 9, 5, 0.94) 0%, rgba(12, 5, 3, 0.94) 100%)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(251, 146, 60, 0.25)",
            boxShadow: [
              "10px 10px 32px rgba(0,0,0,0.85)",
              "-4px -4px 16px rgba(90,40,15,0.25)",
              "inset 0 1px 0 rgba(254,215,170,0.12)",
            ].join(", "),
          }}
        >
          {/* Mobile only: song name strip at top of pill */}
          {currentSong && (
            <div
              className="sm:hidden flex flex-col items-center px-5 pt-3 pb-1 border-b"
              style={{ borderColor: "rgba(251,146,60,0.15)" }}
            >
              <p className="text-[#fff7ed] text-sm font-bold truncate w-full text-center leading-tight">
                {currentSong.title}
              </p>
              <p className="text-[11px] truncate w-full text-center mt-0.5" style={{ color: "rgba(253,186,116,0.80)" }}>
                {currentSong.artist}
              </p>
            </div>
          )}

          {/* Main row */}
          <div className="flex items-center gap-3 px-5 pt-3 pb-2">
            {/* Vinyl art */}
            <VinylArt src={albumArt} isPlaying={isPlaying} />

            {/* Song info — hidden on mobile (shown in top strip instead) */}
            <div className="flex-1 min-w-0 hidden sm:block">
              {error ? (
                <p className="text-red-400 text-xs" role="alert">{error}</p>
              ) : !isReady ? (
                <p className="text-orange-400/40 text-xs animate-pulse">Tuning in…</p>
              ) : currentSong ? (
                <>
                  <p className="text-white text-sm font-bold truncate leading-tight tracking-tight">{currentSong.title}</p>
                  <p className="text-orange-400/80 text-[11px] truncate mt-0.5 flex items-center gap-1.5">
                    {isPlaying && (
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0"
                        style={{ animation: "nmFabPulse 1.5s ease-in-out infinite" }}
                        aria-hidden="true"
                      />
                    )}
                    {currentSong.artist}
                  </p>
                </>
              ) : (
                <p className="text-white/30 text-xs">No songs loaded</p>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Prev */}
              <button
                onClick={handlePrev}
                disabled={!isReady || currentIndex <= 0}
                aria-label="Previous song"
                className="w-10 h-10 flex items-center justify-center rounded-full transition-all disabled:cursor-not-allowed hover:scale-110"
                style={{
                  color: keyFlash === "prev" || keyFlash === "seekBack" ? "#fb923c" : "rgba(255,255,255,0.5)",
                  background: keyFlash === "prev" || keyFlash === "seekBack" ? "rgba(249,115,22,0.22)" : "transparent",
                  boxShadow: keyFlash === "prev" || keyFlash === "seekBack" ? "0 0 14px rgba(249,115,22,0.35)" : "none",
                  opacity: (!isReady || currentIndex <= 0) && !keyFlash ? 0.2 : 1,
                }}
              >
                <IconPrev />
              </button>

              {/* Play / Pause — hero button */}
              <button
                onClick={isPlaying ? pausePlayback : startPlayback}
                disabled={!isReady || isBuffering}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="w-10 h-10 flex items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-not-allowed mx-0.5"
                style={{
                  background: isReady && !isBuffering
                    ? "linear-gradient(135deg, #fb923c, #ea580c)"
                    : "rgba(255,255,255,0.08)",
                  boxShadow: isReady && !isBuffering
                    ? "0 0 32px rgba(249,115,22,0.65), 0 4px 12px rgba(0,0,0,0.4)"
                    : "none",
                }}
              >
                {isBuffering ? (
                  <svg className="w-5 h-5 animate-spin text-white/60" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : isPlaying ? (
                  <span className="text-black"><IconPause /></span>
                ) : (
                  <span className="text-black"><IconPlay /></span>
                )}
              </button>

              {/* Next */}
              <button
                onClick={nextSong}
                disabled={!isReady}
                aria-label="Next song"
                className="w-10 h-10 flex items-center justify-center rounded-full transition-all disabled:opacity-20 disabled:cursor-not-allowed hover:scale-110"
                style={{
                  color: keyFlash === "next" || keyFlash === "seekFwd" ? "#fb923c" : "rgba(255,255,255,0.5)",
                  background: keyFlash === "next" || keyFlash === "seekFwd" ? "rgba(249,115,22,0.22)" : "transparent",
                  boxShadow: keyFlash === "next" || keyFlash === "seekFwd" ? "0 0 14px rgba(249,115,22,0.35)" : "none",
                }}
              >
                <IconNext />
              </button>

              {/* Divider */}
              <div className="w-px h-5 bg-white/8 mx-1" />

              {/* Volume — always visible inline */}
              {isReady && (
                <VolumeControl
                  adapterRef={adapterRef}
                  externalMuted={isMuted}
                  externalVolume={volume}
                  onMuteChange={setIsMuted}
                  onVolumeChange={setVolume}
                />
              )}

              {/* Playlist toggle */}
              <button
                onClick={() => onPlaylistToggle?.()}
                disabled={!isReady}
                aria-label="Toggle playlist"
                aria-expanded={showPlaylist}
                className={`w-8 h-8 flex items-center justify-center rounded-full transition-all disabled:opacity-20 disabled:cursor-not-allowed ml-0.5 ${
                  showPlaylist
                    ? "text-orange-400 bg-orange-500/15"
                    : "text-white/35 hover:text-white/70 hover:bg-white/8"
                }`}
              >
                <IconList />
              </button>

            </div>
          </div>

          {/* Progress bar row */}
          {isReady && (
            <ProgressBar adapterRef={adapterRef} isPlaying={isPlaying} />
          )}
        </div>
      </div>
    </>
  );
}
