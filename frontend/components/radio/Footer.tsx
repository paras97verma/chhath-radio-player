"use client";

import { useState, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMIZATION — edit these values to personalise the footer
// ─────────────────────────────────────────────────────────────────────────────

export const FOOTER_CONFIG = {
  /** Your name shown in the "Made with 🪔" line */
  creatorName: "peivee",

  /** Social profile URLs */
  linkedinUrl: "https://linkedin.com/in/peivee",
  instagramUrl: "https://instagram.com/paras0397",

  /**
   * Payment provider configuration.
   *
   * Switch `provider` to change the payment method without touching UI code:
   *   "upi"      — shows a UPI deep-link + ID (no API key needed)
   *   "razorpay" — opens Razorpay checkout (requires razorpay.js + key)
   *   "none"     — hides the donate button entirely
   */
  payment: {
    provider: "upi" as "upi" | "razorpay" | "none",

    upi: {
      id: "peivee@ybl",
      /** Display name sent to the UPI app */
      payeeName: "Paras Verma",
      note: "Chhathi Maiya ki seva mein ek chota sa yogdaan 🙏",
    },

    razorpay: {
      /** Razorpay Key ID (starts with rzp_live_ or rzp_test_) */
      keyId: "",
      /**
       * Donation amount in WHOLE currency units — set what feels right:
       *   ₹100  →  amountInMajorUnit: 100,  currency: "INR"
       *   $5    →  amountInMajorUnit: 5,    currency: "USD"
       *   €10   →  amountInMajorUnit: 10,   currency: "EUR"
       *
       * The code converts this to the minor unit (paise / cents) automatically
       * before passing it to Razorpay — you never need to think in paise.
       */
      amountInMajorUnit: 100,
      /** ISO 4217 currency code */
      currency: "INR",
      name: "Chhath Radio 🪔",
      /**
       * Shown inside the Razorpay checkout modal.
       * Bhakti-themed so donors feel the purpose of their contribution.
       */
      description:
        "🪔 Ye radio free hai, par server free nahi! Chhathi Maiya ki kripa se ye geet bajte rahe — aapka ek chota sa yogdaan bahut bada fark karta hai. Jai Chhathi Maiya! 🙏",
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Security: UPI ID allowlist
//
// The UPI deep-link is built ONLY from the compile-time constant above.
// This allowlist is a defence-in-depth guard: if FOOTER_CONFIG.payment.upi.id
// is ever accidentally changed to something unexpected (e.g. via a bad merge),
// buildUpiLink() will throw at runtime rather than silently send money elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

/** The one and only UPI VPA that this app is allowed to use. */
const ALLOWED_UPI_ID = "peivee@ybl" as const;

/** Regex: VPA must be <localpart>@<handle> with no whitespace or special chars */
const UPI_VPA_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — currency conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Currencies that use 0 decimal places (no minor unit).
 * All others are assumed to use 2 decimal places (×100).
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW",
  "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

/**
 * Convert a human-readable major-unit amount to the minor unit required by
 * payment gateways (Razorpay, Stripe, etc.).
 *
 * Examples:
 *   toMinorUnit(100, "INR") → 10000  (₹100 = 10000 paise)
 *   toMinorUnit(5,   "USD") → 500    ($5   = 500 cents)
 *   toMinorUnit(500, "JPY") → 500    (¥500 = 500 yen, no minor unit)
 */
export function toMinorUnit(amount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) return Math.round(amount);
  return Math.round(amount * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PaymentProvider = typeof FOOTER_CONFIG.payment.provider;

/** Shape of a UPI payment config — kept loose so tests can pass arbitrary values */
export interface UpiConfig {
  id: string;
  payeeName: string;
  note: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a UPI deep-link URI from config.
 *
 * Security guarantees:
 *  1. The UPI ID is validated against UPI_VPA_REGEX (no injection chars).
 *  2. The ID is checked against ALLOWED_UPI_ID — any other value throws.
 *  3. All params are passed through URLSearchParams (automatic percent-encoding).
 *  4. The payeeName and note are truncated to safe lengths.
 *
 * @throws {Error} if the UPI ID is not the authorised value.
 */
export function buildUpiLink(cfg: UpiConfig): string {
  // 1. Format validation
  if (!UPI_VPA_REGEX.test(cfg.id)) {
    throw new Error(`Invalid UPI VPA format: "${cfg.id}"`);
  }
  // 2. Allowlist check — only our own UPI ID is permitted
  if (cfg.id !== ALLOWED_UPI_ID) {
    throw new Error(
      `Unauthorised UPI ID. Only "${ALLOWED_UPI_ID}" is allowed.`
    );
  }
  // 3. Sanitise free-text fields (truncate; URLSearchParams handles encoding)
  const safeName = cfg.payeeName.slice(0, 50).replace(/[<>"']/g, "");
  const safeNote = cfg.note.slice(0, 100).replace(/[<>"']/g, "");

  const params = new URLSearchParams({
    pa: ALLOWED_UPI_ID, // always use the constant, never cfg.id after this point
    pn: safeName,
    cu: "INR",
    tn: safeNote,
  });
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

// ─────────────────────────────────────────────────────────────────────────────
// UPI Donate Modal
// ─────────────────────────────────────────────────────────────────────────────

/** Download a UPI card image: QR code + UPI ID + branding, drawn on canvas */
async function downloadUpiCard(upiLink: string, upiId: string, payeeName: string): Promise<void> {
  const W = 400, H = 520;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#1a0800");
  grad.addColorStop(0.6, "#2d1200");
  grad.addColorStop(1, "#1a0800");
  ctx.fillStyle = grad;
  ctx.roundRect(0, 0, W, H, 24);
  ctx.fill();

  // Orange border
  ctx.strokeStyle = "rgba(249,115,22,0.45)";
  ctx.lineWidth = 1.5;
  ctx.roundRect(1, 1, W - 2, H - 2, 23);
  ctx.stroke();

  // Diya emoji header
  ctx.font = "40px serif";
  ctx.textAlign = "center";
  ctx.fillText("🪔", W / 2, 64);

  // Title
  ctx.fillStyle = "#fb923c";
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.fillText("Chhath Radio", W / 2, 104);

  // Subtitle
  ctx.fillStyle = "rgba(253,186,116,0.65)";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText("Scan to donate via UPI", W / 2, 128);

  // QR code image
  const qrSize = 180;
  const qrX = (W - qrSize) / 2;
  const qrY = 148;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize * 2}x${qrSize * 2}&data=${encodeURIComponent(upiLink)}&bgcolor=ffffff&color=111111&margin=6`;

  await new Promise<void>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // White rounded rect behind QR
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

  // UPI ID box
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

  // Payee name
  ctx.fillStyle = "rgba(253,186,116,0.40)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(payeeName, W / 2, boxY + 88);

  // Footer note
  ctx.fillStyle = "rgba(253,186,116,0.28)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText("GPay · PhonePe · Paytm · koi bhi UPI app 🙏", W / 2, H - 20);

  // Trigger download
  const link = document.createElement("a");
  link.download = "chhath-radio-donate.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export function UpiDonateModal({ onClose }: { onClose: () => void }) {
  const { upi } = FOOTER_CONFIG.payment;
  const upiLink = buildUpiLink(upi);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      await downloadUpiCard(upiLink, upi.id, upi.payeeName);
    } finally {
      setDownloading(false);
    }
  }, [upiLink, upi.id, upi.payeeName]);

  return (
    <div
      data-testid="donate-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative rounded-2xl p-6 max-w-xs w-full mx-4 text-center shadow-2xl"
        style={{
          background: "linear-gradient(160deg, #1a0800 0%, #2d1200 60%, #1a0800 100%)",
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

        <p className="text-2xl mb-2">🪔</p>
        <h2 className="text-orange-400 font-bold text-lg mb-1">
          Jai Chhathi Maiya! 🙏
        </h2>
        <p className="text-orange-200/70 text-xs mb-1 leading-relaxed">
          Ye radio free hai — par server free nahi!
        </p>
        <p className="text-orange-200/45 text-xs mb-4 leading-relaxed">
          Aapka ek chota sa yogdaan is ghat ko roshan rakhta hai.
          Chhathi Maiya ki kripa se ye geet bajte rahe 🎵
        </p>

        {/* QR Code — with circular download icon overlay (same style as ShareModal) */}
        <div className="flex justify-center mb-3">
          <div className="relative">
            <div className="rounded-xl overflow-hidden border border-orange-500/25 p-2 bg-white">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=148x148&data=${encodeURIComponent(upiLink)}&bgcolor=ffffff&color=111111&margin=4`}
                alt="Scan to pay via UPI"
                width={148}
                height={148}
                className="block"
              />
            </div>

            {/* Circular download icon — same style as ShareModal */}
            <button
              onClick={handleDownload}
              aria-label="Download UPI QR card"
              title="Download UPI card"
              disabled={downloading}
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
                border: "none",
                cursor: downloading ? "wait" : "pointer",
                boxShadow: "0 4px 16px rgba(249,115,22,0.45), 0 0 0 2px rgba(249,115,22,0.2)",
                transition: "opacity 0.15s, transform 0.15s",
                zIndex: 10,
                opacity: downloading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => { if (!downloading) { e.currentTarget.style.opacity = "0.88"; e.currentTarget.style.transform = "scale(1.08)"; } }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = downloading ? "0.7" : "1"; e.currentTarget.style.transform = "scale(1)"; }}
            >
              {downloading ? (
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }} className="animate-spin">
                  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".3"/>
                  <path d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8z"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* UPI ID display */}
        <div
          className="rounded-xl px-4 py-3 mb-4 mt-6"
          style={{
            background: "rgba(249,115,22,0.08)",
            border: "1px solid rgba(249,115,22,0.22)",
          }}
        >
          <p className="text-orange-300/55 text-xs mb-1">UPI ID</p>
          <p
            data-testid="upi-id"
            className="text-orange-300 font-mono font-semibold tracking-wide select-all"
          >
            {upi.id}
          </p>
        </div>

        {/* Open in UPI app */}
        <a
          href={upiLink}
          data-testid="upi-deep-link"
          className="block w-full bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl py-2.5 text-sm transition-colors mb-3"
        >
          🪔 Donate — UPI se
        </a>

        <p className="text-orange-200/30 text-xs">
          GPay, PhonePe, Paytm — koi bhi UPI app chalega 🙏
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Donate Button — switches behaviour based on FOOTER_CONFIG.payment.provider
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

      {/* Payment modal — rendered based on active provider */}
      {showDonate && payment.provider === "upi" && (
        <UpiDonateModal onClose={() => setShowDonate(false)} />
      )}

      {/*
        To add Razorpay: import RazorpayModal and render it here when
        payment.provider === "razorpay". The DonateButton already calls
        setShowDonate(true) regardless of provider.
      */}
    </>
  );
}
