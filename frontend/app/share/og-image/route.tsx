/**
 * /share/og-image — Dynamic OG image generator.
 *
 * Uses Next.js ImageResponse (Vercel OG) to render a 1200×630 PNG
 * that social platforms (WhatsApp, Twitter, Instagram) use as the
 * link preview image.
 *
 * Usage:
 *   /share/og-image?title=Kaanch+Hi+Baans&artist=Sharda+Sinha
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") ?? "Chhath Radio";
  const artist = searchParams.get("artist") ?? "छठ के गीत, बिना रुके";

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1a1a4e 0%, #0d1b4b 50%, #0a0a2e 100%)",
          fontFamily: "sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Top glow */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "300px",
            background:
              "radial-gradient(ellipse at 50% 0%, rgba(251,191,36,0.18) 0%, transparent 70%)",
          }}
        />

        {/* Bottom diya row */}
        <div
          style={{
            position: "absolute",
            bottom: "24px",
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "space-around",
            padding: "0 80px",
            opacity: 0.25,
            fontSize: "32px",
          }}
        >
          {["🪔", "🪔", "🪔", "🪔", "🪔", "🪔", "🪔"].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>

        {/* Main content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "20px",
            padding: "0 80px",
            textAlign: "center",
            zIndex: 1,
          }}
        >
          {/* Diya */}
          <div style={{ fontSize: "72px", lineHeight: 1 }}>🪔</div>

          {/* Station label */}
          <div
            style={{
              color: "rgba(251,191,36,0.7)",
              fontSize: "18px",
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Chhath Radio · LIVE
          </div>

          {/* Song title */}
          <div
            style={{
              color: "#ffffff",
              fontSize: title.length > 30 ? "48px" : "60px",
              fontWeight: 800,
              lineHeight: 1.15,
              maxWidth: "900px",
            }}
          >
            {title}
          </div>

          {/* Artist */}
          <div
            style={{
              color: "rgba(253,230,138,0.8)",
              fontSize: "28px",
              fontWeight: 400,
            }}
          >
            {artist}
          </div>

          {/* Divider */}
          <div
            style={{
              width: "80px",
              height: "2px",
              background: "rgba(251,191,36,0.35)",
              borderRadius: "1px",
            }}
          />

          {/* Tagline */}
          <div
            style={{
              color: "rgba(253,230,138,0.5)",
              fontSize: "20px",
            }}
          >
            छठ के गीत, बिना रुके · chhath-radio-ten.vercel.app
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}