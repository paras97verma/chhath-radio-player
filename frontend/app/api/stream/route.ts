import { NextRequest, NextResponse } from "next/server";
import { extractDurationFromUrl } from "@/lib/piped/stream-selector";

interface CachedStreamResult {
  url: string;
  format: string;
  mimeType: string;
  bitrate: number;
  duration?: number;
  title?: string;
  timestamp: number;
  cached?: boolean;
  cache_tier?: string;
}

const streamCache = new Map<string, CachedStreamResult>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 mins

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

function isUrlExpired(url: string): boolean {
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
  } catch {}
  return false;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("v") || searchParams.get("videoId");

  if (!videoId || videoId.length < 5) {
    return NextResponse.json({ error: "Missing or invalid video ID" }, { status: 400 });
  }

  // 1. Check in-memory Next.js server cache
  const cached = streamCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS && !isUrlExpired(cached.url)) {
    return NextResponse.json({ ...cached, cached: true, cache_tier: "NEXT_MEM" });
  }

  // 2. Primary: query FastAPI Backend with Redis high-concurrency stream caching
  try {
    const backendRes = await fetch(
      `${BACKEND_URL}/api/stream?v=${encodeURIComponent(videoId)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      }
    );

    if (backendRes.ok) {
      const data = await backendRes.json();
      if (data && data.url && !isUrlExpired(data.url)) {
        const streamDuration =
          typeof data.duration === "number" && data.duration > 0
            ? data.duration
            : extractDurationFromUrl(data.url) || undefined;

        const result: CachedStreamResult = {
          url: data.url,
          format: data.format || "M4A",
          mimeType: data.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
          bitrate: data.bitrate || 128000,
          duration: streamDuration,
          title: data.title,
          timestamp: Date.now(),
          cached: data.cached,
          cache_tier: data.cache_tier || "REDIS_BACKEND",
        };
        streamCache.set(videoId, result);
        return NextResponse.json(result);
      }
    }
  } catch (backendErr) {
    console.warn("[NextApiStream] Backend Redis stream resolution fallback:", backendErr);
  }

  // 3. Fallback: Direct extraction if backend is offline or starting
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  const candidateEndpoints = [
    {
      type: "invidious",
      url: `https://yt.chocolatemoo53.com/api/v1/videos/${videoId}?fields=title,adaptiveFormats,formatStreams`,
      name: "Chocolatemoo (USA - Verified Active)",
    },
    {
      type: "invidious",
      url: `https://invidious.tiekoetter.com/api/v1/videos/${videoId}?fields=title,adaptiveFormats,formatStreams`,
      name: "Tiekoetter (Germany)",
    },
    {
      type: "invidious",
      url: `https://invidious.nerdvpn.de/api/v1/videos/${videoId}?fields=title,adaptiveFormats,formatStreams`,
      name: "NerdVPN (Canada)",
    },
    {
      type: "invidious",
      url: `https://inv.nadeko.net/api/v1/videos/${videoId}?fields=title,adaptiveFormats,formatStreams`,
      name: "Nadeko (Chile)",
    },
    {
      type: "piped",
      url: `https://api.piped.private.coffee/streams/${videoId}`,
      name: "Private Coffee",
    },
    {
      type: "piped",
      url: `https://pipedapi.ducks.party/streams/${videoId}`,
      name: "Ducks Party",
    },
  ];

  for (const candidate of candidateEndpoints) {
    try {
      const res = await fetch(candidate.url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(4500),
      });

      if (!res.ok) continue;

      const data = await res.json();

      if (candidate.type === "invidious") {
        const adaptive = (data.adaptiveFormats || []).filter(
          (f: any) => (f.type || "").includes("audio") && f.url
        );

        if (adaptive.length > 0) {
          // Prioritize AAC-LC (mp4a.40.2 / itag 140) to prevent iOS Safari 2x duration inflation
          const m4aStreams = adaptive
            .filter((f: any) => (f.type || "").includes("mp4"))
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

          const aacLc = m4aStreams.find((f: any) => (f.type || "").includes("mp4a.40.2"));
          const best = aacLc || m4aStreams[0] || adaptive[0];

          const streamDuration =
            Number(data.lengthSeconds || 0) ||
            (best.approxDurationMs ? Number(best.approxDurationMs) / 1000 : 0) ||
            extractDurationFromUrl(best.url) ||
            undefined;

          const result: CachedStreamResult = {
            url: best.url,
            format: (best.type || "").includes("mp4") ? "M4A" : "WEBM_OPUS",
            mimeType: best.type || 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: best.bitrate || 128000,
            duration: streamDuration,
            title: data.title,
            timestamp: Date.now(),
            cached: false,
            cache_tier: "DIRECT_FALLBACK",
          };

          streamCache.set(videoId, result);
          return NextResponse.json(result);
        }
      } else if (candidate.type === "piped") {
        const audioStreams = data.audioStreams || [];
        if (audioStreams.length > 0) {
          const m4aStreams = audioStreams
            .filter((s: any) => (s.mimeType || "").includes("mp4") || s.format === "M4A")
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

          const aacLc = m4aStreams.find((s: any) => (s.mimeType || "").includes("mp4a.40.2"));
          const best = aacLc || m4aStreams[0] || audioStreams[0];

          const streamDuration =
            Number(data.duration || 0) ||
            extractDurationFromUrl(best.url) ||
            undefined;

          const result: CachedStreamResult = {
            url: best.url,
            format: best.format || "M4A",
            mimeType: best.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: best.bitrate || 128000,
            duration: streamDuration,
            title: data.title,
            timestamp: Date.now(),
            cached: false,
            cache_tier: "DIRECT_FALLBACK",
          };

          streamCache.set(videoId, result);
          return NextResponse.json(result);
        }
      }
    } catch {
      // Try next candidate
    }
  }

  return NextResponse.json(
    { error: `Could not resolve playable audio stream for video ${videoId}` },
    { status: 502 }
  );
}
