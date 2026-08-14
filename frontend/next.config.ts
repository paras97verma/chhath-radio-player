import type { NextConfig } from "next";

// Backend URL for server-side rewrites (Next.js → FastAPI).
// Inside Docker the backend is reachable via the service name; on the host it's localhost.
// Set BACKEND_URL in the container environment to override (e.g. http://chhath_backend:8000).
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// Public API URL baked in at build time (NEXT_PUBLIC_API_URL).
// Used in CSP connect-src so the browser can reach the backend directly (SSE, heartbeat).
// In production this is the Render URL; in local dev it's empty (uses Next.js rewrites).
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

const isProd = process.env.NODE_ENV === "production";

// script-src: remove 'unsafe-eval' in production (only needed by Next.js dev HMR)
const scriptSrc = isProd
  ? "'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com"
  : "'self' 'unsafe-eval' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com";

// connect-src: must include the backend URL so SSE (EventSource) and heartbeat
// POST requests are not blocked by CSP in production.
const connectSrcParts = ["'self'", "blob:"];
if (PUBLIC_API_URL) connectSrcParts.push(PUBLIC_API_URL);
// In local dev without NEXT_PUBLIC_API_URL, the browser hits /api/* which Next.js
// rewrites to the backend. The browser only sees localhost:3000, so no extra
// connect-src entry is needed. Docker-internal hostnames (chhath_backend) are
// server-side only and must NOT appear in browser-facing CSP headers.
if (!isProd && !PUBLIC_API_URL) {
  // Next.js rewrites /api/* → backend, so browser only needs 'self'
  // No extra entry needed — 'self' covers localhost:3000/api/*
}
const connectSrc = connectSrcParts.join(" ");

const nextConfig: NextConfig = {
  // Produce a self-contained build for Docker (copies only what's needed)
  output: "standalone",

  // Proxy /api/* to the FastAPI backend
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },

  // Allow external images (QR code generator)
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.qrserver.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },

  // Security headers + PWA service worker header
  async headers() {
    return [
      // ── Service worker: allow it to control the full origin scope ──────────
      // Without Service-Worker-Allowed: /, browsers may refuse to register
      // a SW whose scope is broader than its script path.
      {
        source: "/sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      // ── Manifest: ensure correct MIME type ────────────────────────────────
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      // ── All pages: CSP + security headers ─────────────────────────────────
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src ${scriptSrc}`,
              "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
              // blob: and data: required for canvas-generated images (share card, QR)
              "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://api.qrserver.com",
              `connect-src ${connectSrc}`,
              "media-src 'self' blob:",
              "style-src 'self' 'unsafe-inline'",
              // worker-src: 'self' for service worker; blob: for audio worklets
              "worker-src 'self' blob:",
            ].join("; "),
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
