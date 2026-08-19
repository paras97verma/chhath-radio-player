"use client";

/**
 * ShareModal — Minimal & instant share modal:
 *  1. Displays the <ShareCard> live & instantly on the first open (no 1st-try canvas failure or delays).
 *  2. Download button captures high-res PNG on demand.
 *  3. Social Share buttons for WhatsApp, Telegram, Twitter/X, and Copy Link.
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
  typeof window !== "undefined" ? window.location.origin : "https://chhath-radio-ten.vercel.app";

function getShareTargets(url: string, text: string) {
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
      href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent("🪔 Chhath Radio — छठ के गीत, बिना रुके")}`,
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

  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);

  const siteUrl = SITE_URL;
  const songTitle = currentSong?.title ?? "Chhath Geet";
  const songArtist = currentSong?.artist ?? "Various Artists";
  const albumArtUrl = currentSong?.youtube_video_id
    ? `/yt-thumb?v=${currentSong.youtube_video_id}`
    : null;

  useEffect(() => {
    fetchListenerCount()
      .then(setListenerCount)
      .catch(() => setListenerCount(0));
  }, []);

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

  const handleDownload = async () => {
    if (!cardRef.current || downloading) return;
    setDownloading(true);
    try {
      // Ensure inner images are complete
      const images = Array.from(cardRef.current.querySelectorAll("img"));
      await Promise.all(
        images.map(
          (img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                })
        )
      );
      await new Promise((r) => setTimeout(r, 60));

      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
      });

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "chhath-radio-share.png";
      a.click();
    } catch (e) {
      console.error("[ShareModal] download failed:", e);
    } finally {
      setDownloading(false);
    }
  };

  const shareTargets = getShareTargets(
    siteUrl,
    "🪔 Chhath Radio — छठ के गीत, बिना रुके. Listen live:"
  );

  return (
    <>
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
            boxShadow: "0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(249,115,22,0.08)",
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
                color: "rgba(249,115,22,0.7)",
                marginBottom: 2,
              }}
            >
              Share Chhath Radio
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
              Share the devotional vibe 🪔
            </div>
          </div>

          {/* Live minimal card render box */}
          <div
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              transform: "scale(0.72)",
              transformOrigin: "top center",
              marginBottom: -160, // compensate for scale transformation
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

          {/* Action buttons */}
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            {/* Download Button */}
            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 14,
                background: "linear-gradient(135deg, #f97316, #ea580c)",
                border: "none",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                cursor: downloading ? "wait" : "pointer",
                boxShadow: "0 4px 16px rgba(249,115,22,0.35)",
                opacity: downloading ? 0.75 : 1,
              }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
              </svg>
              {downloading ? "Downloading Card…" : "Download Card Image"}
            </button>

            {/* Divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "rgba(255,255,255,0.25)",
                fontSize: 11,
              }}
            >
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
              or share directly
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