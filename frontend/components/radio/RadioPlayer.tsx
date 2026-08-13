"use client";

/**
 * RadioPlayer — Compact glassmorphic music player pill.
 *
 * Design: Modern, round, elegant glassmorphism with always-visible volume slider.
 * Features:
 * - Rotating vinyl record album art
 * - Song title + artist (truncated)
 * - Prev / Play-Pause / Next controls
 * - Always-visible inline volume slider
 * - Progress bar with seek
 * - Playlist drawer with clickable songs
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchRadioQueue } from "@/lib/api";
import { YouTubeIFramePlayerAdapter } from "@/lib/youtube-adapter";
import { useRadioStore } from "@/lib/radio-store";
import type { Song } from "@/lib/api";

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconPrev = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
  </svg>
);
const IconNext = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
  </svg>
);
const IconPlay = () => (
  <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IconPause = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);
const IconVolumeMute = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
  </svg>
);
const IconVolumeLow = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
  </svg>
);
const IconVolumeHigh = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
);
const IconList = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
  </svg>
);
const IconClose = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);

// ─── Vinyl Album Art ──────────────────────────────────────────────────────────

function VinylArt({ src, isPlaying }: { src: string | null; isPlaying: boolean }) {
  return (
    <div className="relative w-11 h-11 shrink-0">
      {/* Outer vinyl ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "conic-gradient(from 0deg, #1a0a00, #3a1a00, #1a0a00, #2a1200, #1a0a00)",
          animation: isPlaying ? "vinylSpin 4s linear infinite" : "none",
        }}
      />
      {/* Grooves */}
      {[0.82, 0.68, 0.54].map((r, i) => (
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
          inset: "22%",
          animation: isPlaying ? "vinylSpin 4s linear infinite" : "none",
        }}
      >
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-[#2a1005] flex items-center justify-center text-orange-400/60 text-[8px]">
            🪔
          </div>
        )}
      </div>
      {/* Center spindle */}
      <div
        className="absolute w-1.5 h-1.5 rounded-full bg-orange-500/80 shadow"
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
    <div className="flex items-center gap-2 w-full px-4 pb-2.5">
      <span className="text-white/25 text-[9px] w-6 text-right shrink-0 tabular-nums">{fmt(currentTime)}</span>
      <div className="relative flex-1 h-0.5 group cursor-pointer">
        <div className="absolute inset-0 rounded-full bg-white/10" />
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{
            width: `${progress * 100}%`,
            background: "linear-gradient(90deg, #fb923c, #f97316)",
          }}
        />
        {/* Thumb dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-orange-400 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${progress * 100}% - 4px)` }}
        />
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
      <span className="text-white/25 text-[9px] w-6 shrink-0 tabular-nums">{fmt(duration)}</span>
    </div>
  );
}

// ─── Inline Volume Control ────────────────────────────────────────────────────

function VolumeControl({
  adapterRef,
}: {
  adapterRef: React.MutableRefObject<YouTubeIFramePlayerAdapter | null>;
}) {
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    if (v === 0) {
      setIsMuted(true);
      adapterRef.current?.mute();
    } else {
      setIsMuted(false);
      adapterRef.current?.unMute();
      adapterRef.current?.setVolume(v);
    }
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      adapterRef.current?.unMute();
      adapterRef.current?.setVolume(volume || 80);
      setIsMuted(false);
    } else {
      adapterRef.current?.mute();
      setIsMuted(true);
    }
  };

  const VolumeIcon = isMuted || volume === 0 ? IconVolumeMute : volume < 50 ? IconVolumeLow : IconVolumeHigh;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={handleMuteToggle}
        aria-label={isMuted ? "Unmute" : `Volume ${volume}%`}
        className="text-white/40 hover:text-orange-400 transition-colors"
      >
        <VolumeIcon />
      </button>
      <div className="relative w-14 h-1 group">
        <div className="absolute inset-0 rounded-full bg-white/10" />
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${isMuted ? 0 : volume}%`,
            background: "linear-gradient(90deg, #fb923c, #f97316)",
          }}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={isMuted ? 0 : volume}
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

  return (
    <div className="absolute bottom-full left-0 right-0 mb-3">
      <div
        className="rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: "rgba(10, 4, 2, 0.95)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          backdropFilter: "blur(32px) saturate(180%)",
          WebkitBackdropFilter: "blur(32px) saturate(180%)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
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
          {queue.map((song, i) => (
            <button
              key={song.id}
              onClick={() => onPlaySong(i, song)}
              className={`w-full flex items-center gap-3 px-4 py-2 transition-colors text-left ${
                i === currentIndex ? "bg-orange-500/10" : "hover:bg-white/4"
              }`}
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
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main RadioPlayer ─────────────────────────────────────────────────────────

export default function RadioPlayer({ hasTunedIn = false }: { hasTunedIn?: boolean }) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<YouTubeIFramePlayerAdapter | null>(null);
  const muteRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPlaylist, setShowPlaylist] = useState(false);
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
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) state.nextSong();
        else state.adapter.seekTo(state.adapter.getCurrentTime() + 10);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) {
          if (state.currentIndex > 0) {
            const prevIdx = state.currentIndex - 1;
            const prevSong = state.queue[prevIdx];
            if (prevSong) {
              useRadioStore.setState({ currentIndex: prevIdx, playState: "BUFFERING" });
              await state.adapter.loadVideo(prevSong.youtube_video_id);
            }
          }
        } else {
          state.adapter.seekTo(Math.max(0, state.adapter.getCurrentTime() - 10));
        }
      } else if (e.code === "KeyM") {
        e.preventDefault();
        muteRef.current = !muteRef.current;
        if (muteRef.current) state.adapter.mute();
        else state.adapter.unMute();
      } else if (e.code === "KeyP") {
        e.preventDefault();
        setShowPlaylist((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

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
    setShowPlaylist(false);
  }, []);

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

      <div className="relative w-full max-w-md" role="region" aria-label="Radio player">
        {/* Hidden YouTube iframe */}
        <div
          ref={playerContainerRef}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", top: 0, left: 0 }}
          aria-hidden="true"
        />

        {/* Playlist drawer */}
        {showPlaylist && isReady && (
          <PlaylistDrawer onClose={() => setShowPlaylist(false)} onPlaySong={handlePlaySong} />
        )}

        {/* ── Glassmorphic pill ── */}
        <div
          className="flex flex-col rounded-[28px] overflow-hidden"
          style={{
            background: "rgba(12, 5, 2, 0.78)",
            backdropFilter: "blur(32px) saturate(180%)",
            WebkitBackdropFilter: "blur(32px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.10)",
            boxShadow: [
              "0 24px 64px rgba(0, 0, 0, 0.55)",
              "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
              "0 0 0 1px rgba(249, 115, 22, 0.06)",
            ].join(", "),
          }}
        >
          {/* Main row */}
          <div className="flex items-center gap-3 px-3.5 pt-3 pb-2.5">
            {/* Vinyl art */}
            <VinylArt src={albumArt} isPlaying={isPlaying} />

            {/* Song info */}
            <div className="flex-1 min-w-0">
              {error ? (
                <p className="text-red-400 text-xs" role="alert">{error}</p>
              ) : !isReady ? (
                <p className="text-orange-400/40 text-xs animate-pulse">Tuning in…</p>
              ) : currentSong ? (
                <>
                  <p className="text-white/90 text-sm font-semibold truncate leading-tight tracking-tight">{currentSong.title}</p>
                  <p className="text-orange-400/50 text-[11px] truncate mt-0.5">{currentSong.artist}</p>
                </>
              ) : (
                <p className="text-white/30 text-xs">No songs loaded</p>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-0.5 shrink-0">
              {/* Prev */}
              <button
                onClick={handlePrev}
                disabled={!isReady || currentIndex <= 0}
                aria-label="Previous song"
                className="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:text-white/80 hover:bg-white/8 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <IconPrev />
              </button>

              {/* Play / Pause — primary action */}
              <button
                onClick={isPlaying ? pausePlayback : startPlayback}
                disabled={!isReady || isBuffering}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="w-9 h-9 flex items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-not-allowed mx-0.5"
                style={{
                  background: isReady && !isBuffering
                    ? "linear-gradient(135deg, #fb923c, #ea580c)"
                    : "rgba(255,255,255,0.08)",
                  boxShadow: isReady && !isBuffering
                    ? "0 0 18px rgba(249,115,22,0.40), 0 2px 8px rgba(0,0,0,0.3)"
                    : "none",
                }}
              >
                {isBuffering ? (
                  <svg className="w-4 h-4 animate-spin text-white/60" fill="none" viewBox="0 0 24 24">
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
                className="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:text-white/80 hover:bg-white/8 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <IconNext />
              </button>

              {/* Divider */}
              <div className="w-px h-4 bg-white/8 mx-1" />

              {/* Volume — always visible inline */}
              {isReady && <VolumeControl adapterRef={adapterRef} />}

              {/* Playlist toggle */}
              <button
                onClick={() => setShowPlaylist((v) => !v)}
                disabled={!isReady}
                aria-label="Toggle playlist"
                aria-expanded={showPlaylist}
                className={`w-7 h-7 flex items-center justify-center rounded-full transition-all disabled:opacity-20 disabled:cursor-not-allowed ml-1 ${
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
