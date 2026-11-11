/**
 * Phase 4: Radio Queue Controller
 *
 * Central Zustand store that manages:
 * - The song queue and current index
 * - Play state machine & user intent tracking
 * - Background audio keep-alive & Screen Wake Lock
 * - System Media Session (Lock screen, Control Center, Bluetooth controls)
 * - Continuous auto-progression & loop repeating when queue ends
 * - Favorites management with localStorage persistence
 * - Queue filtering ("all" vs "favorites")
 * - Shuffle (Random) playback mode with persistence
 */

import { create } from "zustand";
import { generateUUID as uuidv4 } from "./uuid";
import type { Song } from "./api";
import type { AudioPlayerAdapter, PlayerState } from "./audio/types";
import { onPlaybackStateChange } from "./wake-lock";
import {
  updateMediaSessionMetadata,
  registerMediaSessionHandlers,
  reassertMediaSessionHandlers,
  setMediaSessionPlaybackState,
  updateMediaSessionPositionState,
} from "./media-session";

const FAVORITES_STORAGE_KEY = "chhath_radio_favorites_v1";
const SHUFFLE_STORAGE_KEY = "chhath_radio_shuffle_v1";
const VOLUME_STORAGE_KEY = "chhath_radio_volume_v1";
const MUTED_STORAGE_KEY = "chhath_radio_muted_v1";
export const OFFERINGS_STORAGE_KEY = "chhath_offerings_v1";
export const LEGACY_ARGHYA_KEY = "chhath_arghya_count";
export const LEGACY_REACTIONS_KEY = "chhath_reactions_session_v1";

function primeAudioForUserGesture(adapter: AudioPlayerAdapter | null): void {
  try {
    adapter?.primeAudio?.();
  } catch {
    // Priming is best-effort; it must not prevent the requested playback action.
  }
}

function resetMediaSessionPositionForTrackChange(
  adapter: AudioPlayerAdapter | null,
  fallbackDuration: number,
): void {
  const duration = adapter?.getDuration?.() || fallbackDuration;
  if (Number.isFinite(duration) && duration > 0) {
    updateMediaSessionPositionState(0, duration, 0);
  }
}

export function loadOfferingsFromStorage(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    let counts: Record<string, number> = {};
    const raw = localStorage.getItem(OFFERINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          const num = Number(v);
          if (!isNaN(num) && num > 0) {
            counts[k] = Math.floor(num);
          }
        }
      }
    }

    // Fallback/migration from sessionStorage if empty
    if (Object.keys(counts).length === 0) {
      try {
        const sessionRaw = sessionStorage.getItem(LEGACY_REACTIONS_KEY);
        if (sessionRaw) {
          const sessionParsed = JSON.parse(sessionRaw);
          if (sessionParsed && typeof sessionParsed === "object" && !Array.isArray(sessionParsed)) {
            for (const [k, v] of Object.entries(sessionParsed)) {
              const num = Number(v);
              if (!isNaN(num) && num > 0) {
                counts[k] = Math.floor(num);
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Incorporate legacy chhath_arghya_count if available
    try {
      const legacyArghya = localStorage.getItem(LEGACY_ARGHYA_KEY);
      if (legacyArghya) {
        const num = parseInt(legacyArghya, 10);
        if (!isNaN(num) && num > 0) {
          counts["☀️"] = Math.max(counts["☀️"] ?? 0, num);
        }
      }
    } catch {
      /* ignore */
    }

    return counts;
  } catch {
    return {};
  }
}

export function saveOfferingsToStorage(counts: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(OFFERINGS_STORAGE_KEY, JSON.stringify(counts));
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(LEGACY_REACTIONS_KEY, JSON.stringify(counts));
  } catch {
    /* ignore */
  }
  try {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    localStorage.setItem(LEGACY_ARGHYA_KEY, String(counts["☀️"] ?? total));
  } catch {
    /* ignore */
  }
}

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

function loadVolumeFromStorage(): number {
  if (typeof window === "undefined") return 80;
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw !== null) {
      const v = Number(raw);
      if (!isNaN(v) && v >= 0 && v <= 100) return v;
    }
    return 80;
  } catch {
    return 80;
  }
}

function saveVolumeToStorage(vol: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(vol));
  } catch {
    /* ignore */
  }
}

function loadMutedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MUTED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveMutedToStorage(muted: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MUTED_STORAGE_KEY, muted ? "true" : "false");
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

/**
 * Returns the favorited songs from allSongs, ordered by the order in which they were favorited.
 */
export function getFavoriteSongs(allSongs: Song[], favorites: string[]): Song[] {
  const favSongs: Song[] = [];
  const seenIds = new Set<string>();

  for (const favId of favorites) {
    const song = allSongs.find((s) => s.id === favId || s.youtube_video_id === favId);
    if (song && !seenIds.has(song.id)) {
      seenIds.add(song.id);
      favSongs.push(song);
    }
  }

  return favSongs;
}

export type UserPlayIntent = "idle" | "playing" | "paused";

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
  userIntent: UserPlayIntent;
  radioSessionId: string;
  adapter: AudioPlayerAdapter | null;
  /** Internal: cleanup fn returned by adapter.onStateChange — stored here to avoid hacks */
  _adapterUnsubscribe: (() => void) | null;
  consecutiveErrors: number;

  // Persistent Player UI & Sync State
  isReady: boolean;
  volume: number;
  isMuted: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  hasTunedIn: boolean;

  // Actions
  loadQueue: (songs: Song[], adapter: AudioPlayerAdapter) => Promise<void>;
  startPlayback: () => Promise<void>;
  pausePlayback: () => Promise<void>;
  nextSong: () => Promise<void>;
  prevSong: () => Promise<void>;
  playSongAtIndex: (index: number) => Promise<void>;
  playSong: (song: Song) => Promise<void>;
  handleAdapterStateChange: (state: PlayerState, sessionId: string) => Promise<void>;
  currentSong: () => Song | null;
  upNextSongs: (count?: number) => Song[];
  toggleFavorite: (songId: string) => void;
  isFavorite: (songId: string) => boolean;
  setFilter: (filter: PlaylistFilter) => Promise<void>;
  toggleShuffle: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setIsMuted: (isMuted: boolean) => void;
  setIsReady: (isReady: boolean) => void;
  setError: (error: string | null) => void;
  setProgress: (currentTime: number, duration: number) => void;
  seekTo: (seconds: number) => void;
  setHasTunedIn: (hasTunedIn: boolean) => void;

  // Offerings State & Actions
  offeringCounts: Record<string, number>;
  recordOffering: (emoji: string) => void;
  getOfferingCount: (emoji: string) => number;
  getTotalOfferings: () => number;
}

export const useRadioStore = create<RadioState>((set, get) => ({
  allSongs: [],
  queue: [],
  currentIndex: 0,
  favorites: loadFavoritesFromStorage(),
  activeFilter: "all",
  isShuffleEnabled: loadShuffleFromStorage(),
  offeringCounts: loadOfferingsFromStorage(),
  playState: "IDLE",
  userIntent: "idle",
  radioSessionId: uuidv4(),
  adapter: null,
  _adapterUnsubscribe: null,
  consecutiveErrors: 0,

  isReady: false,
  volume: loadVolumeFromStorage(),
  isMuted: loadMutedFromStorage(),
  currentTime: 0,
  duration: 0,
  error: null,
  hasTunedIn: false,

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

  isFavorite: (songIdOrVideoId: string) => {
    const { favorites, allSongs } = get();
    if (!songIdOrVideoId) return false;
    if (favorites.includes(songIdOrVideoId)) return true;
    const song = allSongs.find((s) => s.id === songIdOrVideoId || s.youtube_video_id === songIdOrVideoId);
    if (song) {
      return favorites.includes(song.id) || (Boolean(song.youtube_video_id) && favorites.includes(song.youtube_video_id));
    }
    return false;
  },

  toggleShuffle: () => {
    const { isShuffleEnabled } = get();
    const nextVal = !isShuffleEnabled;
    saveShuffleToStorage(nextVal);
    set({ isShuffleEnabled: nextVal });
  },

  toggleFavorite: (songIdOrVideoId: string) => {
    const { favorites, activeFilter, allSongs, queue, currentIndex, adapter, isFavorite } = get();
    const targetSong = allSongs.find((s) => s.id === songIdOrVideoId || s.youtube_video_id === songIdOrVideoId);
    const idToToggle = targetSong?.id ?? songIdOrVideoId;
    const ytIdToToggle = targetSong?.youtube_video_id;

    const isFav = isFavorite(songIdOrVideoId);
    let updatedFavs: string[];

    if (isFav) {
      // Remove all matching identifiers (both DB UUID and YouTube video ID)
      updatedFavs = favorites.filter(
        (id) => id !== idToToggle && id !== ytIdToToggle && id !== songIdOrVideoId
      );
    } else {
      // Save both DB UUID and permanent YouTube video ID so favorites survive across DB redeployments/reseeds
      const newItems = [idToToggle];
      if (ytIdToToggle && ytIdToToggle !== idToToggle) {
        newItems.push(ytIdToToggle);
      }
      updatedFavs = Array.from(new Set([...favorites, ...newItems]));
    }

    saveFavoritesToStorage(updatedFavs);

    if (activeFilter === "favorites") {
      const newFavQueue = getFavoriteSongs(allSongs, updatedFavs);

      if (newFavQueue.length === 0) {
        set({
          favorites: updatedFavs,
          activeFilter: "all",
        });
      } else {
        set({ favorites: updatedFavs });
      }
    } else {
      set({ favorites: updatedFavs });
    }
  },

  setFilter: async (filter: PlaylistFilter) => {
    set({ activeFilter: filter });
  },

  loadQueue: async (songs, adapter) => {
    // Clean up any previous adapter subscription before replacing it
    get()._adapterUnsubscribe?.();

    const newSessionId = uuidv4();
    const storedFavs = loadFavoritesFromStorage();
    const favorites = storedFavs.length > 0 ? storedFavs : get().favorites;
    const { activeFilter } = get();

    const isSongFav = (s: Song) =>
      favorites.includes(s.id) || (Boolean(s.youtube_video_id) && favorites.includes(s.youtube_video_id));

    const activeQueue =
      activeFilter === "favorites" && songs.some(isSongFav)
        ? getFavoriteSongs(songs, favorites)
        : songs;

    const unsubscribeState = adapter.onStateChange((state) => {
      get().handleAdapterStateChange(state, newSessionId);
    });

    const unsubscribeProgress = adapter.onProgress?.((cur, dur) => {
      get().setProgress(cur, dur);
    });

    const unsubscribe = () => {
      unsubscribeState();
      unsubscribeProgress?.();
    };

    // Register OS Media Session controls (Lock screen, Control Center, Bluetooth headsets).
    // Standardizes prev, next, seekto, seekbackward, seekforward across Android, iOS, and desktop.
    registerMediaSessionHandlers({
      onPlay: () => get().startPlayback(),
      onPause: () => get().pausePlayback(),
      onNext: () => get().nextSong(),
      onPrev: () => get().prevSong(),
      onSeekTo: (time) => {
        get().seekTo(time);
      },
      onSeekBackward: (offset = 10) => {
        const { currentTime, seekTo } = get();
        seekTo(Math.max(0, currentTime - offset));
      },
      onSeekForward: (offset = 10) => {
        const { currentTime, duration, seekTo } = get();
        seekTo(Math.min(duration || Infinity, currentTime + offset));
      },
    });

    set({
      allSongs: songs,
      queue: activeQueue.length > 0 ? activeQueue : songs,
      currentIndex: 0,
      playState: "IDLE",
      userIntent: "idle",
      radioSessionId: newSessionId,
      adapter,
      _adapterUnsubscribe: unsubscribe,
      isReady: true,
      error: null,
    });

  },

  setVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(100, volume));
    const { adapter, isMuted } = get();
    saveVolumeToStorage(clamped);
    if (clamped === 0) {
      adapter?.mute();
      saveMutedToStorage(true);
      set({ volume: 0, isMuted: true });
    } else {
      adapter?.setVolume(clamped);
      if (isMuted) {
        adapter?.unMute();
        saveMutedToStorage(false);
      }
      set({ volume: clamped, isMuted: false });
    }
  },

  toggleMute: () => {
    const { adapter, isMuted, volume } = get();
    const nextMuted = !isMuted;
    saveMutedToStorage(nextMuted);
    if (nextMuted) {
      adapter?.mute();
    } else {
      adapter?.unMute();
      adapter?.setVolume(volume || 80);
    }
    set({ isMuted: nextMuted });
  },

  setIsMuted: (isMuted: boolean) => {
    const { adapter, volume } = get();
    saveMutedToStorage(isMuted);
    if (isMuted) {
      adapter?.mute();
    } else {
      adapter?.unMute();
      adapter?.setVolume(volume || 80);
    }
    set({ isMuted });
  },

  setIsReady: (isReady: boolean) => {
    set({ isReady });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  setProgress: (currentTime: number, duration: number) => {
    set({ currentTime, duration });
    updateMediaSessionPositionState(currentTime, duration);

    // Pre-buffer next track when remaining duration is under 25s or progress >= 75%
    if (duration > 0 && (currentTime >= duration - 25 || currentTime / duration >= 0.75)) {
      const { queue, currentIndex, adapter, isShuffleEnabled, playState } = get();
      if (adapter && queue.length > 1 && playState === "PLAYING") {
        const nextIdx = getNextIndex(currentIndex, queue.length, isShuffleEnabled);
        const nextSong = queue[nextIdx];
        if (nextSong) {
          adapter.preloadNextSong(nextSong);
        }
      }
    }
  },

  seekTo: (seconds: number) => {
    const { adapter, duration } = get();
    if (adapter) {
      adapter.seekTo(seconds);
      const dur = duration || adapter.getDuration();
      set({ currentTime: seconds });
      if (dur > 0) {
        updateMediaSessionPositionState(seconds, dur);
      }
    }
  },

  setHasTunedIn: (hasTunedIn: boolean) => {
    set({ hasTunedIn });
  },

  startPlayback: async () => {
    const { adapter, queue, currentIndex } = get();
    if (!adapter || queue.length === 0) return;

    const song = queue[currentIndex];
    const currentState = adapter.getState();
    const { userIntent } = get();
    if (currentState === "PLAYING") {
      set({ playState: "PLAYING", userIntent: "playing" });
      updateMediaSessionMetadata(song, true, adapter.getDuration(), adapter.getCurrentTime());
      return;
    }
    if (currentState === "BUFFERING" && userIntent === "playing") return;

    primeAudioForUserGesture(adapter);
    set({ userIntent: "playing", error: null, consecutiveErrors: 0 });

    const dur = adapter.getDuration();
    const cur = adapter.getCurrentTime();
    if (dur > 0) {
      updateMediaSessionPositionState(cur, dur, 0);
    }
    updateMediaSessionMetadata(song, false, dur, cur);

    const isLoaded = adapter.isSongLoaded ? adapter.isSongLoaded(song.youtube_video_id) : true;
    if ((currentState === "PAUSED" || currentState === "CUED") && isLoaded) {
      set({ playState: "BUFFERING" });
      try {
        await adapter.play();
      } catch (err) {
        console.warn("[RadioController] play() failed:", err);
        set({ playState: "ERROR", userIntent: "idle", error: "Playback failed" });
        onPlaybackStateChange(false);
        setMediaSessionPlaybackState("none");
      }
      return;
    }

    set({ playState: "BUFFERING" });
    try {
      await adapter.loadVideo(song.youtube_video_id);
    } catch (err) {
      console.warn("[RadioController] loadVideo/play failed:", err);
      set({ playState: "ERROR", userIntent: "idle", error: "Playback failed" });
      onPlaybackStateChange(false);
      setMediaSessionPlaybackState("none");
    }
  },

  pausePlayback: async () => {
    const { adapter, userIntent: previousUserIntent } = get();
    if (!adapter) return;

    set({ userIntent: "paused" });
    try {
      await adapter.pause();
    } catch {
      set({ userIntent: previousUserIntent });
      if (previousUserIntent === "playing") onPlaybackStateChange(true);
      return;
    }

    // A newer play/track action may have arrived while pause was in flight. Do not
    // overwrite the active lock-screen session with that stale pause completion.
    if (get().userIntent !== "paused") return;

    const { duration, currentTime, queue, currentIndex } = get();
    const dur = duration || adapter.getDuration();
    const cur = adapter.getCurrentTime() || currentTime;
    set({ playState: "PAUSED" });
    updateMediaSessionMetadata(queue[currentIndex] ?? null, false, dur, cur);
    onPlaybackStateChange(false);
  },

  nextSong: async () => {
    const { queue, currentIndex, adapter, isShuffleEnabled, duration, userIntent } = get();
    if (!adapter || queue.length === 0) return;
    const wasPlaying = userIntent === "playing";

    primeAudioForUserGesture(adapter);
    const nextIndex = getNextIndex(currentIndex, queue.length, isShuffleEnabled);

    set({ currentIndex: nextIndex, playState: "BUFFERING", userIntent: "playing", error: null });
    resetMediaSessionPositionForTrackChange(adapter, duration);
    updateMediaSessionMetadata(queue[nextIndex], wasPlaying);
    try {
      await adapter.loadVideo(queue[nextIndex].youtube_video_id);
      reassertMediaSessionHandlers();
    } catch {
      set({ playState: "ERROR", userIntent: "idle", error: "Could not load next track" });
      onPlaybackStateChange(false);
      setMediaSessionPlaybackState("none");
    }
  },

  prevSong: async () => {
    const { queue, currentIndex, adapter, currentTime, duration, userIntent } = get();
    if (!adapter || queue.length === 0) return;
    const wasPlaying = userIntent === "playing";

    primeAudioForUserGesture(adapter);
    // If current song has played more than 3 seconds, restart the song from beginning
    if (currentTime > 3) {
      adapter.seekTo(0);
      set({ currentTime: 0 });
      const activeDuration = duration || adapter.getDuration();
      if (activeDuration > 0) updateMediaSessionPositionState(0, activeDuration);
      return;
    }

    const prevIndex = currentIndex > 0 ? currentIndex - 1 : queue.length - 1;
    set({ currentIndex: prevIndex, playState: "BUFFERING", userIntent: "playing", error: null });
    resetMediaSessionPositionForTrackChange(adapter, duration);
    updateMediaSessionMetadata(queue[prevIndex], wasPlaying);
    try {
      await adapter.loadVideo(queue[prevIndex].youtube_video_id);
      reassertMediaSessionHandlers();
    } catch {
      set({ playState: "ERROR", userIntent: "idle", error: "Could not load previous track" });
      onPlaybackStateChange(false);
      setMediaSessionPlaybackState("none");
    }
  },

  playSongAtIndex: async (index: number) => {
    const { queue, adapter, duration, userIntent } = get();
    if (!adapter || index < 0 || index >= queue.length) return;
    const wasPlaying = userIntent === "playing";
    const targetSong = queue[index];
    primeAudioForUserGesture(adapter);
    set({
      currentIndex: index,
      playState: "BUFFERING",
      userIntent: "playing",
      error: null,
      consecutiveErrors: 0,
    });
    resetMediaSessionPositionForTrackChange(adapter, duration);
    updateMediaSessionMetadata(targetSong, wasPlaying);
    try {
      await adapter.loadVideo(targetSong.youtube_video_id);
      reassertMediaSessionHandlers();
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        set({ playState: "ERROR", userIntent: "idle", error: "Could not play track" });
        onPlaybackStateChange(false);
        setMediaSessionPlaybackState("none");
      }
    }
  },

  playSong: async (song: Song) => {
    const { queue, playSongAtIndex, userIntent } = get();
    const idx = queue.findIndex(
      (s) => s.id === song.id || s.youtube_video_id === song.youtube_video_id
    );
    if (idx !== -1) {
      await playSongAtIndex(idx);
    } else {
      const wasPlaying = userIntent === "playing";
      const newQueue = [song, ...queue];
      set({ queue: newQueue });
      const { adapter, duration } = get();
      if (!adapter) return;
      primeAudioForUserGesture(adapter);
      set({
        currentIndex: 0,
        playState: "BUFFERING",
        userIntent: "playing",
        error: null,
        consecutiveErrors: 0,
      });
      resetMediaSessionPositionForTrackChange(adapter, duration);
      updateMediaSessionMetadata(song, wasPlaying);
      try {
        await adapter.loadVideo(song.youtube_video_id);
        reassertMediaSessionHandlers();
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          set({ playState: "ERROR", userIntent: "idle", error: "Could not play track" });
          onPlaybackStateChange(false);
          setMediaSessionPlaybackState("none");
        }
      }
    }
  },

  handleAdapterStateChange: async (state, sessionId) => {
    const { radioSessionId, queue, currentIndex, adapter, userIntent } = get();

    if (sessionId !== radioSessionId) return;

    switch (state) {
      case "PLAYING": {
        set({ playState: "PLAYING", userIntent: "playing", error: null, consecutiveErrors: 0 });
        const dur = adapter?.getDuration?.() || get().duration;
        const cur = adapter?.getCurrentTime?.() || get().currentTime;
        updateMediaSessionMetadata(queue[currentIndex], true, dur, cur);
        reassertMediaSessionHandlers();
        onPlaybackStateChange(true);

        // Proactively prewarm the next track immediately after playback begins
        // so lockscreen and manual skips transition with 0-second latency
        if (queue.length > 1 && adapter?.preloadNextSong) {
          const { isShuffleEnabled } = get();
          const nextIdx = getNextIndex(currentIndex, queue.length, isShuffleEnabled);
          const nextSong = queue[nextIdx];
          if (nextSong) {
            try {
              adapter.preloadNextSong(nextSong).catch(() => {});
            } catch {
              /* ignore */
            }
          }
        }
        break;
      }

      case "PAUSED": {
        set({ playState: "PAUSED" });
        setMediaSessionPlaybackState("paused");
        reassertMediaSessionHandlers();
        onPlaybackStateChange(false);
        break;
      }

      case "BUFFERING":
        set({ playState: "BUFFERING" });
        // Preserve a currently active session during a track/source transition. Initial
        // playback explicitly publishes paused metadata until the adapter reports PLAYING.
        if (userIntent !== "playing") setMediaSessionPlaybackState("paused");
        break;

      case "ENDED": {
        // Prevent duplicate transition if already buffering or loading the next track
        if (get().playState === "BUFFERING") return;
        if (queue.length > 0) {
          const { isShuffleEnabled } = get();
          const wasPlaying = userIntent === "playing";
          const nextIndex = getNextIndex(currentIndex, queue.length, isShuffleEnabled);
          set({ currentIndex: nextIndex, playState: "BUFFERING", userIntent: "playing", error: null });
          resetMediaSessionPositionForTrackChange(adapter, get().duration);
          updateMediaSessionMetadata(queue[nextIndex], wasPlaying);
          try {
            await adapter?.loadVideo(queue[nextIndex].youtube_video_id);
            reassertMediaSessionHandlers();
          } catch {
            set({ playState: "ERROR", error: "Could not play next track" });
          }
        } else {
          set({ currentIndex: 0, playState: "IDLE", userIntent: "idle" });
          onPlaybackStateChange(false);
          setMediaSessionPlaybackState("none");
        }
        break;
      }

      case "ERROR": {
        const errCount = (get().consecutiveErrors || 0) + 1;
        console.warn(
          `[RadioController] Audio error for song at index ${currentIndex} (consecutive: ${errCount}).`
        );
        set({
          playState: "ERROR",
          userIntent: "idle",
          error: "Playback failed. Retry this song or skip to the next one.",
          consecutiveErrors: errCount,
        });
        onPlaybackStateChange(false);
        setMediaSessionPlaybackState("none");
        break;
      }
    }
  },

  recordOffering: (emoji: string) => {
    const current = get().offeringCounts;
    const next = { ...current, [emoji]: (current[emoji] ?? 0) + 1 };
    saveOfferingsToStorage(next);
    set({ offeringCounts: next });
  },

  getOfferingCount: (emoji: string) => {
    return get().offeringCounts[emoji] ?? 0;
  },

  getTotalOfferings: () => {
    return Object.values(get().offeringCounts).reduce((a, b) => a + b, 0);
  },
}));

// Cross-tab synchronization for offering counts & favorites
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === OFFERINGS_STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          useRadioStore.setState({ offeringCounts: parsed });
        }
      } catch {
        /* ignore */
      }
    } else if (e.key === FAVORITES_STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) {
          useRadioStore.setState({ favorites: parsed });
        }
      } catch {
        /* ignore */
      }
    }
  });
}

// Tab visibility changes: re-request wake lock if user is actively playing
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const state = useRadioStore.getState();
    if (!document.hidden && state.userIntent === "playing") {
      onPlaybackStateChange(true);
    }
  });
}
