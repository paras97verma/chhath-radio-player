"use client";

/**
 * ShareCard — Portrait story-format share card (540×960px, exports at 1080×1920 @2x).
 *
 * All styles are inline so html-to-image captures them faithfully.
 * Reads current song + listener count from the radio store.
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
          background: "radial-gradient(ellipse at 30% 20%, #2a0a00 0%, #120300 45%, #050101 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          boxSizing: "border-box",
        }}
      >
        {/* ── Decorative diagonal streak top-right ── */}
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -80,
            width: 320,
            height: 320,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(249,115,22,0.22) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />
        {/* ── Diagonal orange slash ── */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 0,
            height: 0,
            borderStyle: "solid",
            borderWidth: "0 200px 200px 0",
            borderColor: "transparent rgba(249,115,22,0.12) transparent transparent",
            pointerEvents: "none",
          }}
        />

        {/* ── Dot-grid overlay ── */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle, rgba(249,115,22,0.08) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            pointerEvents: "none",
          }}
        />

        {/* ── Bottom glow ── */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 280,
            background:
              "linear-gradient(to top, rgba(249,115,22,0.10) 0%, transparent 100%)",
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
            padding: "56px 40px 48px",
            boxSizing: "border-box",
          }}
        >
          {/* Diya + glow */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <div
              style={{
                position: "absolute",
                inset: -24,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(249,115,22,0.35) 0%, transparent 70%)",
              }}
            />
            <span style={{ fontSize: 72, lineHeight: 1, position: "relative" }}>🪔</span>
          </div>

          {/* Brand name */}
          <div
            style={{
              fontSize: 42,
              fontWeight: 900,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              background: "linear-gradient(135deg, #fb923c 0%, #f97316 50%, #ea580c 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              marginTop: 16,
              lineHeight: 1.1,
            }}
          >
            CHHATH RADIO
          </div>

          {/* Hindi tagline */}
          <div
            style={{
              fontSize: 16,
              color: "rgba(249,115,22,0.65)",
              marginTop: 8,
              fontWeight: 500,
              letterSpacing: "0.06em",
            }}
          >
            छठ के गीत, बिना रुके
          </div>

          {/* Divider */}
          <div
            style={{
              width: 60,
              height: 2,
              background: "linear-gradient(90deg, transparent, #f97316, transparent)",
              margin: "28px 0",
              borderRadius: 1,
            }}
          />

          {/* Now Playing card */}
          <div
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(249,115,22,0.28)",
              borderRadius: 20,
              padding: "20px 24px",
              boxSizing: "border-box",
              backdropFilter: "blur(12px)",
            }}
          >
            {/* Label */}
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "rgba(249,115,22,0.55)",
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              🎵 NOW PLAYING
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {/* Album art */}
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 12,
                  overflow: "hidden",
                  flexShrink: 0,
                  background: "#1a0500",
                  border: "1px solid rgba(249,115,22,0.2)",
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
                  <span style={{ fontSize: 32 }}>🪔</span>
                )}
              </div>

              {/* Song info */}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#fff",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: 1.3,
                  }}
                >
                  {songTitle || "Chhath Geet"}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "rgba(249,115,22,0.6)",
                    marginTop: 4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {songArtist || "Various Artists"}
                </div>
              </div>
            </div>
          </div>

          {/* Listener count */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 32,
            }}
          >
            {/* Green dot */}
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#4ade80",
                boxShadow: "0 0 8px rgba(74,222,128,0.7)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 22,
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
                fontSize: 15,
                color: "rgba(255,255,255,0.55)",
                fontWeight: 500,
              }}
            >
              people listening right now
            </span>
          </div>

          {/* URL pill */}
          <div
            style={{
              marginTop: 28,
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(249,115,22,0.10)",
              border: "1px solid rgba(249,115,22,0.25)",
              borderRadius: 100,
              padding: "10px 22px",
            }}
          >
            {/* Play triangle */}
            <div
              style={{
                width: 0,
                height: 0,
                borderStyle: "solid",
                borderWidth: "6px 0 6px 10px",
                borderColor: "transparent transparent transparent #f97316",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "rgba(249,115,22,0.85)",
                letterSpacing: "0.02em",
              }}
            >
              {siteUrl.replace(/^https?:\/\//, "")}
            </span>
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* QR code section */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.35)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Scan to listen live
            </div>
            <div
              style={{
                background: "#fff",
                borderRadius: 12,
                padding: 10,
                display: "inline-flex",
              }}
            >
              <QRCodeSVG
                value={siteUrl}
                size={96}
                bgColor="#ffffff"
                fgColor="#0d0505"
                level="M"
              />
            </div>
          </div>

          {/* Bottom brand strip */}
          <div
            style={{
              marginTop: 24,
              fontSize: 11,
              color: "rgba(249,115,22,0.35)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            chhathradio.com · Made with 🪔
          </div>
        </div>
      </div>
    );
  }
);