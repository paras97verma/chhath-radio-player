"use client";

/**
 * ShareFloatingButton — A 3D pill/tab button fixed to the right-center edge of the viewport.
 *
 * Positioning: fixed right-0, vertically centered (top-1/2 -translate-y-1/2), z-30.
 * Style: orange gradient with CSS perspective + rotateY for a 3D "sticking out" effect.
 * On click: opens ShareModal.
 */

import { useState } from "react";
import dynamic from "next/dynamic";

// Lazy-load the modal so html-to-image is not in the initial bundle
const ShareModal = dynamic(() => import("./ShareModal"), { ssr: false });

export default function ShareFloatingButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* ── 3D floating tab button ── */}
      <div
        style={{
          position: "fixed",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 30,
          // Perspective container so the child rotateY looks 3D
          perspective: "600px",
        }}
      >
        <button
          onClick={() => setOpen(true)}
          aria-label="Share Chhath Radio"
          title="Share"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            // Tab shape: rounded on the left, flush on the right
            borderRadius: "12px 0 0 12px",
            padding: "18px 10px",
            background: "linear-gradient(160deg, #fb923c 0%, #f97316 45%, #ea580c 100%)",
            border: "none",
            cursor: "pointer",
            color: "#fff",
            // 3D depth: slight inward tilt + layered shadow
            transform: "perspective(600px) rotateY(-8deg)",
            boxShadow:
              "-4px 4px 20px rgba(249,115,22,0.55), -2px 2px 0 #c2410c, inset 1px 0 0 rgba(255,255,255,0.15)",
            transition: "transform 0.2s ease, box-shadow 0.2s ease",
            // Prevent text selection on rapid clicks
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "perspective(600px) rotateY(0deg)";
            e.currentTarget.style.boxShadow =
              "-6px 6px 28px rgba(249,115,22,0.7), -3px 3px 0 #c2410c, inset 1px 0 0 rgba(255,255,255,0.2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "perspective(600px) rotateY(-8deg)";
            e.currentTarget.style.boxShadow =
              "-4px 4px 20px rgba(249,115,22,0.55), -2px 2px 0 #c2410c, inset 1px 0 0 rgba(255,255,255,0.15)";
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "perspective(600px) rotateY(-4deg) scale(0.97)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "perspective(600px) rotateY(0deg)";
          }}
        >
          {/* Share icon */}
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ width: 18, height: 18, flexShrink: 0 }}
          >
            <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
          </svg>

          {/* Vertical label */}
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              writingMode: "vertical-rl",
              textOrientation: "mixed",
              // Rotate so text reads bottom-to-top
              transform: "rotate(180deg)",
              lineHeight: 1,
              opacity: 0.92,
            }}
          >
            Share
          </span>

          {/* Diya accent */}
          <span style={{ fontSize: 14, lineHeight: 1 }}>🪔</span>
        </button>
      </div>

      {/* ── Modal (lazy-loaded) ── */}
      {open && <ShareModal onClose={() => setOpen(false)} />}
    </>
  );
}