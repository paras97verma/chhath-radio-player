import type { NextConfig } from "next";

// Backend URL for server-side rewrites (Next.js → FastAPI).
// Inside Docker the backend is reachable via the service name; on the host it's localhost.
// Set BACKEND_URL in the container environment to override (e.g. http://chhath_backend:8000).
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

const isProd = process.env.NODE_ENV === "production";

// script-src: remove 'unsafe-eval' in production (only needed by Next.js dev HMR)
const scriptSrc = isProd
  ? "'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com"
  : "'self' 'unsafe-eval' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com";

// connect-src: Docker internal hostname is irrelevant in production browser context
const connectSrc = isProd
  ? "'self' blob:"
  : "'self' blob: http://localhost:8000 http://chhath_backend:8000";

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

  // Allow YouTube iframe embeds + QR code images
  async headers() {
    return [
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
