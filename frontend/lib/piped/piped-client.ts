/**
 * Piped / Native Stream Client
 *
 * Resolves direct audio stream URLs for YouTube video IDs.
 * Implements:
 * 1. Primary path: Same-origin Next.js API route (/api/stream?v=...) to eliminate CORS and extension blockers
 * 2. Fallback path: Multi-instance failover with Invidious + Piped API support
 * 3. In-memory LRU stream cache (15-minute TTL)
 */

import type { AudioStreamInfo } from "../audio/types";
import { getHealthyInstances, markInstanceFailed, markInstanceSuccess } from "./instance-discovery";
import { selectBestAudioStream } from "./stream-selector";

interface CachedStream {
  stream: AudioStreamInfo;
  timestamp: number;
}

const STREAM_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const streamCache = new Map<string, CachedStream>();

export function clearStreamCache(videoId?: string): void {
  if (videoId) {
    streamCache.delete(videoId);
  } else {
    streamCache.clear();
  }
}

/**
 * Resolves an audio stream for a given YouTube video ID.
 */
export async function fetchPipedStream(
  videoId: string,
  audioElement?: HTMLAudioElement | null,
  signal?: AbortSignal
): Promise<AudioStreamInfo> {
  const cleanId = videoId.trim();
  if (!cleanId) {
    throw new Error("Invalid videoId provided");
  }

  if (signal?.aborted) {
    throw new DOMException("The user aborted a request.", "AbortError");
  }

  // Check in-memory cache
  const cached = streamCache.get(cleanId);
  if (cached && Date.now() - cached.timestamp < STREAM_CACHE_TTL_MS) {
    return cached.stream;
  }

  // 1. Primary path: query same-origin /api/stream if running in browser
  if (typeof window !== "undefined") {
    try {
      if (signal?.aborted) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }
      const res = await fetch(`/api/stream?v=${encodeURIComponent(cleanId)}`, {
        headers: { Accept: "application/json" },
        signal,
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.url) {
          const stream: AudioStreamInfo = {
            url: data.url,
            format: data.format || "M4A",
            quality: data.quality || "128kbps",
            mimeType: data.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
            codec: data.codec || "mp4a.40.2",
            bitrate: data.bitrate || 128000,
          };

          streamCache.set(cleanId, {
            stream,
            timestamp: Date.now(),
          });
          return stream;
        } else if (data && data.audioStreams && data.audioStreams.length > 0) {
          const best = data.audioStreams[0];
          const stream: AudioStreamInfo = {
            url: best.url,
            format: best.format || "M4A",
            quality: best.quality || "128kbps",
            mimeType: best.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
            codec: best.codec || "mp4a.40.2",
            bitrate: best.bitrate || 128000,
          };
          streamCache.set(cleanId, {
            stream,
            timestamp: Date.now(),
          });
          return stream;
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || signal?.aborted) {
        throw err;
      }
      console.warn("[StreamClient] Same-origin /api/stream fallback to direct instances:", err);
    }
  }

  if (signal?.aborted) {
    throw new DOMException("The user aborted a request.", "AbortError");
  }

  // 2. Fallback path: query instances directly (supports test env or offline server route)
  const instances = await getHealthyInstances();
  let lastError: Error | null = null;
  const attempts = Math.min(4, instances.length);

  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }
    const instance = instances[i];
    const isPiped = instance.apiUrl.includes("piped");
    const streamEndpoint = isPiped
      ? `${instance.apiUrl}/streams/${cleanId}`
      : `${instance.apiUrl}/api/v1/videos/${cleanId}?fields=title,adaptiveFormats,formatStreams`;

    try {
      const controller = new AbortController();
      const onAbort = () => {
        try { controller.abort(); } catch { /* ignore */ }
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      const timeoutId = setTimeout(() => {
        try { controller.abort(); } catch { /* ignore */ }
      }, 5000);

      const response = await fetch(streamEndpoint, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }

      if (signal?.aborted) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }

      if (!response.ok) {
        markInstanceFailed(instance.apiUrl);
        lastError = new Error(`Instance ${instance.name} returned HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      let normalizedStreams: AudioStreamInfo[] = [];

      if (data.audioStreams && Array.isArray(data.audioStreams) && data.audioStreams.length > 0) {
        normalizedStreams = data.audioStreams.map((s: any) => ({
          url: s.url,
          format: s.format || "M4A",
          quality: s.quality || "128kbps",
          mimeType: s.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
          codec: s.codec || "mp4a.40.2",
          bitrate: typeof s.bitrate === "number" ? s.bitrate : 128000,
        }));
      } else if (data.adaptiveFormats && Array.isArray(data.adaptiveFormats) && data.adaptiveFormats.length > 0) {
        const adaptive = data.adaptiveFormats.filter(
          (f: any) => (f.type || "").includes("audio") && f.url
        );
        normalizedStreams = adaptive.map((f: any) => ({
          url: f.url,
          format: (f.type || "").includes("mp4") ? "M4A" : "WEBM_OPUS",
          quality: f.audioQuality || "128kbps",
          mimeType: f.type || 'audio/mp4; codecs="mp4a.40.2"',
          codec: (f.type || "").includes("mp4") ? "mp4a.40.2" : "opus",
          bitrate: f.bitrate || 128000,
        }));
      }

      // If audioStreams is empty, check videoStreams with audio
      if (normalizedStreams.length === 0 && data.videoStreams) {
        const muxed = (data.videoStreams || []).filter((v: any) => !v.videoOnly && v.url);
        normalizedStreams = muxed.map((v: any) => ({
          url: v.url,
          format: v.format || "MP4",
          quality: v.quality || "360p",
          mimeType: v.mimeType || "video/mp4",
          codec: "mp4",
          bitrate: 128000,
        }));
      }

      if (normalizedStreams.length === 0) {
        markInstanceFailed(instance.apiUrl);
        lastError = new Error(`Instance ${instance.name} returned no audio streams`);
        continue;
      }

      const bestStream = selectBestAudioStream(normalizedStreams, audioElement);
      if (!bestStream) {
        markInstanceFailed(instance.apiUrl);
        continue;
      }

      markInstanceSuccess(instance.apiUrl);
      streamCache.set(cleanId, {
        stream: bestStream,
        timestamp: Date.now(),
      });

      return bestStream;
    } catch (err: any) {
      if (signal?.aborted || err?.name === "AbortError") {
        throw err;
      }
      markInstanceFailed(instance.apiUrl);
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error(`Failed to resolve audio stream for video ${cleanId}`);
}
