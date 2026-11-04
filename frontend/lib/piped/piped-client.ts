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
import { selectBestAudioStream, extractDurationFromUrl } from "./stream-selector";

interface CachedStream {
  stream: AudioStreamInfo;
  timestamp: number;
}

const STREAM_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const streamCache = new Map<string, CachedStream>();

function isStreamUrlExpired(url: string): boolean {
  if (!url) return true;
  try {
    const u = new URL(url);
    const exp = u.searchParams.get("expire");
    if (exp) {
      const expSec = Number(exp);
      if (!isNaN(expSec) && Date.now() / 1000 >= expSec - 60) {
        return true;
      }
    }
  } catch {
    // If invalid URL, consider not expired
  }
  return false;
}

export function clearStreamCache(videoId?: string): void {
  if (videoId) {
    streamCache.delete(videoId);
  } else {
    streamCache.clear();
  }
}

/**
 * Reports a failed direct or proxy stream to the backend for selective invalidation/demotion.
 */
export async function reportStreamFailure(
  videoId: string,
  source: "direct" | "all" = "direct"
): Promise<void> {
  const cleanId = (videoId || "").trim();
  if (!cleanId) return;

  // Evict or demote in local cache
  const cached = streamCache.get(cleanId);
  if (cached) {
    if (source === "direct" && cached.stream.proxy_url && cached.stream.proxy_url !== cached.stream.url) {
      cached.stream.url = cached.stream.proxy_url;
      cached.stream.status = "DEGRADED";
    } else {
      streamCache.delete(cleanId);
    }
  }

  // Notify backend API non-blocking
  if (typeof window !== "undefined") {
    try {
      fetch(`/api/stream/cache/flush?v=${encodeURIComponent(cleanId)}&source=${source}`, {
        method: "POST",
      }).catch(() => {});
    } catch {}
  }
}

/**
 * Resolves an audio stream for a given YouTube video ID.
 */
export async function fetchPipedStream(
  videoId: string,
  audioElement?: HTMLAudioElement | null,
  signal?: AbortSignal,
  forceFresh: boolean = false
): Promise<AudioStreamInfo> {
  const cleanId = videoId.trim();
  if (!cleanId) {
    throw new Error("Invalid videoId provided");
  }

  if (signal?.aborted) {
    throw new DOMException("The user aborted a request.", "AbortError");
  }

  if (forceFresh) {
    streamCache.delete(cleanId);
  } else {
    // Check in-memory cache
    const cached = streamCache.get(cleanId);
    if (cached && Date.now() - cached.timestamp < STREAM_CACHE_TTL_MS && !isStreamUrlExpired(cached.stream.url)) {
      return cached.stream;
    }
  }

  // 1. Primary path: query same-origin /api/stream if running in browser
  if (typeof window !== "undefined") {
    try {
      if (signal?.aborted) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }
      const res = await fetch(
        `/api/stream?v=${encodeURIComponent(cleanId)}${forceFresh ? "&force_fresh=true" : ""}`,
        {
          headers: { Accept: "application/json" },
          signal,
        }
      );

      if (res.ok) {
        const data = await res.json();
        if (data && data.url && !isStreamUrlExpired(data.url)) {
          const durationVal =
            typeof data.duration === "number" && data.duration > 0
              ? data.duration
              : extractDurationFromUrl(data.url) || undefined;

          const stream: AudioStreamInfo = {
            url: data.url,
            direct_url: data.direct_url,
            proxy_url: data.proxy_url,
            status: data.status,
            sources: data.sources,
            format: data.format || "M4A",
            quality: data.quality || "128kbps",
            mimeType: data.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
            codec: data.codec || "mp4a.40.2",
            bitrate: data.bitrate || 128000,
            duration: durationVal,
            title: data.title,
            cache_tier: data.cache_tier,
          };

          streamCache.set(cleanId, {
            stream,
            timestamp: Date.now(),
          });
          return stream;
        } else if (data && data.audioStreams && data.audioStreams.length > 0) {
          const best = data.audioStreams[0];
          const durationVal =
            typeof data.duration === "number" && data.duration > 0
              ? data.duration
              : extractDurationFromUrl(best.url) || undefined;

          const stream: AudioStreamInfo = {
            url: best.url,
            format: best.format || "M4A",
            quality: best.quality || "128kbps",
            mimeType: best.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
            codec: best.codec || "mp4a.40.2",
            bitrate: best.bitrate || 128000,
            duration: durationVal,
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
        try { controller.abort("Parent signal aborted"); } catch { /* ignore */ }
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      const timeoutId = setTimeout(() => {
        try { controller.abort("Upstream resolution timed out"); } catch { /* ignore */ }
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

      if (normalizedStreams.length === 0) {
        markInstanceFailed(instance.apiUrl);
        lastError = new Error(`Instance ${instance.name} returned no pure audio streams`);
        continue;
      }

      const bestStream = selectBestAudioStream(normalizedStreams, audioElement);
      if (!bestStream) {
        markInstanceFailed(instance.apiUrl);
        continue;
      }

      if (!bestStream.duration) {
        bestStream.duration =
          Number(data.lengthSeconds || data.duration || 0) ||
          extractDurationFromUrl(bestStream.url) ||
          undefined;
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
