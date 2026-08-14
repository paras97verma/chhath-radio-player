/**
 * user-store.ts — Zustand store for user preferences persisted in localStorage.
 *
 * Tracks:
 * - favorites: Set of youtube_video_id strings the user has hearted
 * - history: Last 30 songs listened to (most recent first)
 *
 * No backend required — pure localStorage via Zustand persist middleware.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Song } from "./api";

interface UserState {
  /** Set of youtube_video_id strings the user has favorited */
  favorites: string[];

  /** Last 30 songs listened to, most recent first */
  history: Song[];

  /** Toggle a song's favorite status */
  toggleFavorite: (videoId: string) => void;

  /** Returns true if a video ID is favorited */
  isFavorite: (videoId: string) => boolean;

  /** Add a song to listening history (deduplicates, keeps most recent) */
  addToHistory: (song: Song) => void;

  /** Clear all history */
  clearHistory: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      favorites: [],
      history: [],

      toggleFavorite: (videoId) => {
        const { favorites } = get();
        if (favorites.includes(videoId)) {
          set({ favorites: favorites.filter((id) => id !== videoId) });
        } else {
          set({ favorites: [videoId, ...favorites] });
        }
      },

      isFavorite: (videoId) => get().favorites.includes(videoId),

      addToHistory: (song) => {
        const { history } = get();
        // Remove existing entry for this song (dedup), then prepend
        const filtered = history.filter(
          (s) => s.youtube_video_id !== song.youtube_video_id
        );
        set({ history: [song, ...filtered].slice(0, 30) });
      },

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: "chhath_user_prefs_v1",
      // Only persist favorites and history, not functions
      partialize: (state) => ({
        favorites: state.favorites,
        history: state.history,
      }),
    }
  )
);