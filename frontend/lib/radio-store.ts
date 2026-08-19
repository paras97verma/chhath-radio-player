/**
 * Phase 4: Radio Queue Controller
 *
 * Central Zustand store that manages:
 * - The song queue and current index
 * - Play state machine
 * - Continuous auto-progression & loop repeating when queue ends
 * - Favorites management with localStorage persistence
 * - Queue filtering ("all" vs "favorites")
 * - Shuffle (Random) playback mode with persistence
 */

import { create } from "zustand";
const uuidv4 = () => crypto.randomUUID();
import type { Song } from "./api";
import type { YouTubePlayerAdapter, PlayerState } from "./youtube-adapter";

const FAVORITES_STORAGE_KEY = "chhath_radio_favorites_v1";
const SHUFFLE_STORAGE_KEY = "chhath_radio_shuffle_v1";

function loadFavoritesFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavoritesToStorage(favs: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favs));
  } catch {
    /* ignore */
  }
}

function loadShuffleFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SHUFFLE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveShuffleToStorage(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SHUFFLE_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore */
  }
}

function getNextIndex(current: number, length: number, isShuffle: boolean): number {
  if (length <= 1) return 0;
  if (isShuffle) {
    let rand = Math.floor(Math.random() * length);
    if (rand === current) {
      rand = (current + 1) % length;
    }
    return rand;
  }
  return (current + 1) % length;
}

export type RadioPlayState =
  | "IDLE"
  | "PLAYING"
  | "PAUSED"
  | "BUFFERING"
  | "ERROR";

export type PlaylistFilter = "all" | "favorites";

interface RadioState {
  // Queue & Song data
  allSongs: Song[];
  queue: Song[];
  currentIndex: number;
  favorites: string[];
  activeFilter: PlaylistFilter;
  isShuffleEnabled: boolean;

  // Play state
  playState: RadioPlayState;
  radioSessionId: string;
  adapter: YouTubePlayerAdapter | null;

  // Actions
  loadQueue: (songs: Song[], adapter: YouTubePlayerAdapter) => Promise<void>;
  startPlayback: () => Promise<void>;
  pausePlayback: () => Promise<void>;
  nextSong: () => Promise<void>;
  handleAdapterStateChange: (state: PlayerState, sessionId: string) => Promise<void>;
  currentSong: () => Song | null;
  upNextSongs: (count?: number) => Song[];
  toggleFavorite: (songId: string) => void;
  isFavorite: (songId: string) => boolean;
  setFilter: (filter: PlaylistFilter) => Promise<void>;
  toggleShuffle: () => void;
}

export const useRadioStore = create<RadioState>((set, get) => ({
  allSongs: [],
  queue: [],
  currentIndex: 0,
  favorites: loadFavoritesFromStorage(),
  activeFilter: "all",
  isShuffleEnabled: loadShuffleFromStorage(),
  playState: "IDLE",
  radioSessionId: uuidv4(),
  adapter: null,

  currentSong: () => {
    const { queue, currentIndex } = get();
    return queue[currentIndex] ?? null;
  },

  upNextSongs: (count = 3) => {
    const { queue, currentIndex, isShuffleEnabled } = get();
    if (queue.length === 0) return [];
    const result: Song[] = [];
    for (let i = 1; i <= Math.min(count, queue.length - 1); i++) {
      const idx = isShuffleEnabled
        ? (currentIndex + i * 3) % queue.length
        : (currentIndex + i) % queue.length;
      result.push(queue[idx]);
    }
    return result;
  },

  isFavorite: (songId: string) => {
    return get().favorites.includes(songId);
  },

  toggleShuffle: () => {
    const { isShuffleEnabled } = get();
    const nextVal = !isShuffleEnabled;
    saveShuffleToStorage(nextVal);
    set({ isShuffleEnabled: nextVal });
  },

  toggleFavorite: (songId: string) => {
    const { favorites, activeFilter, allSongs, queue, currentIndex, adapter } = get();
    const isFav = favorites.includes(songId);
    const updatedFavs = isFav
      ? favorites.filter((id) => id !== songId)
      : [...favorites, songId];

    saveFavoritesToStorage(updatedFavs);

    if (activeFilter === "favorites") {
      const currentPlayingSong = queue[currentIndex];
      const newFavQueue = allSongs.filter((s) => updatedFavs.includes(s.id));

      if (newFavQueue.length === 0) {
        set({
          favorites: updatedFavs,
          activeFilter: "all",
          queue: allSongs,
          currentIndex: currentPlayingSong
            ? Math.max(0, allSongs.findIndex((s) => s.id === currentPlayingSong.id))
            : 0,
        });
      } else {
        const newIdx = currentPlayingSong
          ? Math.max(0, newFavQueue.findIndex((s) => s.id === currentPlayingSong.id))
          : 0;
        set({
          favorites: updatedFavs,
          queue: newFavQueue,
          currentIndex: newIdx,
        });
        if (!isFav && adapter && currentPlayingSong && newFavQueue[newIdx]?.id !== currentPlayingSong.id) {
          adapter.loadVideo(newFavQueue[newIdx].youtube_video_id);
        }
      }
    } else {
      set({ favorites: updatedFavs });
    }
  },

  setFilter: async (filter: PlaylistFilter) => {
    const { allSongs, favorites, currentSong, adapter } = get();
    const curSong = currentSong();

    if (filter === "favorites") {
      const favQueue = allSongs.filter((s) => favorites.includes(s.id));
      if (favQueue.length === 0) return;

      const matchIdx = curSong ? favQueue.findIndex((s) => s.id === curSong.id) : 0;
      const targetIdx = matchIdx >= 0 ? matchIdx : 0;

      set({
        activeFilter: "favorites",
        queue: favQueue,
        currentIndex: targetIdx,
      });

      if (adapter && favQueue[targetIdx]) {
        set({ playState: "BUFFERING" });
        await adapter.loadVideo(favQueue[targetIdx].youtube_video_id);
      }
    } else {
      const matchIdx = curSong ? allSongs.findIndex((s) => s.id === curSong.id) : 0;
      const targetIdx = matchIdx >= 0 ? matchIdx : 0;

      set({
        activeFilter: "all",
        queue: allSongs,
        currentIndex: targetIdx,
      });
    }
  },

  loadQueue: async (songs, adapter) => {
    const newSessionId = uuidv4();
    const { activeFilter, favorites } = get();
    const activeQueue =
      activeFilter === "favorites" && favorites.length > 0
        ? songs.filter((s) => favorites.includes(s.id))
        : songs;

    set({
      allSongs: songs,
      queue: activeQueue.length > 0 ? activeQueue : songs,
      currentIndex: 0,
      playState: "IDLE",
      radioSessionId: newSessionId,
      adapter,
    });

    const unsubscribe = adapter.onStateChange((state) => {
      get().handleAdapterStateChange(state, newSessionId);
    });

    (adapter as unknown as { _unsubscribe?: () => void })._unsubscribe = unsubscribe;
  },

  startPlayback: async () => {
    const { adapter, queue, currentIndex } = get();
    if (!adapter || queue.length === 0) return;

    const currentState = adapter.getState();
    if (currentState === "PAUSED" || currentState === "CUED") {
      await adapter.play();
      return;
    }

    const song = queue[currentIndex];
    set({ playState: "BUFFERING" });
    await adapter.loadVideo(song.youtube_video_id);
    await adapter.play();
  },

  pausePlayback: async () => {
    const { adapter } = get();
    if (!adapter) return;
    await adapter.pause();
    set({ playState: "PAUSED" });
  },

  nextSong: async () => {
    const { queue, currentIndex, adapter, isShuffleEnabled } = get();
    if (!adapter || queue.length === 0) return;

    const nextIndex = getNextIndex(currentIndex, queue.length, isShuffleEnabled);

    set({ currentIndex: nextIndex, playState: "BUFFERING" });
    await adapter.loadVideo(queue[nextIndex].youtube_video_id);
  },

  handleAdapterStateChange: async (state, sessionId) => {
    const { radioSessionId, queue, currentIndex, adapter } = get();

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
        if (queue.length > 0) {
          const { isShuffleEnabled } = get();
          const nextIndex = getNextIndex(currentIndex, queue.length, isShuffleEnabled);
          set({ currentIndex: nextIndex, playState: "BUFFERING" });
          await adapter?.loadVideo(queue[nextIndex].youtube_video_id);
        } else {
          set({ currentIndex: 0, playState: "IDLE" });
        }
        break;
      }

      case "ERROR": {
        console.warn(
          `[RadioController] Video error for song at index ${currentIndex}. Skipping.`
        );
        if (queue.length > 1) {
          const { isShuffleEnabled } = get();
          const nextIndex = getNextIndex(currentIndex, queue.length, isShuffleEnabled);
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