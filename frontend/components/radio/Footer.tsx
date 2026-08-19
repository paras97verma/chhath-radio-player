"use client";

import { useState, useCallback, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMIZATION
// ─────────────────────────────────────────────────────────────────────────────

export const FOOTER_CONFIG = {
  /** Your name shown in the "Made with 🪔" line */
  creatorName: "peivee",

  /** Social profile URLs */
  linkedinUrl: "https://linkedin.com/in/peivee",
  instagramUrl: "https://instagram.com/paras0397",

  /**
   * Payment provider configuration
   */
  payment: {
    provider: "upi" as "upi" | "razorpay" | "none",

    upi: {
      id: "peivee@slc",
      payeeName: "Paras Verma",
      note: "Chhathi Maiya ki seva mein ek chota sa yogdaan 🙏",
    },

    razorpay: {
      keyId: "",
      amountInMajorUnit: 100,
      currency: "INR",
      name: "Chhath Radio 🪔",
      description:
        "🪔 Ye radio free hai, par server free nahi! Chhathi Maiya ki kripa se ye geet bajte rahe. Jai Chhathi Maiya! 🙏",
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Security: UPI ID allowlist
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_UPI_ID = "peivee@slc" as const;
const UPI_VPA_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/;

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW",
  "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function toMinorUnit(amount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) return Math.round(amount);
  return Math.round(amount * 100);
}

export type PaymentProvider = typeof FOOTER_CONFIG.payment.provider;

export interface UpiConfig {
  id: string;
  payeeName: string;
  note: string;
}

export function buildUpiLink(cfg: UpiConfig, scheme = "upi"): string {
  if (!UPI_VPA_REGEX.test(cfg.id)) {
    throw new Error(`Invalid UPI VPA format: "${cfg.id}"`);
  }
  const safeName = cfg.payeeName.slice(0, 50).replace(/[<>"']/g, "");
  const safeNote = cfg.note.slice(0, 100).replace(/[<>"']/g, "");

  const params = new URLSearchParams({
    pa: cfg.id,
    pn: safeName,
    cu: "INR",
    tn: safeNote,
  });

  if (scheme === "tez" || scheme === "gpay") return `tez://upi/pay?${params.toString()}`;
  if (scheme === "phonepe") return `phonepe://pay?${params.toString()}`;
  if (scheme === "paytm") return `paytmmp://pay?${params.toString()}`;
  return `upi://pay?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG Icons
// ─────────────────────────────────────────────────────────────────────────────

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

function CoffeeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path d="M18.5 3H6c-1.1 0-2 .9-2 2v5.71c0 3.83 2.95 7.18 6.78 7.29 3.96.12 7.22-3.06 7.22-7V5c0-.55-.45-1-1-1zm-1 7c0 2.76-2.24 5-5 5s-5-2.24-5-5V5h10v5zm3.5-3H19v2h2v3c0 1.1-.9 2-2 2h-1.45c-.42 1.16-1.18 2.15-2.14 2.87C16.15 18.6 17 20.19 17 22H7c0-1.81.85-3.4 2.59-4.13C8.63 17.15 7.87 16.16 7.45 15H6c-1.1 0-2-.9-2-2v-3H2V9h2V5c0-1.1.9-2 2-2h12.5c.83 0 1.5.67 1.5 1.5v3z" />
    </svg>
  );
}

// Official Authentic Vector App Icons
function GooglePayIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/gpay.svg"
      alt="Google Pay"
      width={44}
      height={44}
      className="w-11 h-11 object-contain transition-transform hover:scale-110 active:scale-95 drop-shadow-md"
    />
  );
}

function PhonePeIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/phonepe.svg"
      alt="PhonePe"
      width={44}
      height={44}
      className="w-11 h-11 object-contain transition-transform hover:scale-110 active:scale-95 drop-shadow-md"
    />
  );
}

function PaytmIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/paytm.svg"
      alt="Paytm"
      width={44}
      height={44}
      className="w-11 h-11 object-contain transition-transform hover:scale-110 active:scale-95 drop-shadow-md"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UPI Donate Modal
// ─────────────────────────────────────────────────────────────────────────────

async function downloadUpiCard(upiLink: string, upiId: string, payeeName: string): Promise<void> {
  const W = 400, H = 520;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#1a0800");
  grad.addColorStop(0.6, "#2d1200");
  grad.addColorStop(1, "#1a0800");
  ctx.fillStyle = grad;
  ctx.roundRect(0, 0, W, H, 24);
  ctx.fill();

  ctx.strokeStyle = "rgba(249,115,22,0.45)";
  ctx.lineWidth = 1.5;
  ctx.roundRect(1, 1, W - 2, H - 2, 23);
  ctx.stroke();

  ctx.font = "40px serif";
  ctx.textAlign = "center";
  ctx.fillText("🪔", W / 2, 64);

  ctx.fillStyle = "#fb923c";
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.fillText("Chhath Radio", W / 2, 104);

  ctx.fillStyle = "rgba(253,186,116,0.65)";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText("Scan to donate via UPI", W / 2, 128);

  const qrSize = 180;
  const qrX = (W - qrSize) / 2;
  const qrY = 148;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize * 2}x${qrSize * 2}&data=${encodeURIComponent(upiLink)}&bgcolor=ffffff&color=111111&margin=6`;

  await new Promise<void>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 14);
      ctx.fill();
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = qrUrl;
  });

  const boxY = qrY + qrSize + 28;
  ctx.fillStyle = "rgba(249,115,22,0.10)";
  ctx.beginPath();
  ctx.roundRect(40, boxY, W - 80, 64, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(249,115,22,0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(40, boxY, W - 80, 64, 12);
  ctx.stroke();

  ctx.fillStyle = "rgba(253,186,116,0.55)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("UPI ID", W / 2, boxY + 20);

  ctx.fillStyle = "#fb923c";
  ctx.font = "bold 16px monospace";
  ctx.fillText(upiId, W / 2, boxY + 44);

  ctx.fillStyle = "rgba(253,186,116,0.40)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(payeeName, W / 2, boxY + 88);

  ctx.fillStyle = "rgba(253,186,116,0.28)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText("GPay · PhonePe · Paytm — Jai Chhathi Maiya! 🙏", W / 2, H - 20);

  const link = document.createElement("a");
  link.download = "chhath-radio-donate.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export function UpiDonateModal({ onClose }: { onClose: () => void }) {
  const { upi } = FOOTER_CONFIG.payment;
  const upiLink = buildUpiLink(upi);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(
      typeof window !== "undefined" &&
        ("ontouchstart" in window || navigator.maxTouchPoints > 0)
    );
  }, []);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      await downloadUpiCard(upiLink, upi.id, upi.payeeName);
    } finally {
      setDownloading(false);
    }
  }, [upiLink, upi.id, upi.payeeName]);

  const handleCopyUpi = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    try {
      await navigator.clipboard.writeText(upi.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore
    }
  };

  const handleUpiClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isMobile) {
      e.preventDefault();
      handleCopyUpi();
    }
  };

  return (
    <div
      data-testid="donate-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative rounded-2xl p-6 max-w-xs w-full mx-auto text-center shadow-2xl overflow-y-auto max-h-[90vh]"
        style={{
          background: "linear-gradient(160deg, #180702 0%, #290e02 60%, #160601 100%)",
          border: "1px solid rgba(249,115,22,0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-4 text-orange-300/50 hover:text-orange-200 text-xl leading-none transition-colors"
          aria-label="Close donate modal"
        >
          ×
        </button>

        <p className="text-2xl mb-1">🪔</p>
        <h2 className="text-orange-400 font-bold text-lg mb-1">
          Jai Chhathi Maiya! 🙏
        </h2>
        <p className="text-orange-200/70 text-xs mb-1 leading-relaxed">
          Ye radio free hai — par server free nahi!
        </p>
        <p className="text-orange-200/45 text-xs mb-4 leading-relaxed">
          Aapka ek chota sa yogdaan is ghat ko roshan rakhta hai.
        </p>

        {/* QR Code */}
        <div className="flex justify-center mb-3">
          <div className="relative">
            <div className="rounded-xl overflow-hidden border border-orange-500/25 p-2 bg-white flex items-center justify-center">
              <QRCodeSVG
                value={upiLink}
                size={148}
                bgColor="#ffffff"
                fgColor="#111111"
                level="M"
                marginSize={1}
              />
            </div>

            {/* Circular download icon */}
            <button
              onClick={handleDownload}
              aria-label="Download UPI QR card"
              title="Download UPI card"
              disabled={downloading}
              style={{
                position: "absolute",
                bottom: -12,
                right: -12,
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #f97316, #ea580c)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                cursor: downloading ? "wait" : "pointer",
                boxShadow: "0 4px 16px rgba(249,115,22,0.45), 0 0 0 2px rgba(249,115,22,0.2)",
                zIndex: 10,
                opacity: downloading ? 0.7 : 1,
              }}
            >
              {downloading ? (
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }} className="animate-spin">
                  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".3"/>
                  <path d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8z"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}>
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* UPI ID box with SVG Copy Icon */}
        <div
          className="rounded-xl px-4 py-2.5 mb-4 mt-5 flex items-center justify-between gap-2"
          style={{
            background: "rgba(249,115,22,0.08)",
            border: "1px solid rgba(249,115,22,0.25)",
          }}
        >
          <div className="text-left">
            <p className="text-orange-300/55 text-[10px] uppercase tracking-wider font-semibold">UPI ID</p>
            <p
              data-testid="upi-id"
              className="text-orange-300 font-mono font-bold text-sm tracking-wide select-all"
            >
              {upi.id}
            </p>
          </div>
          {/* Copy Icon Button */}
          <button
            onClick={handleCopyUpi}
            aria-label="Copy UPI ID"
            title={copied ? "Copied!" : "Copy UPI ID"}
            className="p-2 rounded-lg text-orange-300 hover:bg-orange-500/20 transition-colors flex items-center justify-center"
          >
            {copied ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-green-400">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
              </svg>
            )}
          </button>
        </div>

        {/* Copy Feedback Toast */}
        {copied && (
          <div className="mb-3 text-xs text-green-400 font-medium bg-green-950/60 border border-green-500/30 rounded-lg p-2 animate-fade-in">
            UPI ID copied to clipboard! 🙏
          </div>
        )}

        {/* Pure Standalone Official Original App Icons (No text, no backgrounds) */}
        <div className="flex items-center justify-center gap-7 my-5">
          {/* Google Pay */}
          <a
            href={buildUpiLink(upi, "gpay")}
            data-testid="upi-deep-link"
            title="Google Pay"
            aria-label="Google Pay"
            onClick={handleUpiClick}
            className="transition-transform hover:scale-110 active:scale-95 flex items-center justify-center"
          >
            <GooglePayIcon />
          </a>

          {/* PhonePe */}
          <a
            href={buildUpiLink(upi, "phonepe")}
            title="PhonePe"
            aria-label="PhonePe"
            onClick={handleUpiClick}
            className="transition-transform hover:scale-110 active:scale-95 flex items-center justify-center"
          >
            <PhonePeIcon />
          </a>

          {/* Paytm */}
          <a
            href={buildUpiLink(upi, "paytm")}
            title="Paytm"
            aria-label="Paytm"
            onClick={handleUpiClick}
            className="transition-transform hover:scale-110 active:scale-95 flex items-center justify-center"
          >
            <PaytmIcon />
          </a>
        </div>

        <p className="text-orange-200/35 text-[11px] mt-2">
          {isMobile
            ? "Tap an app to pay or copy UPI ID 🙏"
            : "Scan QR code with phone or tap icon to copy UPI ID 🙏"}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Donate Button
// ─────────────────────────────────────────────────────────────────────────────

export function DonateButton({ onClick }: { onClick: () => void }) {
  const { provider } = FOOTER_CONFIG.payment;
  if (provider === "none") return null;

  return (
    <button
      onClick={onClick}
      data-testid="donate-button"
      className="flex items-center gap-1.5 hover:text-orange-300 transition-colors"
      aria-label="Donate"
    >
      <CoffeeIcon />
      <span>Yogdaan karein 🪔</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────

export default function Footer() {
  const [showDonate, setShowDonate] = useState(false);
  const { creatorName, linkedinUrl, instagramUrl, payment } = FOOTER_CONFIG;

  return (
    <>
      <footer data-testid="site-footer" className="text-center text-orange-200/40 text-xs mt-auto space-y-3">
        {/* Social + Donate row */}
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <a
            href={linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="linkedin-link"
            className="flex items-center gap-1.5 hover:text-orange-300 transition-colors"
            aria-label="LinkedIn"
          >
            <LinkedInIcon />
            <span>LinkedIn</span>
          </a>

          <span className="text-orange-200/20" aria-hidden="true">·</span>

          <a
            href={instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="instagram-link"
            className="flex items-center gap-1.5 hover:text-orange-300 transition-colors"
            aria-label="Instagram"
          >
            <InstagramIcon />
            <span>Instagram</span>
          </a>

          {payment.provider !== "none" && (
            <>
              <span className="text-orange-200/20" aria-hidden="true">·</span>
              <DonateButton onClick={() => setShowDonate(true)} />
            </>
          )}
        </div>

        {/* Made with diya */}
        <p data-testid="made-with-love">
          Made with 🪔 for Chhathi Maiya — by{" "}
          <a
            href={linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-orange-200/60 transition-colors underline underline-offset-2"
          >
            {creatorName}
          </a>
        </p>

      </footer>

      {/* Payment modal */}
      {showDonate && payment.provider === "upi" && (
        <UpiDonateModal onClose={() => setShowDonate(false)} />
      )}
    </>
  );
}
