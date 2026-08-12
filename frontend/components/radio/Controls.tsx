"use client";

/**
 * Phase 7.2: Radio Controls Component
 *
 * Play/Pause and Skip buttons.
 * Fully keyboard-accessible with proper aria-labels.
 */

import { useRadioStore } from "@/lib/radio-store";

export default function Controls() {
  const playState = useRadioStore((s) => s.playState);
  const startPlayback = useRadioStore((s) => s.startPlayback);
  const pausePlayback = useRadioStore((s) => s.pausePlayback);
  const nextSong = useRadioStore((s) => s.nextSong);
  const queue = useRadioStore((s) => s.queue);

  const isPlaying = playState === "PLAYING";
  const isBuffering = playState === "BUFFERING";
  const hasQueue = queue.length > 0;

  const handlePlayPause = async () => {
    if (isPlaying) {
      await pausePlayback();
    } else {
      await startPlayback();
    }
  };

  return (
    <div
      className="flex items-center justify-center gap-6"
      role="group"
      aria-label="Radio controls"
    >
      {/* Play / Pause */}
      <button
        onClick={handlePlayPause}
        disabled={!hasQueue || isBuffering}
        aria-label={isPlaying ? "Pause" : "Play"}
        className={`
          w-16 h-16 rounded-full flex items-center justify-center
          transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-amber-400
          ${
            hasQueue && !isBuffering
              ? "bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/30"
              : "bg-white/10 text-white/30 cursor-not-allowed"
          }
        `}
      >
        {isBuffering ? (
          // Spinner
          <svg
            className="w-6 h-6 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : isPlaying ? (
          // Pause icon
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          // Play icon
          <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Skip Next */}
      <button
        onClick={nextSong}
        disabled={!hasQueue}
        aria-label="Skip to next song"
        className={`
          w-10 h-10 rounded-full flex items-center justify-center
          transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-amber-400
          ${
            hasQueue
              ? "text-amber-200 hover:text-white hover:bg-white/10"
              : "text-white/20 cursor-not-allowed"
          }
        `}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
        </svg>
      </button>
    </div>
  );
}