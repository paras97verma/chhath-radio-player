"use client";

/**
 * GhatSceneLoader — Client Component wrapper for GhatScene.
 *
 * Uses dynamic import with ssr:false (required for Three.js / WebGL).
 * Renders as a fixed full-viewport layer behind all UI (z-index: 0).
 */

import dynamic from "next/dynamic";

const GhatScene = dynamic(() => import("./GhatScene"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-0 bg-[#0d0505]" aria-hidden="true" />
  ),
});

export default function GhatSceneLoader() {
  return (
    <div className="fixed inset-0 z-0" aria-hidden="true">
      <GhatScene />
    </div>
  );
}