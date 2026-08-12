/**
 * Phase 4: Radio Queue Controller
 *
 * Central Zustand store that manages:
 * - The song queue and current index
 * - Play state machine
 * - Auto-progression when a song ends (Phase 4.2)
 * - Error recovery for private/deleted videos (Phase 4.3)
 * - Session guard to prevent race conditions (Phase 4.4)
 */

import { create } from "zustand";
// Use the built-in Web Crypto API — no external dependency needed
const uuidv4 = () => crypto.randomUUID();
import type { Song } from "./api";
import type { YouTubePlayerAdapter, PlayerState } from "./youtube-adapter";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RadioPlayState =
  | "IDLE"
  | "PLAYING"
  | "PAUSED"
  | "BUFFERING"
  | "ERROR";

interface RadioState {
  // Queue
  queue: Song[];
  currentIndex: number;

  // Play state
  playState: RadioPlayState;

  // Phase 4.4: Session guard — each channel/queue load gets a new ID
  radioSessionId: string;

  // The adapter instance (set externally by the player component)
  adapter: YouTubePlayerAdapter | null;

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Load a new queue of songs and reset the session. */
  loadQueue: (songs: Song[], adapter: YouTubePlayerAdapter) => Promise<void>;

  /** Start playing the radio (user tapped the Play button). */
  startPlayback: () => Promise<void>;

  /** Pause playback. */
  pausePlayback: () => Promise<void>;

  /** Skip to the next song manually. */
  nextSong: () => Promise<void>;

  /** Called internally when the YouTube adapter emits a state change. */
  handleAdapterStateChange: (state: PlayerState, sessionId: string) => Promise<void>;

  /** Get the currently playing song, or null if queue is empty. */
  currentSong: () => Song | null;

  /** Get the next N songs in the queue. */
  upNextSongs: (count?: number) => Song[];
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useRadioStore = create<RadioState>((set, get) => ({
  queue: [],
  currentIndex: 0,
  playState: "IDLE",
  radioSessionId: uuidv4(),
  adapter: null,

  currentSong: () => {
    const { queue, currentIndex } = get();
    return queue[currentIndex] ?? null;
  },

  upNextSongs: (count = 3) => {
    const { queue, currentIndex } = get();
    return queue.slice(currentIndex + 1, currentIndex + 1 + count);
  },

  loadQueue: async (songs, adapter) => {
    // Phase 4.4: Generate a new session ID to invalidate any in-flight events
    const newSessionId = uuidv4();

    set({
      queue: songs,
      currentIndex: 0,
      playState: "IDLE",
      radioSessionId: newSessionId,
      adapter,
    });

    // Subscribe to adapter state changes, passing the session ID so stale
    // events from a previous session can be ignored.
    const unsubscribe = adapter.onStateChange((state) => {
      get().handleAdapterStateChange(state, newSessionId);
    });

    // Store the unsubscribe function so it can be called on cleanup
    // (We attach it to the adapter instance for simplicity)
    (adapter as unknown as { _unsubscribe?: () => void })._unsubscribe = unsubscribe;
  },

  startPlayback: async () => {
    const { adapter, queue, currentIndex } = get();
    if (!adapter || queue.length === 0) return;

    const song = queue[currentIndex];
    set({ playState: "BUFFERING" });
    await adapter.loadVideo(song.youtube_video_id);
  },

  pausePlayback: async () => {
    const { adapter } = get();
    if (!adapter) return;
    await adapter.pause();
    set({ playState: "PAUSED" });
  },

  nextSong: async () => {
    const { queue, currentIndex, adapter, radioSessionId } = get();
    if (!adapter) return;

    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      // End of queue — wrap around to beginning
      set({ currentIndex: 0, playState: "IDLE" });
      return;
    }

    set({ currentIndex: nextIndex, playState: "BUFFERING" });
    await adapter.loadVideo(queue[nextIndex].youtube_video_id);
  },

  handleAdapterStateChange: async (state, sessionId) => {
    const { radioSessionId, queue, currentIndex, adapter } = get();

    // Phase 4.4: Session guard — ignore events from old sessions
    if (sessionId !== radioSessionId) return;

    switch (state) {
      case "PLAYING":
        set({ playState: "PLAYING" });
        break;

      case "PAUSED":
        set({ playState: "PAUSED" });
        break;

      case "BUFFERING":
        set({ playState: "BUFFERING" });
        break;

      case "ENDED": {
        // Phase 4.2: Auto-progression
        const nextIndex = currentIndex + 1;
        if (nextIndex < queue.length) {
          set({ currentIndex: nextIndex, playState: "BUFFERING" });
          await adapter?.loadVideo(queue[nextIndex].youtube_video_id);
        } else {
          // Wrap around
          set({ currentIndex: 0, playState: "IDLE" });
        }
        break;
      }

      case "ERROR": {
        // Phase 4.3: Error recovery — skip the broken song
        console.warn(
          `[RadioController] Video error for song at index ${currentIndex}. Skipping.`
        );
        const nextIndex = currentIndex + 1;
        if (nextIndex < queue.length) {
          set({ currentIndex: nextIndex, playState: "BUFFERING" });
          await adapter?.loadVideo(queue[nextIndex].youtube_video_id);
        } else {
          set({ playState: "ERROR" });
        }
        break;
      }
    }
  },
}));