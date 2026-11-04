import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const incoming = new URL(request.url);
  const videoId = incoming.searchParams.get("v") || incoming.searchParams.get("videoId");

  if (!videoId || !/^[A-Za-z0-9_-]{5,32}$/.test(videoId)) {
    return NextResponse.json(
      { error: "invalid_video_id" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const backendUrl = new URL(`${BACKEND_URL.replace(/\/+$/, "")}/api/stream`);
  backendUrl.searchParams.set("v", videoId);
  backendUrl.searchParams.set("priority", incoming.searchParams.get("priority") || "high");
  if (incoming.searchParams.get("force_fresh") === "true") {
    backendUrl.searchParams.set("force_fresh", "true");
  }

  try {
    const backendResponse = await fetch(backendUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      headers: {
        "Content-Type": backendResponse.headers.get("content-type") || "application/json",
        ...NO_STORE_HEADERS,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "stream_unavailable", retryable: true },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
