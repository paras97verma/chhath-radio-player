"use client";

/**
 * ShareCard — Minimal portrait share card (540×960px, exports at 1080×1920 @2x).
 *
 * All styles are inline so html-to-image captures them faithfully.
 * Content: brand header, album art, song title, artist name, QR code.
 * Removed: waveform, listener count, URL pill.
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

const CARD_W = 540;
const CARD_H = 960;

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
          fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
          background: "radial-gradient(ellipse at 25% 15%, #2d0d00 0%, #160400 40%, #080101 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          boxSizing: "border-box",
        }}
      >
        {/* ── Background layers ── */}
        {/* Top-right radial glow */}
        <div style={{ position: "absolute", top: -120, right: -120, width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(249,115,22,0.28) 0%, rgba(234,88,12,0.08) 50%, transparent 70%)", pointerEvents: "none" }} />
        {/* Bottom-left glow */}
        <div style={{ position: "absolute", bottom: -80, left: -80, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(180,40,0,0.22) 0%, transparent 65%)", pointerEvents: "none" }} />
        {/* Dot-grid texture */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, rgba(249,115,22,0.07) 1px, transparent 1px)", backgroundSize: "24px 24px", pointerEvents: "none" }} />
        {/* Top-right corner accent */}
        <div style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, borderStyle: "solid", borderWidth: "0 180px 180px 0", borderColor: "transparent rgba(249,115,22,0.09) transparent transparent", pointerEvents: "none" }} />
        {/* Bottom fade vignette */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 320, background: "linear-gradient(to top, rgba(8,1,1,0.85) 0%, transparent 100%)", pointerEvents: "none" }} />

        {/* ── Content ── */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
            height: "100%",
            padding: "60px 40px 52px",
            boxSizing: "border-box",
          }}
        >
          {/* ── Brand header ── */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, marginBottom: 32 }}>
            {/* Diya with layered glow */}
            <div style={{ position: "relative", marginBottom: 12 }}>
              <div style={{ position: "absolute", inset: -32, borderRadius: "50%", background: "radial-gradient(circle, rgba(249,115,22,0.40) 0%, rgba(249,115,22,0.10) 50%, transparent 70%)" }} />
              <div style={{ position: "absolute", inset: -16, borderRadius: "50%", background: "radial-gradient(circle, rgba(251,146,60,0.25) 0%, transparent 70%)" }} />
              <span style={{ fontSize: 72, lineHeight: 1, position: "relative", display: "block" }}>🪔</span>
            </div>
            {/* Brand name */}
            <div
              style={{
                fontSize: 42,
                fontWeight: 900,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                background: "linear-gradient(135deg, #fb923c 0%, #f97316 45%, #ea580c 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                lineHeight: 1.1,
                marginTop: 4,
              }}
            >
              CHHATH RADIO
            </div>
            {/* Hindi tagline */}
            <div style={{ fontSize: 15, color: "rgba(251,146,60,0.60)", marginTop: 8, fontWeight: 500, letterSpacing: "0.08em" }}>
              छठ के गीत, बिना रुके
            </div>
          </div>

          {/* ── Divider ── */}
          <div style={{ width: 80, height: 1, background: "linear-gradient(90deg, transparent, rgba(249,115,22,0.6), transparent)", marginBottom: 36 }} />

          {/* ── Album art ── */}
          <div
            style={{
              width: 240,
              height: 240,
              borderRadius: 28,
              overflow: "hidden",
              flexShrink: 0,
              background: "linear-gradient(135deg, #1a0500, #2d0a00)",
              border: "1px solid rgba(249,115,22,0.28)",
              boxShadow: "0 12px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(249,115,22,0.10), 0 0 60px rgba(249,115,22,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 36,
            }}
          >
            {albumArtUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={albumArtUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} crossOrigin="anonymous" />
            ) : (
              <span style={{ fontSize: 80 }}>🪔</span>
            )}
          </div>

          {/* ── NOW PLAYING label ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 16 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f97316", boxShadow: "0 0 8px rgba(249,115,22,0.9)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(249,115,22,0.65)", textTransform: "uppercase" }}>
              NOW PLAYING
            </span>
          </div>

          {/* ── Song title ── */}
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#ffffff",
              lineHeight: 1.25,
              marginBottom: 10,
              textAlign: "center",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              width: "100%",
            }}
          >
            {songTitle || "Chhath Geet"}
          </div>

          {/* ── Artist name ── */}
          <div
            style={{
              fontSize: 16,
              color: "rgba(249,115,22,0.70)",
              fontWeight: 500,
              textAlign: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              width: "100%",
            }}
          >
            {songArtist || "Various Artists"}
          </div>

          {/* ── Spacer ── */}
          <div style={{ flex: 1 }} />

          {/* ── QR code section ── */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.30)", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>
              Scan to listen live
            </div>
            <div
              style={{
                background: "rgba(255,255,255,0.96)",
                borderRadius: 16,
                padding: "12px 12px 10px",
                display: "inline-flex",
                boxShadow: "0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(249,115,22,0.15)",
              }}
            >
              <QRCodeSVG value={siteUrl} size={100} bgColor="#f5f5f5" fgColor="#0d0505" level="M" />
            </div>
          </div>
        </div>
      </div>
    );
  }
);