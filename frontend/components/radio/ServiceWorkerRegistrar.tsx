"use client";

/**
 * ServiceWorkerRegistrar — Registers /sw.js on mount.
 *
 * This is a zero-render client component (returns null) that handles
 * service worker registration for PWA functionality:
 *   - Offline caching of the app shell
 *   - Push notification support
 *   - "Add to Home Screen" installability
 *
 * Must be rendered inside the root layout so it runs on every page.
 */

import { useEffect } from "react";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        console.info(
          "[Chhath Radio] Service worker registered. Scope:",
          registration.scope
        );

        // Check for updates on each page load
        registration.update().catch(() => {
          // Silently ignore update check failures (e.g. offline)
        });
      })
      .catch((err) => {
        console.warn("[Chhath Radio] Service worker registration failed:", err);
      });
  }, []);

  return null;
}