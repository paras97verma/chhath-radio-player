/** Resolves current Invidious stream metadata through the same-origin API route. */

import type { AudioStreamInfo, CanonicalStreamCandidate } from "../audio/types";
import { extractDurationFromUrl, isCurrentCanonicalSource } from "./stream-selector";

interface InFlightResolution {
  controller: AbortController;
  promise: Promise<AudioStreamInfo>;
  subscribers: number;
  settled: boolean;
}

interface StreamFailureContext {
  providerOrigin: string;
  generation: number;
}

const inFlightResolutions = new Map<string, InFlightResolution>();

function abortError(): DOMException {
  return new DOMException("The user aborted a request.", "AbortError");
}

function parseCurrentResponse(data: unknown, videoId: string): AudioStreamInfo {
  if (!data || typeof data !== "object") {
    throw new Error("Invidious stream resolver returned invalid metadata");
  }
  const response = data as Record<string, unknown>;
  const now = Date.now() / 1000;
  if (
    response.schema_version !== 1 ||
    response.video_id !== videoId ||
    !Number.isSafeInteger(response.generation) ||
    (response.generation as number) < 1 ||
    !Number.isFinite(response.refreshed_at) ||
    (response.refreshed_at as number) > now ||
    !Array.isArray(response.sources)
  ) {
    throw new Error("Invidious stream resolver returned no current canonical sources");
  }

  const sources: CanonicalStreamCandidate[] = [];
  const seenModes = new Set<string>();
  for (const source of response.sources) {
    if (!isCurrentCanonicalSource(source, now, videoId)) continue;
    if (seenModes.has(source.mode)) continue;
    seenModes.add(source.mode);
    sources.push(source);
  }
  sources.sort((a, b) => (a.mode === "direct" ? -1 : 1) - (b.mode === "direct" ? -1 : 1));
  const direct = sources.find((source) => source.mode === "direct");
  const proxy = sources.find((source) => source.mode === "proxy");
  const primary = direct || proxy;
  if (!primary) {
    throw new Error("Invidious stream resolver returned no current playable source");
  }

  const bitrate = Number.isFinite(primary.bitrate) && (primary.bitrate ?? 0) > 0
    ? Math.round(primary.bitrate as number)
    : 128000;
  const mediaType = primary.mime_type.split(";", 1)[0].trim().toLowerCase();
  const duration = typeof response.duration === "number" && response.duration > 0
    ? response.duration
    : extractDurationFromUrl(primary.url) || undefined;

  return {
    url: primary.url,
    direct_url: direct?.url,
    proxy_url: proxy?.url,
    status: direct ? "READY" : "DEGRADED",
    schema_version: 1,
    video_id: videoId,
    generation: response.generation as number,
    refreshed_at: response.refreshed_at as number,
    sources,
    format: mediaType === "audio/mp4" ? "M4A" : "WEBM_OPUS",
    quality: `${Math.round(bitrate / 1000)}kbps`,
    mimeType: primary.mime_type,
    codec: primary.codec || "",
    bitrate,
    duration,
    title: typeof response.title === "string" ? response.title : undefined,
    cache_tier: typeof response.cache_tier === "string" ? response.cache_tier : undefined,
  };
}

async function resolveFromRoute(
  videoId: string,
  forceFresh: boolean,
  signal: AbortSignal,
): Promise<AudioStreamInfo> {
  const route = `/api/stream?v=${encodeURIComponent(videoId)}${forceFresh ? "&force_fresh=true" : ""}`;
  const response = await fetch(route, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Invidious stream resolver failed with HTTP ${response.status}`);
  return parseCurrentResponse(await response.json(), videoId);
}

function createResolution(videoId: string, forceFresh: boolean, key: string): InFlightResolution {
  const controller = new AbortController();
  const flight: InFlightResolution = {
    controller,
    promise: resolveFromRoute(videoId, forceFresh, controller.signal),
    subscribers: 0,
    settled: false,
  };
  inFlightResolutions.set(key, flight);
  const clear = () => {
    flight.settled = true;
    if (inFlightResolutions.get(key) === flight) inFlightResolutions.delete(key);
  };
  void flight.promise.then(clear, clear);
  return flight;
}

function subscribeToResolution(flight: InFlightResolution, signal?: AbortSignal): Promise<AudioStreamInfo> {
  if (signal?.aborted) return Promise.reject(abortError());
  flight.subscribers += 1;

  return new Promise((resolve, reject) => {
    let finished = false;
    const release = (aborted: boolean) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      flight.subscribers -= 1;
      if (aborted && flight.subscribers === 0 && !flight.settled) flight.controller.abort();
    };
    const onAbort = () => {
      release(true);
      reject(abortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    flight.promise.then(
      (stream) => {
        if (signal?.aborted) {
          onAbort();
          return;
        }
        release(false);
        resolve(stream);
      },
      (error) => {
        release(false);
        reject(error);
      },
    );
  });
}

/**
 * Resolves an audio stream. Completed URLs are never retained in the browser;
 * only identical concurrent requests share one metadata resolution.
 */
export async function fetchPipedStream(
  videoId: string,
  _audioElement?: HTMLAudioElement | null,
  signal?: AbortSignal,
  forceFresh = false,
): Promise<AudioStreamInfo> {
  const cleanId = (videoId || "").trim();
  if (!cleanId) throw new Error("Invalid videoId provided");
  if (signal?.aborted) throw abortError();
  if (typeof window === "undefined") {
    throw new Error("Invidious stream resolution requires the same-origin route");
  }

  const key = `${cleanId}:${forceFresh ? "refresh" : "current"}`;
  let flight = inFlightResolutions.get(key);
  if (!flight || flight.controller.signal.aborted) {
    flight = createResolution(cleanId, forceFresh, key);
  }
  return subscribeToResolution(flight, signal);
}

/** Reports failed-candidate telemetry from the active attempt metadata. */
export async function reportStreamFailure(
  videoId: string,
  mode: "direct" | "proxy",
  reason: string,
  context?: StreamFailureContext,
): Promise<void> {
  const cleanId = (videoId || "").trim();
  const generation = context?.generation;
  const provider = context?.providerOrigin;
  if (
    !cleanId ||
    !provider ||
    provider.length > 200 ||
    !Number.isSafeInteger(generation) ||
    (generation ?? 0) < 1
  ) return;

  try {
    const origin = new URL(provider);
    if (origin.protocol !== "https:" || origin.origin !== provider || origin.pathname !== "/") return;
  } catch {
    return;
  }

  if (typeof window !== "undefined") {
    try {
      await fetch("/api/stream/source-failure", {
        method: "POST",
        cache: "no-store",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: cleanId,
          mode,
          provider,
          generation,
          reason: (reason || "unknown").slice(0, 120),
        }),
      });
    } catch {
      // Telemetry never blocks playback.
    }
  }
}
