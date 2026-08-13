"use client";

/**
 * KeyboardHelpButton — A small "?" button that shows a popover listing
 * all keyboard shortcuts available in the radio player.
 *
 * Shortcuts documented:
 *   Space        — Play / Pause
 *   →            — Seek +10s
 *   ←            — Seek −10s
 *   Shift+→      — Next song
 *   Shift+←      — Previous song
 *   M            — Mute / Unmute
 *   P            — Toggle playlist
 */

import { useState, useEffect, useRef } from "react";

const SHORTCUTS = [
  { keys: ["Space"], label: "Play / Pause" },
  { keys: ["→"], label: "Seek forward 10s" },
  { keys: ["←"], label: "Seek back 10s" },
  { keys: ["Shift", "→"], label: "Next song" },
  { keys: ["Shift", "←"], label: "Previous song" },
  { keys: ["M"], label: "Mute / Unmute" },
  { keys: ["P"], label: "Toggle playlist" },
];

export default function KeyboardHelpButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e instanceof MouseEvent && ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative" style={{ zIndex: 25 }}>
      {/* ? button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        title="Keyboard shortcuts"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: open ? "rgba(249,115,22,0.18)" : "rgba(255,255,255,0.07)",
          border: `1px solid ${open ? "rgba(249,115,22,0.45)" : "rgba(255,255,255,0.12)"}`,
          color: open ? "#f97316" : "rgba(255,255,255,0.45)",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.15s",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          if (!open) {
            e.currentTarget.style.background = "rgba(249,115,22,0.12)";
            e.currentTarget.style.color = "rgba(249,115,22,0.8)";
            e.currentTarget.style.borderColor = "rgba(249,115,22,0.3)";
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = "rgba(255,255,255,0.07)";
            e.currentTarget.style.color = "rgba(255,255,255,0.45)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
          }
        }}
      >
        ?
      </button>

      {/* Popover */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            right: 0,
            width: 240,
            background: "rgba(10,4,2,0.97)",
            border: "1px solid rgba(249,115,22,0.22)",
            borderRadius: 14,
            padding: "12px 0 10px",
            boxShadow: "0 16px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(249,115,22,0.06)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
          }}
          role="dialog"
          aria-label="Keyboard shortcuts"
        >
          {/* Header */}
          <div
            style={{
              padding: "0 14px 8px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(249,115,22,0.65)",
              }}
            >
              ⌨️ Keyboard Shortcuts
            </span>
          </div>

          {/* Shortcut rows */}
          {SHORTCUTS.map(({ keys, label }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "5px 14px",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", flex: 1 }}>
                {label}
              </span>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {keys.map((k) => (
                  <kbd
                    key={k}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: k === "Space" ? 44 : k.length > 1 ? 36 : 22,
                      height: 20,
                      padding: "0 5px",
                      borderRadius: 5,
                      background: "rgba(255,255,255,0.07)",
                      border: "1px solid rgba(255,255,255,0.14)",
                      color: "rgba(249,115,22,0.85)",
                      fontSize: 10,
                      fontFamily: "monospace",
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}

          {/* Footer note */}
          <div
            style={{
              padding: "8px 14px 0",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              marginTop: 6,
            }}
          >
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
              Shortcuts work when not typing in a field
            </span>
          </div>
        </div>
      )}
    </div>
  );
}