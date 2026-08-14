"use client";

/**
 * ShareFloatingButton — Neumorphic 3D tab fixed to the left-center edge.
 *
 * Positioning: fixed left-0, top-1/2 -translate-y-1/2, z-30.
 * Style: orange gradient with CSS perspective + rotateY for 3D "sticking out" effect.
 * On click: opens ShareModal (lazy-loaded).
 */

import { useState } from "react";
import dynamic from "next/dynamic";

const ShareModal = dynamic(() => import("./ShareModal"), { ssr: false });

export default function ShareFloatingButton({ onOpenChange }: { onOpenChange?: (open: boolean) => void } = {}) {
  const [open, setOpen] = useState(false);

  const handleOpen = () => { setOpen(true); onOpenChange?.(true); };
  const handleClose = () => { setOpen(false); onOpenChange?.(false); };

  return (
    <>
      <div
        className="fixed left-0 top-1/2 -translate-y-1/2 z-30"
        style={{ perspective: "600px" }}
      >
        <button
          onClick={handleOpen}
          aria-label="Share Chhath Radio"
          title="Share"
          className="flex flex-col items-center justify-center gap-1.5
                     rounded-r-xl px-2.5 py-4 sm:py-5
                     text-white cursor-pointer select-none border-none
                     transition-all duration-200"
          style={{
            background: "linear-gradient(180deg, #fb923c 0%, #ea580c 100%)",
            transform: "perspective(600px) rotateY(5deg)",
            boxShadow:
              "6px 6px 20px rgba(0,0,0,0.72), -2px -2px 8px rgba(60,30,10,0.28), inset -1px 0 0 rgba(255,255,255,0.18), 0 0 32px rgba(249,115,22,0.22)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "perspective(600px) rotateY(0deg)";
            e.currentTarget.style.boxShadow =
              "8px 8px 24px rgba(0,0,0,0.75), -3px -3px 10px rgba(60,30,10,0.30), inset -1px 0 0 rgba(255,255,255,0.18), 0 0 40px rgba(249,115,22,0.40)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "perspective(600px) rotateY(5deg)";
            e.currentTarget.style.boxShadow =
              "6px 6px 20px rgba(0,0,0,0.72), -2px -2px 8px rgba(60,30,10,0.28), inset -1px 0 0 rgba(255,255,255,0.18), 0 0 32px rgba(249,115,22,0.22)";
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "perspective(600px) rotateY(2deg) scale(0.97)";
            e.currentTarget.style.boxShadow =
              "inset 3px 3px 8px rgba(0,0,0,0.55), inset -1px -1px 4px rgba(60,30,10,0.20)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "perspective(600px) rotateY(0deg)";
            e.currentTarget.style.boxShadow =
              "8px 8px 24px rgba(0,0,0,0.75), -3px -3px 10px rgba(60,30,10,0.30), inset -1px 0 0 rgba(255,255,255,0.18)";
          }}
        >
          {/* Share icon */}
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 shrink-0">
            <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
          </svg>

          {/* Vertical label */}
          <span
            className="text-[10px] font-extrabold tracking-[0.12em] uppercase leading-none"
            style={{
              writingMode: "vertical-rl",
              textOrientation: "mixed",
              transform: "rotate(180deg)",
            }}
          >
            Share
          </span>

          {/* Diya accent */}
          <span className="text-sm leading-none">🪔</span>
        </button>
      </div>

      {open && <ShareModal onClose={handleClose} />}
    </>
  );
}