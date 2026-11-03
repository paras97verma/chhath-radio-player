"use client";

/**
 * GlobalRadioProvider
 *
 * Persistent application-wide owner of the YouTube IFrame player.
 * Mounted in app/layout.tsx to persist audio playback seamlessly across
 * all route transitions (/ -> /admin -> /share -> /).
 *
 * Guarantees:
 * 1. Single YouTube player instance across entire app lifetime.
 * 2. Unmounting page-level UI (e.g. RadioPlayer) NEVER destroys or interrupts the player.
 * 3. Safe against React Strict Mode double-invocation & initialization races.
 * 4. Centralized store synchronization for queue, playback state, and volume.
 */

import React, { useEffect, useRef } from "react";
import { fetchRadioQueue } from "@/lib/api";
import { YouTubeIFramePlayerAdapter } from "@/lib/youtube-adapter";
import { useRadioStore } from "@/lib/radio-store";

let activeAdapter: YouTubeIFramePlayerAdapter | null = null;
let initPromise: Promise<void> | null = null;
let isProviderMounted = false;
let destroyTimer: ReturnType<typeof setTimeout> | null = null;

export default function GlobalRadioProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isProviderMounted = true;
    if (destroyTimer) {
      clearTimeout(destroyTimer);
      destroyTimer = null;
    }

    async function init() {
      // If player adapter is already active in store, avoid duplicate initialization
      if (activeAdapter && useRadioStore.getState().adapter === activeAdapter) {
        return;
      }

      if (initPromise) {
        await initPromise;
        return;
      }

      initPromise = (async () => {
        try {
          const songs = await fetchRadioQueue();
          if (!songs || songs.length === 0) {
            useRadioStore.getState().setError("No songs found in catalog");
            return;
          }

          const container = containerRef.current;
          if (!container) return;

          const adapter = new YouTubeIFramePlayerAdapter();
          activeAdapter = adapter;

          await adapter.initialize(container, songs[0].youtube_video_id);

          const { volume, isMuted, userIntent, hasTunedIn } = useRadioStore.getState();
          adapter.setVolume(volume);
          if (isMuted) adapter.mute();

          await useRadioStore.getState().loadQueue(songs, adapter);
          useRadioStore.getState().setIsReady(true);

          // If playback was requested before initialization finished
          if (userIntent === "playing" || hasTunedIn) {
            try {
              await adapter.play();
            } catch (playErr) {
              console.warn("[GlobalRadioProvider] Play on init prevented by browser policy:", playErr);
            }
          }
        } catch (err) {
          console.error("[GlobalRadioProvider] Init error:", err);
          useRadioStore.getState().setError("Could not load radio player. Please check your connection.");
        } finally {
          initPromise = null;
        }
      })();

      await initPromise;
    }

    init();

    // Regular progress updater while playing (keeps store synced for routes without active ProgressBar)
    const progressInterval = setInterval(() => {
      const state = useRadioStore.getState();
      if (state.playState === "PLAYING" && state.adapter) {
        const cur = state.adapter.getCurrentTime();
        const dur = state.adapter.getDuration();
        if (dur > 0) {
          state.setProgress(cur, dur);
        }
      }
    }, 500);

    return () => {
      clearInterval(progressInterval);
      isProviderMounted = false;

      // In React Strict Mode, the second mount happens immediately within the current tick or <50ms.
      // Delay destruction by 200ms so Strict Mode or transient remounts never kill the active player.
      destroyTimer = setTimeout(() => {
        if (!isProviderMounted) {
          if (activeAdapter) {
            activeAdapter.destroy();
            activeAdapter = null;
          }
          useRadioStore.setState({ adapter: null, isReady: false });
        }
      }, 200);
    };
  }, []);

  return (
    <>
      {/* Hidden YouTube iframe with valid geometry to avoid browser invisible-frame throttling */}
      <div
        ref={containerRef}
        id="yt-player-container"
        style={{
          position: "fixed",
          bottom: -150,
          right: -150,
          width: 200,
          height: 200,
          opacity: 0.005,
          pointerEvents: "none",
          zIndex: -50,
        }}
        aria-hidden="true"
      />
      {children}
    </>
  );
}
