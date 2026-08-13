"use client";

/**
 * KeyboardHelpButton — Neumorphic "?" button that shows keyboard shortcuts.
 *
 * Shortcuts:
 *   Space     — Play / Pause
 *   →         — Seek +10s
 *   ←         — Seek −10s
 *   Shift+→   — Next song
 *   Shift+←   — Previous song
 *   M         — Mute / Unmute
 *   P         — Toggle playlist
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

const NM_BTN = "4px 4px 10px rgba(0,0,0,0.65), -2px -2px 6px rgba(60,30,10,0.28)";
const NM_BTN_PRESSED = "inset 3px 3px 8px rgba(0,0,0,0.60), inset -1px -1px 4px rgba(60,30,10,0.20)";
const NM_POPOVER = "8px 8px 22px rgba(0,0,0,0.75), -4px -4px 14px rgba(60,30,10,0.28), inset 0 1px 0 rgba(255,255,255,0.04)";
const NM_KBD = "2px 2px 6px rgba(0,0,0,0.60), -1px -1px 3px rgba(60,30,10,0.22), inset 0 1px 0 rgba(255,255,255,0.04)";

export default function KeyboardHelpButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") { setOpen(false); return; }
      if (e instanceof MouseEvent && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative z-[25]">
      {/* "?" button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        title="Keyboard shortcuts"
        className="w-7 h-7 rounded-full flex items-center justify-center
                   text-[13px] font-bold cursor-pointer border-none
                   transition-all duration-150"
        style={{
          background: "rgba(15,8,4,0.88)",
          boxShadow: open ? NM_BTN_PRESSED : NM_BTN,
          color: open ? "#fb923c" : "rgba(255,255,255,0.45)",
        }}
      >
        ?
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute bottom-[calc(100%+10px)] left-0 w-60 rounded-2xl py-3 overflow-hidden"
          style={{ background: "rgba(12,5,2,0.97)", boxShadow: NM_POPOVER }}
          role="dialog"
          aria-label="Keyboard shortcuts"
        >
          {/* Header */}
          <div className="px-3.5 pb-2 border-b border-white/6 mb-1.5">
            <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-orange-500/65">
              ⌨️ Keyboard Shortcuts
            </span>
          </div>

          {/* Shortcut rows */}
          {SHORTCUTS.map(({ keys, label }) => (
            <div key={label} className="flex items-center justify-between px-3.5 py-1.5 gap-2">
              <span className="text-[11px] text-white/55 flex-1">{label}</span>
              <div className="flex gap-1 shrink-0">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex items-center justify-center h-5 px-1.5 rounded
                               text-orange-500/85 text-[10px] font-mono font-semibold tracking-wide"
                    style={{
                      minWidth: k === "Space" ? 44 : k.length > 1 ? 36 : 22,
                      background: "rgba(15,8,4,0.88)",
                      boxShadow: NM_KBD,
                    }}
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}

          {/* Footer */}
          <div className="px-3.5 pt-2 border-t border-white/6 mt-1.5">
            <span className="text-[10px] text-white/25">
              Shortcuts work when not typing in a field
            </span>
          </div>
        </div>
      )}
    </div>
  );
}