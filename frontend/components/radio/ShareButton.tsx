"use client";

/**
 * ShareButton — share the Chhath Radio URL across apps.
 *
 * On mobile: triggers the native Web Share API sheet (covers all installed apps).
 * On desktop: shows a popover with WhatsApp, Telegram, Twitter/X, and Copy Link.
 *
 * The share text is: "🪔 Chhath Radio — छठ के गीत, बिना रुके. Listen live:"
 */

import { useEffect, useRef, useState } from "react";

const SHARE_URL = typeof window !== "undefined" ? window.location.href : "https://chhathradio.com";
const SHARE_TITLE = "Chhath Radio — छठ के गीत, बिना रुके";
const SHARE_TEXT = "🪔 Chhath Radio — छठ के गीत, बिना रुके. Listen live:";

// ─── Share targets ────────────────────────────────────────────────────────────

function getShareTargets(url: string, text: string) {
  const encoded = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text + " " + url);
  return [
    {
      id: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/?text=${encodedText}`,
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      ),
      color: "#25D366",
    },
    {
      id: "telegram",
      label: "Telegram",
      href: `https://t.me/share/url?url=${encoded}&text=${encodeURIComponent(text)}`,
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      ),
      color: "#2AABEE",
    },
    {
      id: "twitter",
      label: "Twitter / X",
      href: `https://twitter.com/intent/tweet?text=${encodedText}`,
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
      color: "#1DA1F2",
    },
    {
      id: "copy",
      label: "Copy Link",
      href: null,
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
        </svg>
      ),
      color: "#f97316",
    },
  ];
}

// ─── Share icon ───────────────────────────────────────────────────────────────

function IconShare() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
    </svg>
  );
}

// ─── ShareButton ──────────────────────────────────────────────────────────────

export default function ShareButton() {
  const [showPopover, setShowPopover] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!showPopover) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setShowPopover(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPopover]);

  const url = typeof window !== "undefined" ? window.location.href : "https://chhathradio.com";
  const targets = getShareTargets(url, SHARE_TEXT);

  const handleShare = async () => {
    // Try native Web Share API first (mobile)
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url });
        return;
      } catch {
        // User cancelled or API failed — fall through to popover
      }
    }
    // Desktop: toggle popover
    setShowPopover((v) => !v);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text
    }
  };

  return (
    <div className="relative">
      {/* Popover */}
      {showPopover && (
        <div
          ref={popoverRef}
          className="absolute bottom-full right-0 mb-2 z-50"
          style={{
            background: "rgba(14, 5, 2, 0.97)",
            border: "1px solid rgba(249, 115, 22, 0.2)",
            backdropFilter: "blur(16px)",
            borderRadius: "16px",
            padding: "12px",
            minWidth: "180px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          <p
            className="text-orange-400/70 text-xs font-semibold mb-2 px-1"
            style={{ letterSpacing: "0.05em" }}
          >
            Share Chhath Radio
          </p>
          <div className="flex flex-col gap-1">
            {targets.map((t) =>
              t.href ? (
                <a
                  key={t.id}
                  href={t.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowPopover(false)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-white/80 hover:text-white transition-all text-sm"
                  style={{ "--hover-bg": t.color + "22" } as React.CSSProperties}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = t.color + "22")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ color: t.color }}>{t.icon}</span>
                  {t.label}
                </a>
              ) : (
                <button
                  key={t.id}
                  onClick={handleCopy}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-white/80 hover:text-white transition-all text-sm w-full text-left"
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(249,115,22,0.13)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ color: t.color }}>{t.icon}</span>
                  {copied ? (
                    <span className="text-green-400 font-semibold">Copied!</span>
                  ) : (
                    t.label
                  )}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Share button */}
      <button
        ref={buttonRef}
        onClick={handleShare}
        aria-label="Share Chhath Radio"
        title="Share"
        className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${
          showPopover
            ? "text-orange-400 bg-orange-500/15"
            : "text-white/60 hover:text-orange-400 hover:bg-white/10"
        }`}
      >
        <IconShare />
      </button>
    </div>
  );
