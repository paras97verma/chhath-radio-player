/** Browser-side validation and codec selection for canonical Invidious sources. */

import type { AudioStreamInfo, CanonicalStreamCandidate } from "../audio/types";

const EXPIRY_SAFETY_SECONDS = 600;
const UNKNOWN_EXPIRY_MAX_AGE_SECONDS = 1800;

export function isAppleWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isMacSafari = /Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR/i.test(ua);
  return isIos || isMacSafari;
}

export function extractDurationFromUrl(url?: string | null): number | null {
  if (!url) return null;
  try {
    const match = url.match(/[?&]dur=([0-9.]+)/);
    if (match?.[1]) {
      const parsed = Number.parseFloat(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed * 100) / 100;
    }
  } catch {
    // Duration is optional metadata.
  }
  return null;
}

export function isSupportedAudioMimeType(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "audio/mp4" || mediaType === "audio/webm";
}

/** Fail closed unless the active media element explicitly accepts the MIME type. */
export function isMimeTypeSupportedByAudioElement(
  audioElement: HTMLAudioElement | null | undefined,
  mimeType: string,
): boolean {
  if (!audioElement || typeof audioElement.canPlayType !== "function") return false;
  try {
    const support = audioElement.canPlayType(mimeType);
    return support === "probably" || support === "maybe";
  } catch {
    return false;
  }
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

/**
 * Validate one independently expiring source. Known direct URL expiry keeps the
 * backend's 10-minute safety margin; unknown expiry is bounded to 30 minutes.
 */
export function isCurrentCanonicalSource(
  value: unknown,
  nowSeconds = Date.now() / 1000,
  expectedVideoId?: string,
): value is CanonicalStreamCandidate {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<CanonicalStreamCandidate>;
  if (
    (source.mode !== "direct" && source.mode !== "proxy") ||
    source.provider !== "invidious" ||
    typeof source.provider_origin !== "string" ||
    !isHttpsUrl(source.url) ||
    !Number.isSafeInteger(source.itag) ||
    (source.itag ?? 0) <= 0 ||
    !isSupportedAudioMimeType(source.mime_type) ||
    !Number.isFinite(source.resolved_at) ||
    !Number.isFinite(source.refresh_at) ||
    source.validation_state !== "validated"
  ) return false;

  const resolvedAt = source.resolved_at as number;
  const refreshAt = source.refresh_at as number;
  if (resolvedAt <= 0 || resolvedAt > nowSeconds || refreshAt <= nowSeconds) return false;

  let origin: URL;
  let mediaUrl: URL;
  try {
    origin = new URL(source.provider_origin);
    mediaUrl = new URL(source.url);
  } catch {
    return false;
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== source.provider_origin ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) return false;

  const expiryParam = mediaUrl.searchParams.get("expire");
  if (source.mode === "direct") {
    if (source.expires_at == null) {
      if (expiryParam || nowSeconds - resolvedAt >= UNKNOWN_EXPIRY_MAX_AGE_SECONDS) return false;
      if (refreshAt > resolvedAt + UNKNOWN_EXPIRY_MAX_AGE_SECONDS) return false;
      return true;
    }
    const expiresAt = source.expires_at;
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= nowSeconds + EXPIRY_SAFETY_SECONDS ||
      refreshAt > expiresAt - EXPIRY_SAFETY_SECONDS ||
      (expiryParam !== null && Math.floor(Number(expiryParam)) !== Math.floor(expiresAt))
    ) return false;
    return true;
  }

  if (source.expires_at != null || expiryParam || mediaUrl.origin !== origin.origin || mediaUrl.pathname !== "/latest_version") {
    return false;
  }
  const params = [...mediaUrl.searchParams.keys()].sort();
  const expectedKeys = ["id", "itag", "local"];
  if (
    params.length !== expectedKeys.length ||
    params.some((key, index) => key !== expectedKeys[index]) ||
    mediaUrl.searchParams.get("id") !== expectedVideoId ||
    mediaUrl.searchParams.get("itag") !== String(source.itag) ||
    mediaUrl.searchParams.get("local") !== "true" ||
    nowSeconds - resolvedAt >= UNKNOWN_EXPIRY_MAX_AGE_SECONDS ||
    refreshAt > resolvedAt + UNKNOWN_EXPIRY_MAX_AGE_SECONDS
  ) return false;
  return true;
}

function isCurrentStreamInfo(stream: AudioStreamInfo, nowSeconds: number): boolean {
  if (
    typeof stream.video_id !== "string" ||
    !Number.isSafeInteger(stream.generation) ||
    (stream.generation ?? 0) <= 0 ||
    stream.schema_version !== 1 ||
    !isHttpsUrl(stream.url) ||
    !isSupportedAudioMimeType(stream.mimeType)
  ) return false;
  return (stream.sources || []).some((source) =>
    source.url === stream.url &&
    "mode" in source &&
    isCurrentCanonicalSource(source, nowSeconds, stream.video_id) &&
    source.mime_type.split(";", 1)[0].trim().toLowerCase() === stream.mimeType.split(";", 1)[0].trim().toLowerCase()
  );
}

/**
 * Return the best current stream the browser says it can play.
 * Direct sources are always preferred before proxy sources at the same MIME type.
 * Among sources of the same mode, the highest bitrate wins.
 * No last-resort fallback: if canPlayType() rejects a type, that stream is excluded.
 */
export function selectBestAudioStream(
  streams: AudioStreamInfo[],
  audioElement?: HTMLAudioElement | null,
): AudioStreamInfo | null {
  if (!streams?.length) return null;
  const nowSeconds = Date.now() / 1000;
  const apple = isAppleWebKit();

  const playable = streams.filter((stream) => {
    if (!isCurrentStreamInfo(stream, nowSeconds)) return false;
    return isMimeTypeSupportedByAudioElement(audioElement, stream.mimeType);
  });
  if (!playable.length) return null;

  // Determine the primary source mode for each stream (direct beats proxy).
  const primaryMode = (stream: AudioStreamInfo): "direct" | "proxy" => {
    const src = stream.sources?.find((s) => s.url === stream.url && "mode" in s);
    return (src as { mode?: string })?.mode === "direct" ? "direct" : "proxy";
  };

  // Sort: direct before proxy; within same mode, higher bitrate first.
  // On Apple WebKit also prefer AAC/M4A over WebM.
  const sorted = [...playable].sort((a, b) => {
    const aMode = primaryMode(a) === "direct" ? 0 : 1;
    const bMode = primaryMode(b) === "direct" ? 0 : 1;
    if (aMode !== bMode) return aMode - bMode;
    if (apple) {
      const aAac = /audio\/mp4|aac/i.test(a.mimeType) ? 0 : 1;
      const bAac = /audio\/mp4|aac/i.test(b.mimeType) ? 0 : 1;
      if (aAac !== bAac) return aAac - bAac;
    }
    return (b.bitrate || 0) - (a.bitrate || 0);
  });
  return sorted[0] ?? null;
}
