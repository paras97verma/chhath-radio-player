"use client";

import { memo, type CSSProperties } from "react";
import type { Song } from "@/lib/api";

export type PlayerControlFlash = "prev" | "next" | "seekBack" | "seekFwd" | null;

const SPEC_BARS = [
  { dur: "0.7s", delay: "0s", h: 14 },
  { dur: "0.9s", delay: "0.15s", h: 20 },
  { dur: "0.6s", delay: "0.3s", h: 16 },
  { dur: "1.1s", delay: "0.1s", h: 22 },
  { dur: "0.8s", delay: "0.25s", h: 12 },
];

function Spectrogram({ isPlaying }: { isPlaying: boolean }) {
  if (!isPlaying) return null;

  return (
    <div className="flex items-end gap-[3px] h-6 shrink-0 self-center" aria-hidden="true">
      {SPEC_BARS.map((bar, index) => (
        <div
          key={index}
          className="spec-bar spec-bar-animated rounded-sm"
          style={{
            height: bar.h,
            "--dur": bar.dur,
            "--delay": bar.delay,
            background: "linear-gradient(to top, #ff6b35, #ffa726)",
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

type PlayerStatusProps = {
  song: Song | null;
  isFavorite: boolean;
  emptyLabel: string;
  statusLabel: string;
  hasPlaybackError: boolean;
  isActuallyPlaying: boolean;
  isBuffering: boolean;
  isPlaying: boolean;
};

export const PlayerStatus = memo(function PlayerStatus({
  song,
  isFavorite,
  emptyLabel,
  statusLabel,
  hasPlaybackError,
  isActuallyPlaying,
  isBuffering,
  isPlaying,
}: PlayerStatusProps) {
  return (
    <div
      className="flex items-center justify-between px-4 sm:px-5 py-2 border-b min-h-[60px] shrink-0 relative"
      style={{ borderColor: "rgba(255,138,80,0.18)" }}
    >
      <div className="min-w-0 flex-1 text-center px-2 sm:px-6 flex flex-col justify-center">
        {song ? (
          <>
            <div className="flex items-center justify-center gap-1.5 min-w-0">
              <p className="text-[#fff7ed] text-xs sm:text-sm font-semibold truncate leading-tight tracking-wide">
                {song.title}
              </p>
              {isFavorite && (
                <span
                  className="text-[11px] sm:text-xs shrink-0 select-none pointer-events-none cursor-default"
                  title="In Favorites"
                  aria-label="In Favorites"
                >
                  ❤️
                </span>
              )}
            </div>
            <p className="text-amber-200/70 text-[10px] sm:text-[11px] truncate mt-0.5 font-medium tracking-wide">
              {song.artist}
            </p>
          </>
        ) : (
          <p className="text-white/70 text-xs font-medium">{emptyLabel}</p>
        )}
        <div
          className={`mt-1 inline-flex items-center justify-center gap-1.5 text-[10px] font-semibold tracking-wide ${hasPlaybackError ? "text-rose-200" : isActuallyPlaying ? "text-emerald-200" : isBuffering || isPlaying ? "text-amber-100" : "text-white/55"}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full shrink-0 ${hasPlaybackError ? "bg-rose-400" : isActuallyPlaying ? "bg-emerald-400" : isBuffering || isPlaying ? "bg-amber-300 animate-pulse" : "bg-white/35"}`}
            aria-hidden="true"
          />
          <span>{statusLabel}</span>
          <Spectrogram isPlaying={isActuallyPlaying} />
        </div>
      </div>
    </div>
  );
});

type PlayerControlsProps = {
  isReady: boolean;
  currentIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  keyFlash: PlayerControlFlash;
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
};

const IconPrev = () => (
  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
  </svg>
);

const IconNext = () => (
  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
  </svg>
);

const IconPlay = () => (
  <svg className="w-5 h-5 sm:w-6 sm:h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const IconPause = () => (
  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

const PlayerControls = memo(function PlayerControls({
  isReady,
  currentIndex,
  isPlaying,
  isBuffering,
  keyFlash,
  onPrevious,
  onPlayPause,
  onNext,
}: PlayerControlsProps) {
  return (
    <>
      <button
        type="button"
        onClick={onPrevious}
        disabled={!isReady || currentIndex <= 0}
        aria-label="Previous song"
        className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-all disabled:cursor-not-allowed hover:scale-110 active:scale-95"
        style={{
          color: keyFlash === "prev" || keyFlash === "seekBack" ? "#ffa726" : "rgba(255,255,255,0.5)",
          background: keyFlash === "prev" || keyFlash === "seekBack" ? "rgba(255, 138, 80, 0.25)" : "transparent",
          boxShadow: keyFlash === "prev" || keyFlash === "seekBack" ? "0 0 16px rgba(255, 138, 80, 0.45)" : "none",
          opacity: !isReady && !keyFlash ? 0.2 : 1,
        }}
      >
        <IconPrev />
      </button>

      <button
        type="button"
        onClick={onPlayPause}
        disabled={!isReady || isBuffering}
        aria-label={isPlaying ? "Pause" : "Play"}
        className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-not-allowed mx-0.5"
        style={{
          background: isReady && !isBuffering
            ? "linear-gradient(135deg, #ffa726, #ff7043)"
            : "rgba(255,255,255,0.08)",
          boxShadow: isReady && !isBuffering
            ? "0 0 35px rgba(255, 112, 67, 0.7), 0 4px 14px rgba(0,0,0,0.5)"
            : "none",
        }}
      >
        {isBuffering ? (
          <svg className="w-5 h-5 animate-spin text-white/60" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : isPlaying ? (
          <span className="text-black"><IconPause /></span>
        ) : (
          <span className="text-black"><IconPlay /></span>
        )}
      </button>

      <button
        type="button"
        onClick={onNext}
        disabled={!isReady}
        aria-label="Next song"
        className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-all disabled:opacity-20 disabled:cursor-not-allowed hover:scale-110 active:scale-95"
        style={{
          color: keyFlash === "next" || keyFlash === "seekFwd" ? "#ffa726" : "rgba(255,255,255,0.5)",
          background: keyFlash === "next" || keyFlash === "seekFwd" ? "rgba(255, 138, 80, 0.25)" : "transparent",
          boxShadow: keyFlash === "next" || keyFlash === "seekFwd" ? "0 0 16px rgba(255, 138, 80, 0.45)" : "none",
        }}
      >
        <IconNext />
      </button>
    </>
  );
});

export default PlayerControls;
