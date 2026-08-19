"use client";

/**
 * ShareCard — Minimal portrait share card for social sharing & downloads.
 * Clean, high-contrast, modern devotional aesthetic for Chhath Radio.
 */

import React from "react";
import { QRCodeSVG } from "qrcode.react";

export interface ShareCardProps {
  songTitle: string;
  songArtist: string;
  albumArtUrl: string | null;
  listenerCount: number;
  siteUrl: string;
}

const CARD_W = 440;
const CARD_H = 640;

export const ShareCard = React.forwardRef<HTMLDivElement, ShareCardProps>(
  function ShareCard({ songTitle, songArtist, albumArtUrl, siteUrl }, ref) {
    return (
      <div
        ref={ref}
        style={{
          width: CARD_W,
          height: CARD_H,
          position: "relative",
          overflow: "hidden",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "linear-gradient(165deg, #180702 0%, #0d0402 45%, #050101 100%)",
          borderRadius: 24,
          border: "1px solid rgba(249,115,22,0.3)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.8), 0 0 40px rgba(249,115,22,0.12)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          boxSizing: "border-box",
          padding: "36px 28px 28px",
        }}
      >
        {/* Subtle background glow */}
        <div
          style={{
            position: "absolute",
            top: -60,
            left: "50%",
            transform: "translateX(-50%)",
            width: 320,
            height: 220,
            borderRadius: "50%",
            background: "radial-gradient(ellipse at center, rgba(249,115,22,0.22) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        {/* Brand header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 24,
            zIndex: 1,
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>🪔</span>
          <span
            style={{
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: "0.15em",
              color: "#f97316",
              textTransform: "uppercase",
            }}
          >
            CHHATH RADIO
          </span>
        </div>

        {/* Album Art */}
        <div
          style={{
            width: 190,
            height: 190,
            borderRadius: 20,
            overflow: "hidden",
            background: "rgba(249,115,22,0.08)",
            border: "1px solid rgba(249,115,22,0.25)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.6), 0 0 20px rgba(249,115,22,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
            flexShrink: 0,
            position: "relative",
            zIndex: 1,
          }}
        >
          {albumArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={albumArtUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              crossOrigin="anonymous"
            />
          ) : (
            <span style={{ fontSize: 64 }}>🪔</span>
          )}
        </div>

        {/* Live badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 20,
            background: "rgba(239,68,68,0.15)",
            border: "1px solid rgba(239,68,68,0.3)",
            marginBottom: 12,
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#ef4444",
              boxShadow: "0 0 6px #ef4444",
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.12em",
              color: "#f87171",
              textTransform: "uppercase",
            }}
          >
            NOW PLAYING · LIVE
          </span>
        </div>

        {/* Song Title & Artist */}
        <div
          style={{
            textAlign: "center",
            width: "100%",
            marginBottom: 20,
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#ffffff",
              lineHeight: 1.25,
              marginBottom: 6,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {songTitle || "Chhath Geet"}
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "rgba(253,186,116,0.75)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {songArtist || "Various Artists"}
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* QR Section */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            width: "100%",
            padding: "12px 16px",
            borderRadius: 16,
            background: "rgba(249,115,22,0.06)",
            border: "1px solid rgba(249,115,22,0.15)",
            boxSizing: "border-box",
            zIndex: 1,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 10,
              padding: 6,
              display: "flex",
              flexShrink: 0,
            }}
          >
            <QRCodeSVG value={siteUrl} size={64} bgColor="#ffffff" fgColor="#0d0402" level="M" />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#f97316" }}>
              Listen 24/7 Live
            </span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
              Scan QR code to join
            </span>
            <span style={{ fontSize: 10, color: "rgba(253,186,116,0.5)", fontFamily: "monospace" }}>
              chhath-radio-ten.vercel.app
            </span>
          </div>
        </div>
      </div>
    );
  }
);