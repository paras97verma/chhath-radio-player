"use client";

/**
 * GlobalRadioProvider
 *
 * Persistent application-wide owner of the native HTML5 audio player.
 * Mounted in app/layout.tsx to persist audio playback seamlessly across
 * all route transitions (/ -> /admin -> /share -> /).
 *
 * Guarantees:
 * 1. Single audio adapter instance across entire app lifetime.
 * 2. Unmounting page-level UI (e.g. RadioPlayer) NEVER destroys or interrupts playback.
 * 3. Dual-pipeline native <audio> elements for zero-gap background transitions.
 * 4. Safe against React Strict Mode double-invocation & initialization races.
 * 5. Centralized store synchronization for queue, playback state, and volume.
 */

import React, { useEffect, useRef } from "react";
import { fetchRadioQueue } from "@/lib/api";
import { Html5AudioAdapter } from "@/lib/audio/html5-audio-adapter";
import type { AudioPlayerAdapter } from "@/lib/audio/types";
import { useRadioStore } from "@/lib/radio-store";

let activeAdapter: AudioPlayerAdapter | null = null;
let initPromise: Promise<void> | null = null;
let isProviderMounted = false;
let destroyTimer: ReturnType<typeof setTimeout> | null = null;

export default function GlobalRadioProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const primaryAudioRef = useRef<HTMLAudioElement>(null);
  const secondaryAudioRef = useRef<HTMLAudioElement>(null);

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

          const primary = primaryAudioRef.current || undefined;
          const secondary = secondaryAudioRef.current || undefined;
          const container = containerRef.current;

          const adapter = new Html5AudioAdapter(primary, secondary);
          activeAdapter = adapter;

          await adapter.initialize(container, songs[0]);

          const { volume, isMuted, userIntent } = useRadioStore.getState();
          adapter.setVolume(volume);
          if (isMuted) adapter.mute();

          await useRadioStore.getState().loadQueue(songs, adapter);
          useRadioStore.getState().setIsReady(true);

          // Only play if the user explicitly requested playback
          if (userIntent === "playing") {
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
      {/* Persistent native HTML5 dual audio pipeline */}
      <div ref={containerRef} id="chhath-audio-container" style={{ display: "none" }} aria-hidden="true">
        <audio
          ref={primaryAudioRef}
          id="chhath-audio-primary"
          preload="auto"
          playsInline
        />
        <audio
          ref={secondaryAudioRef}
          id="chhath-audio-secondary"
          preload="auto"
          playsInline
        />
      </div>
      {children}
    </>
  );
}
