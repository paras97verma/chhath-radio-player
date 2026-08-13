"use client";

/**
 * GhatSceneLoader — Client Component wrapper for GhatScene.
 *
 * Responsibilities:
 *   1. WebGL availability check — renders static fallback if unavailable
 *   2. Loading screen ("🪔 Preparing the Ghat...") while Three.js initialises
 *   3. Smooth fade-in transition (800ms) once scene is ready
 *   4. Threads audioNode prop into GhatScene for music reactivity
 *
 * Uses dynamic import with ssr:false (required for Three.js / WebGL).
 * Renders as a fixed full-viewport layer behind all UI (z-index: 0).
 */

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";

// ─── WebGL detection ──────────────────────────────────────────────────────────

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// ─── Dynamic import (ssr:false required for Three.js) ────────────────────────

const GhatScene = dynamic(
  () => import("./GhatScene"),
  {
    ssr: false,
    loading: () => null, // loading UI handled by GhatSceneLoader itself
  }
);

// ─── Props ────────────────────────────────────────────────────────────────────

interface GhatSceneLoaderProps {
  audioNode?: AudioNode | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GhatSceneLoader({ audioNode = null }: GhatSceneLoaderProps) {
  const [webGLAvailable, setWebGLAvailable] = useState<boolean | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setWebGLAvailable(isWebGLAvailable());
  }, []);

  const handleSceneReady = useCallback(() => {
    // Small delay so the scene has a frame to render before fading in
    setTimeout(() => setIsLoaded(true), 100);
  }, []);

  // ── Static fallback (no WebGL) ─────────────────────────────────────────────
  if (webGLAvailable === false) {
    return (
      <div
        className="fixed inset-0 z-0"
        aria-hidden="true"
        style={{
          backgroundImage: "url('/ghat-bg.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          animation: "kenBurns 30s ease-in-out infinite alternate",
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

  // ── Waiting for WebGL check ────────────────────────────────────────────────
  if (webGLAvailable === null) {
    return <div className="fixed inset-0 z-0 bg-[#0d0505]" aria-hidden="true" />;
  }

  // ── 3D Scene with loading screen ───────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-0" aria-hidden="true">
      {/* Loading screen — fades out once scene is ready */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d0505] pointer-events-none"
        style={{
          opacity: isLoaded ? 0 : 1,
          transition: "opacity 0.8s ease",
          zIndex: 1,
        }}
      >
        <span
          className="text-4xl"
          style={{ animation: "diyaPulse 1.5s ease-in-out infinite" }}
        >
          🪔
        </span>
        <p
          className="text-orange-400 text-lg mt-3 font-semibold tracking-wide"
        >
          Preparing the Ghat...
        </p>
        <p
          className="text-orange-600 text-sm mt-1"
          style={{ fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif" }}
        >
          छठ का माहौल बन रहा है...
        </p>
        <style>{`
          @keyframes diyaPulse {
            0%, 100% { transform: scale(1.0); opacity: 0.9; }
            50%       { transform: scale(1.15); opacity: 1.0; }
          }
        `}</style>
      </div>

      {/* Three.js scene — fades in once loaded */}
      <div
        className="absolute inset-0"
        style={{
          opacity: isLoaded ? 1 : 0,
          transition: "opacity 0.8s ease",
        }}
      >
        <GhatScene audioNode={audioNode} onReady={handleSceneReady} />
      </div>
    </div>
  );
}