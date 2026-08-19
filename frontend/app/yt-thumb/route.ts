/**
 * GET /yt-thumb?v=<videoId>
 *
 * Server-side proxy for YouTube thumbnail images.
 * Fetches img.youtube.com server-side (no CORS restriction on the server)
 * and returns the image with Access-Control-Allow-Origin: * so that
 * html-to-image / toPng() can read the canvas without CORS taint.
 *
 * Only allows img.youtube.com hostnames to prevent open-proxy abuse.
 */

import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTNAME = "img.youtube.com";

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("v");

  if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) {
    return new NextResponse("Missing or invalid video ID", { status: 400 });
  }

  const imageUrl = `https://${ALLOWED_HOSTNAME}/vi/${videoId}/hqdefault.jpg`;

  try {
    const upstream = await fetch(imageUrl, {
      // Forward a browser-like UA so YouTube doesn't block the request
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ChhathRadio/1.0; +https://chhath-radio-ten.vercel.app)",
        Accept: "image/webp,image/jpeg,image/*,*/*;q=0.8",
      },
      // Don't cache the upstream fetch — Next.js will handle caching via headers
      cache: "no-store",
    });

    if (!upstream.ok) {
      return new NextResponse("Upstream fetch failed", {
        status: upstream.status,
      });
    }

    const contentType =
      upstream.headers.get("content-type") ?? "image/jpeg";
    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Allow html-to-image canvas reads from any origin
        "Access-Control-Allow-Origin": "*",
        // Cache for 1 hour in the browser, 24 hours on CDN edge
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (err) {
    console.error("[yt-thumb] fetch error:", err);
    return new NextResponse("Internal error", { status: 500 });
  }
}