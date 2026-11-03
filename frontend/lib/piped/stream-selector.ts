/**
 * Audio Stream Codec Negotiation & Selection
 *
 * Chooses the best audio stream for the current browser:
 * - iOS Safari / WebKit: Requires AAC / audio/mp4 (WebM/Opus causes decode errors or silence).
 * - Android & Chromium / Firefox: Supports both Opus in WebM and AAC in MP4.
 * - Prioritizes medium-to-high bitrate (128kbps - 160kbps) for fast buffer initialization and high audio fidelity.
 */

import type { AudioStreamInfo } from "../audio/types";

export function isAppleWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // Match iOS (iPhone/iPad/iPod) or Safari on macOS (which has Safari but not Chrome or Chromium)
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isMacSafari = /Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR/i.test(ua);
  return isIos || isMacSafari;
}

/**
 * Extracts authoritative duration in seconds from YouTube CDN stream URL (&dur=...)
 */
export function extractDurationFromUrl(url?: string | null): number | null {
  if (!url) return null;
  try {
    const match = url.match(/[?&]dur=([0-9.]+)/);
    if (match && match[1]) {
      const parsed = parseFloat(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.round(parsed * 100) / 100;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Filter and rank audio streams by browser compatibility and quality
 */
export function selectBestAudioStream(
  streams: AudioStreamInfo[],
  audioElement?: HTMLAudioElement | null
): AudioStreamInfo | null {
  if (!streams || streams.length === 0) return null;

  const apple = isAppleWebKit();

  // Test canPlayType when an HTMLAudioElement is provided
  const playable = streams.filter((stream) => {
    if (!audioElement || typeof audioElement.canPlayType !== "function") {
      // Heuristic fallback if no audio element (e.g. test environment)
      if (apple) {
        return (
          stream.format === "M4A" ||
          stream.mimeType.includes("mp4") ||
          stream.mimeType.includes("aac")
        );
      }
      return true;
    }

    const test = audioElement.canPlayType(stream.mimeType);
    return test === "probably" || test === "maybe";
  });

  const candidates = playable.length > 0 ? playable : streams;

  if (apple) {
    // Prefer M4A / AAC for Apple WebKit
    const m4aStreams = candidates.filter(
      (s) =>
        s.format === "M4A" ||
        s.mimeType.includes("mp4") ||
        s.mimeType.includes("aac")
    );
    if (m4aStreams.length > 0) {
      // Prioritize AAC-LC (mp4a.40.2 / itag 140) to prevent iOS Safari 2x duration inflation
      const aacLc = m4aStreams.find((s) => s.mimeType.includes("mp4a.40.2"));
      if (aacLc) return aacLc;
      return m4aStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    }
  }

  // For non-Apple (Android / Desktop), sort by bitrate descending
  // Optimal streaming quality is ~160kbps Opus or 128kbps AAC
  const sorted = [...candidates].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return sorted[0] || null;
}

