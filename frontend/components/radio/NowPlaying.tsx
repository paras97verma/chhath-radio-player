"use client";

/**
 * NowPlaying — displays the current song with a Share button.
 *
 * The Share button builds a /share?title=...&artist=... URL and
 * copies it to the clipboard (or falls back to navigator.share on mobile).
 */

import { useState } from "react";
import { useRadioStore } from "@/lib/radio-store";

function buildShareUrl(title: string, artist: string): string {
  const base =
    typeof window !== "undefined"
      ? `${window.location.origin}/share`
      : "https://chhathradio.com/share";
  return `${base}?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
}

export default function NowPlaying() {
  const currentSong = useRadioStore((s) => s.currentSong());
  const playState = useRadioStore((s) => s.playState);
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (!currentSong) return;
    const url = buildShareUrl(currentSong.title, currentSong.artist);

    // Use native share sheet on mobile if available
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `🪔 ${currentSong.title} — Chhath Radio`,
          text: `Sun raha hoon "${currentSong.title}" by ${currentSong.artist} on Chhath Radio 🪔`,
          url,
        });
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available — open the share page directly
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div
      className="text-center"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Now playing"
    >
      {currentSong ? (
        <>
          <p className="text-xs uppercase tracking-widest text-amber-400/70 mb-1">
            {playState === "BUFFERING" ? "Loading…" : "Now Playing"}
          </p>
          <h1 className="text-2xl md:text-3xl font-bold text-white leading-tight">
            {currentSong.title}
          </h1>
          <p className="text-amber-200/80 mt-1 text-sm md:text-base">
            {currentSong.artist}
          </p>

          {/* Share button */}
          <button
            onClick={handleShare}
            aria-label="Share this song"
            className={[
              "mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full",
              "text-xs font-medium",
              "border border-amber-400/30 text-amber-300/70",
              "hover:border-amber-400/60 hover:text-amber-300",
              "active:scale-95 transition-all duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50",
            ].join(" ")}
          >
            {copied ? (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-3.5 h-3.5 text-green-400"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-green-400">Link copied!</span>
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <path d="M13 4.5a2.5 2.5 0 11.702 1.737L6.97 9.604a2.518 2.518 0 010 .792l6.733 3.367a2.5 2.5 0 11-.671 1.341l-6.733-3.367a2.5 2.5 0 110-3.475l6.733-3.366A2.52 2.52 0 0113 4.5z" />
                </svg>
                Share
              </>
            )}
          </button>
        </>
      ) : (
        <p className="text-amber-200/60 text-sm">
          Press play to begin the journey
        </p>
      )}
    </div>
  );
}