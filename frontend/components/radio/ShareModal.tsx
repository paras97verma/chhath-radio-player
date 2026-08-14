"use client";

/**
 * ShareModal — Full-screen modal that:
 *  1. Renders <ShareCard> off-screen (for html-to-image capture)
 *  2. Captures it as a PNG via toPng()
 *  3. Shows the captured image as a preview
 *  4. Provides Download / Web Share / WhatsApp / Telegram / Twitter / Copy Link actions
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { toPng } from "html-to-image";
import { ShareCard } from "./ShareCard";
import { useRadioStore } from "@/lib/radio-store";
import { fetchListenerCount } from "@/lib/api";

interface ShareModalProps {
  onClose: () => void;
}

const SITE_URL =
  typeof window !== "undefined" ? window.location.href : "https://chhathradio.com";

function getShareTargets(url: string, text: string) {
  const encoded = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text + " " + url);
  return [
    {
      id: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/?text=${encodedText}`,
      color: "#25D366",
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      ),
    },
    {
      id: "telegram",
      label: "Telegram",
      href: `https://t.me/share/url?url=${encoded}&text=${encodeURIComponent("🪔 Chhath Radio — छठ के गीत, बिना रुके")}`,
      color: "#2AABEE",
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      ),
    },
    {
      id: "twitter",
      label: "Twitter / X",
      href: `https://twitter.com/intent/tweet?text=${encodedText}`,
      color: "#1DA1F2",
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
    },
  ];
}

export default function ShareModal({ onClose }: ShareModalProps) {
  const currentSong = useRadioStore((s) => s.currentSong());
  const cardRef = useRef<HTMLDivElement>(null);

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);

  const siteUrl = SITE_URL;
  const songTitle = currentSong?.title ?? "Chhath Geet";
  const songArtist = currentSong?.artist ?? "Various Artists";
  // Use the /yt-thumb proxy so the image is served from the same origin.
  // This prevents CORS canvas taint when html-to-image captures the ShareCard.
  const albumArtUrl = currentSong?.youtube_video_id
    ? `/yt-thumb?v=${currentSong.youtube_video_id}`
    : null;

  // Fetch listener count once on open
  useEffect(() => {
    fetchListenerCount()
      .then(setListenerCount)
      .catch(() => setListenerCount(0));
  }, []);

  // Capture the card after it's mounted and listener count is ready
  const capture = useCallback(async () => {
    if (!cardRef.current) return;
    setGenerating(true);
    setError(false);
    try {
      // Give the DOM time to fully render the card (fonts, images, layout)
      await new Promise((r) => setTimeout(r, 300));
      const png = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        // Ensure same-origin images are included; cross-origin ones are already
        // proxied through /yt-thumb so this is just a safety net
        includeQueryParams: true,
      });
      setDataUrl(png);
    } catch (e) {
      console.error("[ShareModal] toPng failed:", e);
      setError(true);
    } finally {
      setGenerating(false);
    }
  }, []);

  useEffect(() => {
    capture();
  }, [capture]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(siteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleNativeShare = async () => {
    if (!dataUrl) return;
    try {
      // Convert dataUrl to Blob → File for Web Share API
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], "chhath-radio.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: "Chhath Radio — छठ के गीत, बिना रुके",
          text: "🪔 Listen live:",
          url: siteUrl,
          files: [file],
        });
        return;
      }
      // Fallback: share without file
      await navigator.share({
        title: "Chhath Radio — छठ के गीत, बिना रुके",
        text: "🪔 Chhath Radio — छठ के गीत, बिना रुके. Listen live: " + siteUrl,
        url: siteUrl,
      });
    } catch {
      // User cancelled or not supported — do nothing
    }
  };

  const shareTargets = getShareTargets(
    siteUrl,
    "🪔 Chhath Radio — छठ के गीत, बिना रुके. Listen live:"
  );

  return (
    <>
      {/* ── Hidden off-screen ShareCard for capture ── */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: -9999,
          top: -9999,
          pointerEvents: "none",
          zIndex: -1,
        }}
      >
        <ShareCard
          ref={cardRef}
          songTitle={songTitle}
          songArtist={songArtist}
          albumArtUrl={albumArtUrl}
          listenerCount={listenerCount}
          siteUrl={siteUrl}
        />
      </div>

      {/* ── Backdrop ── */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          background: "rgba(5,1,1,0.85)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
        }}
      >
        {/* ── Modal panel ── */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "relative",
            background: "rgba(14,5,2,0.98)",
            border: "1px solid rgba(249,115,22,0.25)",
            borderRadius: 24,
            padding: "20px 16px 16px",
            width: "100%",
            maxWidth: 380,
            maxHeight: "90vh",
            overflowY: "auto",
            boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(249,115,22,0.08)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
          }}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(249,115,22,0.15)";
              e.currentTarget.style.color = "#f97316";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.color = "rgba(255,255,255,0.5)";
            }}
          >
            ×
          </button>

          {/* Header */}
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(249,115,22,0.6)",
                marginBottom: 4,
              }}
            >
              Share Chhath Radio
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
              Share the vibe with your people 🪔
            </div>
          </div>

          {/* Card preview area — fixed height container, image scales to fit */}
          <div
            style={{
              width: "100%",
              height: 420,
              borderRadius: 16,
              overflow: "visible",
              border: "1px solid rgba(249,115,22,0.15)",
              background: "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            {generating && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                  padding: 32,
                }}
              >
                {/* Spinner */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "3px solid rgba(249,115,22,0.15)",
                    borderTopColor: "#f97316",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                <span style={{ fontSize: 12, color: "rgba(249,115,22,0.5)" }}>
                  Generating card…
                </span>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {error && !generating && (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 13,
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
                Could not generate card.
                <br />
                <button
                  onClick={capture}
                  style={{
                    marginTop: 10,
                    padding: "6px 16px",
                    borderRadius: 8,
                    background: "rgba(249,115,22,0.15)",
                    border: "1px solid rgba(249,115,22,0.3)",
                    color: "#f97316",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
              </div>
            )}

            {dataUrl && !generating && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={dataUrl}
                alt="Share card preview"
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  width: "auto",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                  borderRadius: 12,
                }}
              />
            )}

            {/* Circular download icon — bottom-right edge of preview */}
            {dataUrl && (
              <a
                href={dataUrl}
                download="chhath-radio-share.png"
                aria-label="Download share card"
                title="Download"
                style={{
                  position: "absolute",
                  bottom: -16,
                  right: -16,
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #f97316, #ea580c)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                  boxShadow: "0 4px 16px rgba(249,115,22,0.45), 0 0 0 2px rgba(249,115,22,0.2)",
                  transition: "opacity 0.15s, transform 0.15s",
                  zIndex: 10,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.88"; e.currentTarget.style.transform = "scale(1.08)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "scale(1)"; }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                </svg>
              </a>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "rgba(255,255,255,0.2)",
                fontSize: 11,
              }}
            >
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
              or share via
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
            </div>

            {/* Social links row */}
            <div style={{ display: "flex", gap: 8 }}>
              {shareTargets.map((t) => (
                <a
                  key={t.id}
                  href={t.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t.label}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "10px 0",
                    borderRadius: 12,
                    background: t.color + "18",
                    border: `1px solid ${t.color}33`,
                    color: t.color,
                    textDecoration: "none",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = t.color + "30";
                    e.currentTarget.style.borderColor = t.color + "66";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = t.color + "18";
                    e.currentTarget.style.borderColor = t.color + "33";
                  }}
                >
                  {t.icon}
                </a>
              ))}

              {/* Copy link */}
              <button
                onClick={handleCopy}
                title="Copy link"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "10px 0",
                  borderRadius: 12,
                  background: copied ? "rgba(74,222,128,0.15)" : "rgba(249,115,22,0.12)",
                  border: copied
                    ? "1px solid rgba(74,222,128,0.4)"
                    : "1px solid rgba(249,115,22,0.25)",
                  color: copied ? "#4ade80" : "#f97316",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {copied ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
                    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}