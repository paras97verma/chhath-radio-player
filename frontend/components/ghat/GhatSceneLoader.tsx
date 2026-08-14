"use client";

/**
 * GhatSceneLoader — Static Chhath Ghat background image with Ken Burns animation.
 *
 * Replaces the previous Three.js / React Three Fiber 3D scene.
 * Renders a fixed full-viewport layer behind all UI (z-index: 0).
 *
 * Performance: `will-change: transform` promotes the element to its own
 * compositor layer, preventing repaints during the Ken Burns animation.
 */

export default function GhatSceneLoader() {
  return (
    <div
      className="fixed inset-0 z-0"
      aria-hidden="true"
      style={{
        backgroundImage: "url('/ghat-bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        animation: "kenBurns 30s ease-in-out infinite alternate",
        willChange: "transform",
      }}
    >
      <style>{`
        @keyframes kenBurns {
          0%   { transform: scale(1.0) translate(0%, 0%); }
          25%  { transform: scale(1.06) translate(-1%, 0.5%); }
          50%  { transform: scale(1.04) translate(0.5%, -0.5%); }
          75%  { transform: scale(1.08) translate(-0.5%, 1%); }
          100% { transform: scale(1.05) translate(1%, -0.5%); }
        }
      `}</style>
    </div>
  );
}