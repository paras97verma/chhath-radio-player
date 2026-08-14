"use client";

/**
 * ShareCard — Portrait story-format share card (540×960px, exports at 1080×1920 @2x).
 *
 * All styles are inline so html-to-image captures them faithfully.
 * Reads current song + listener count from the radio store.
 *
 * Design: glassmorphism Now Playing card, large album art, waveform bars,
 * rich layered background, dark QR pill, social proof strip.
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

// Waveform bar heights (px) — animated in live preview, static in image export
const WAVEFORM_BARS = [14, 22, 36, 28, 44, 32, 18, 40, 26, 48, 34, 20, 42, 30, 16, 38, 24, 46, 28, 36, 20, 44, 32, 18, 40];

// CSS keyframes for animated waveform bars (injected via <style> tag)
const WAVEFORM_KEYFRAMES = WAVEFORM_BARS.map(
  (h, i) => `
@keyframes waveBar${i} {
  0%   { height: ${Math.max(6, h * 0.35)}px; }
  50%  { height: ${h}px; }
  100% { height: ${Math.max(6, h * 0.35)}px; }
}`
).join("\n");

export const ShareCard = React.forwardRef<HTMLDivElement, ShareCardProps>(
  function ShareCard({ songTitle, songArtist, albumArtUrl, listenerCount, siteUrl }, ref) {
    const formattedCount = new Intl.NumberFormat("en-IN").format(listenerCount);

    return (
      <div
        ref={ref}
        style={{
          width: CARD_W,
          height: CARD_H,
          position: "relative",
          overflow: "hidden",
          fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
          // Rich layered background: deep crimson-black with warm undertones
          background: "radial-gradient(ellipse at 25% 15%, #2d0d00 0%, #160400 40%, #080101 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          boxSizing: "border-box",
        }}
      >
        {/* Inject waveform animation keyframes */}
        <style>{WAVEFORM_KEYFRAMES}</style>
        {/* ── Layer 1: Top-right radial glow ── */}
        <div
          style={{
            position: "absolute",
            top: -120,
            right: -120,
            width: 420,
            height: 420,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(249,115,22,0.28) 0%, rgba(234,88,12,0.08) 50%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        {/* ── Layer 2: Bottom-left secondary glow ── */}
        <div
          style={{
            position: "absolute",
            bottom: -80,
            left: -80,
            width: 360,
            height: 360,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(180,40,0,0.22) 0%, transparent 65%)",
            pointerEvents: "none",
          }}
        />

        {/* ── Layer 3: Dot-grid texture ── */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "radial-gradient(circle, rgba(249,115,22,0.07) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            pointerEvents: "none",
          }}
        />

        {/* ── Layer 4: Top diagonal corner accent ── */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 0,
            height: 0,
            borderStyle: "solid",
            borderWidth: "0 180px 180px 0",
            borderColor: "transparent rgba(249,115,22,0.09) transparent transparent",
            pointerEvents: "none",
          }}
        />

        {/* ── Layer 5: Bottom fade vignette ── */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 320,
            background: "linear-gradient(to top, rgba(8,1,1,0.85) 0%, transparent 100%)",
            pointerEvents: "none",
          }}
        />

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
            padding: "52px 36px 44px",
            boxSizing: "border-box",
          }}
        >
          {/* ── Brand header ── */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
            {/* Diya with layered glow */}
            <div style={{ position: "relative", marginBottom: 10 }}>
              <div
                style={{
                  position: "absolute",
                  inset: -32,
                  borderRadius: "50%",
                  background: "radial-gradient(circle, rgba(249,115,22,0.40) 0%, rgba(249,115,22,0.10) 50%, transparent 70%)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: -16,
                  borderRadius: "50%",
                  background: "radial-gradient(circle, rgba(251,146,60,0.25) 0%, transparent 70%)",
                }}
              />
              <span style={{ fontSize: 68, lineHeight: 1, position: "relative", display: "block" }}>🪔</span>
            </div>

            {/* Brand name with gradient text */}
            <div
              style={{
                fontSize: 40,
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
            <div
              style={{
                fontSize: 14,
                color: "rgba(251,146,60,0.60)",
                marginTop: 7,
                fontWeight: 500,
                letterSpacing: "0.08em",
              }}
            >
              छठ के गीत, बिना रुके
            </div>
          </div>

          {/* ── Divider ── */}
          <div
            style={{
              width: 80,
              height: 1,
              background: "linear-gradient(90deg, transparent, rgba(249,115,22,0.6), transparent)",
              margin: "24px 0",
            }}
          />

          {/* ── Now Playing glassmorphism card ── */}
          <div
            style={{
              width: "100%",
              position: "relative",
              // True frosted glass: semi-transparent tinted background with visible layering
              background: "linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(249,115,22,0.07) 50%, rgba(234,88,12,0.04) 100%)",
              border: "1px solid rgba(249,115,22,0.40)",
              borderRadius: 24,
              padding: "22px 22px 18px",
              boxSizing: "border-box",
              backdropFilter: "blur(24px) saturate(1.4)",
              WebkitBackdropFilter: "blur(24px) saturate(1.4)",
              // Layered shadows: outer depth + inner top highlight + orange glow
              boxShadow: [
                "0 8px 40px rgba(0,0,0,0.55)",
                "0 2px 12px rgba(249,115,22,0.12)",
                "inset 0 1px 0 rgba(255,255,255,0.12)",
                "inset 0 -1px 0 rgba(249,115,22,0.08)",
              ].join(", "),
            }}
          >
            {/* Inner geometric accent — top-right corner triangle */}
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 0,
                height: 0,
                borderStyle: "solid",
                borderWidth: "0 60px 60px 0",
                borderColor: "transparent rgba(249,115,22,0.08) transparent transparent",
                borderRadius: "0 24px 0 0",
                pointerEvents: "none",
              }}
            />
            {/* NOW PLAYING label */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 16,
              }}
            >
              {/* Pulsing dot (static for image export) */}
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#f97316",
                  boxShadow: "0 0 6px rgba(249,115,22,0.8)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.18em",
                  color: "rgba(249,115,22,0.65)",
                  textTransform: "uppercase",
                }}
              >
                NOW PLAYING
              </span>
            </div>

            {/* Album art + song info row */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
              {/* Large album art */}
              <div
                style={{
                  width: 110,
                  height: 110,
                  borderRadius: 16,
                  overflow: "hidden",
                  flexShrink: 0,
                  background: "linear-gradient(135deg, #1a0500, #2d0a00)",
                  border: "1px solid rgba(249,115,22,0.25)",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(249,115,22,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
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
                  <span style={{ fontSize: 40 }}>🪔</span>
                )}
              </div>

              {/* Song info */}
              <div style={{ minWidth: 0, flex: 1, paddingTop: 4 }}>
                <div
                  style={{
                    fontSize: 19,
                    fontWeight: 800,
                    color: "#ffffff",
                    lineHeight: 1.25,
                    marginBottom: 6,
                    // Clamp to 2 lines
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
                    fontSize: 13,
                    color: "rgba(249,115,22,0.65)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {songArtist || "Various Artists"}
                </div>
              </div>
            </div>

            {/* ── Waveform bars (animated in live preview) ── */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 3,
                marginTop: 18,
                height: 52,
                paddingBottom: 2,
                position: "relative",
              }}
            >
              {/* Baseline glow line */}
              <div
                style={{
                  position: "absolute",
                  bottom: 2,
                  left: 0,
                  right: 0,
                  height: 1,
                  background: "linear-gradient(90deg, transparent, rgba(249,115,22,0.4) 20%, rgba(251,146,60,0.7) 50%, rgba(249,115,22,0.4) 80%, transparent)",
                  pointerEvents: "none",
                }}
              />
              {WAVEFORM_BARS.map((h, i) => {
                const center = WAVEFORM_BARS.length / 2;
                const dist = Math.abs(i - center) / center;
                const opacity = 0.45 + (1 - dist) * 0.50;
                const duration = 0.5 + (i % 5) * 0.12;
                const delay = (i % 7) * 0.08;
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: h,
                      borderRadius: 3,
                      background: `linear-gradient(to top, #ea580c, #f97316 60%, #fb923c)`,
                      opacity,
                      boxShadow: `0 0 4px rgba(249,115,22,${opacity * 0.5})`,
                      animationName: `waveBar${i}`,
                      animationDuration: `${duration}s`,
                      animationDelay: `${delay}s`,
                      animationTimingFunction: "ease-in-out",
                      animationIterationCount: "infinite",
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* ── Listener count strip ── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 24,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 100,
              padding: "10px 20px",
            }}
          >
            {/* Live green dot */}
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: "#4ade80",
                boxShadow: "0 0 10px rgba(74,222,128,0.75)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 20,
                fontWeight: 800,
                background: "linear-gradient(135deg, #fb923c, #f97316)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {formattedCount}
            </span>
            <span
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.50)",
                fontWeight: 500,
              }}
            >
              listening live right now
            </span>
          </div>

          {/* ── URL pill ── */}
          <div
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(249,115,22,0.12)",
              border: "1px solid rgba(249,115,22,0.30)",
              borderRadius: 100,
              padding: "9px 20px",
            }}
          >
            {/* Play triangle */}
            <div
              style={{
                width: 0,
                height: 0,
                borderStyle: "solid",
                borderWidth: "5px 0 5px 9px",
                borderColor: "transparent transparent transparent #f97316",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "rgba(249,115,22,0.90)",
                letterSpacing: "0.02em",
              }}
            >
              {siteUrl.replace(/^https?:\/\//, "")}
            </span>
          </div>

          {/* ── Spacer ── */}
          <div style={{ flex: 1 }} />

          {/* ── QR code section ── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.30)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Scan to listen live
            </div>

            {/* Dark pill QR container */}
            <div
              style={{
                background: "rgba(255,255,255,0.96)",
                borderRadius: 16,
                padding: "12px 12px 10px",
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                boxShadow: "0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(249,115,22,0.15)",
              }}
            >
              <QRCodeSVG
                value={siteUrl}
                size={100}
                bgColor="#f5f5f5"
                fgColor="#0d0505"
                level="M"
              />
            </div>
          </div>

          {/* ── Bottom brand strip ── */}
          <div
            style={{
              marginTop: 20,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 28,
                height: 1,
                background: "rgba(249,115,22,0.25)",
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: "rgba(249,115,22,0.35)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              chhathradio.com · Made with 🪔
            </span>
            <div
              style={{
                width: 28,
                height: 1,
                background: "rgba(249,115,22,0.25)",
              }}
            />
          </div>
        </div>
      </div>
    );
  }
);