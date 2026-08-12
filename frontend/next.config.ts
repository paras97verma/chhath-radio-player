import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained build for Docker (copies only what's needed)
  output: "standalone",

  // Proxy /api/* to the FastAPI backend
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
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
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
              "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
              "img-src 'self' data: https://i.ytimg.com https://api.qrserver.com",
              "connect-src 'self' http://localhost:8000",
              "media-src 'self' blob:",
              "style-src 'self' 'unsafe-inline'",
              "worker-src blob:",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
