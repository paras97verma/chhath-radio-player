/**
 * Phase 3: YouTube Player Adapter
 *
 * This module defines the clean interface between our React app and the
 * YouTube IFrame Player API. By coding to an interface, we can swap in
 * a MockYouTubePlayerAdapter during tests without touching YouTube at all.
 */

// ─── Player State Constants ───────────────────────────────────────────────────

export type PlayerState =
  | "UNSTARTED"
  | "ENDED"
  | "PLAYING"
  | "PAUSED"
  | "BUFFERING"
  | "CUED"
  | "ERROR";

// YouTube IFrame API numeric state codes → our readable strings
const YT_STATE_MAP: Record<number, PlayerState> = {
  [-1]: "UNSTARTED",
  [0]: "ENDED",
  [1]: "PLAYING",
  [2]: "PAUSED",
  [3]: "BUFFERING",
  [5]: "CUED",
};

// YouTube error codes that indicate a video cannot be played
export const YT_UNPLAYABLE_ERRORS = new Set([2, 5, 100, 101, 150]);

// ─── Phase 3.1: The Adapter Interface ────────────────────────────────────────

export interface YouTubePlayerAdapter {
  /** Initialize the player inside the given container element. */
  initialize(container: HTMLElement, videoId: string): Promise<void>;
  /** Load and play a new video by its 11-character ID. */
  loadVideo(videoId: string): Promise<void>;
  /** Resume playback. */
  play(): Promise<void>;
  /** Pause playback. */
  pause(): Promise<void>;
  /** Mute the player. */
  mute(): void;
  /** Unmute the player. */
  unMute(): void;
  /** Set volume (0–100). */
  setVolume(volume: number): void;
  /** Seek to a position in seconds. */
  seekTo(seconds: number): void;
  /** Get current playback position in seconds. */
  getCurrentTime(): number;
  /** Get total duration in seconds. */
  getDuration(): number;
  /** Get the current player state. */
  getState(): PlayerState;
  /**
   * Subscribe to player state changes.
   * Returns an unsubscribe function — call it in React's useEffect cleanup.
   */
  onStateChange(callback: (state: PlayerState) => void): () => void;
  /** Destroy the player and remove all event listeners (prevents memory leaks). */
  destroy(): void;
}

// ─── Phase 3.2: Production Implementation ────────────────────────────────────

declare global {
  interface Window {
    YT: {
      Player: new (
        container: HTMLElement,
        options: {
          videoId: string;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: (event: { target: YTPlayer }) => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState: Record<string, number>;
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

interface YTPlayer {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
  getPlayerState(): number;
}

let ytApiLoaded = false;
let ytApiLoadPromise: Promise<void> | null = null;

/**
 * Pre-warm the YouTube IFrame API by injecting the script tag immediately.
 * Safe to call multiple times — idempotent. Fire-and-forget.
 */
export function preloadYouTubeAPI(): void {
  loadYouTubeAPI(); // result cached in ytApiLoadPromise
}

function loadYouTubeAPI(): Promise<void> {
  if (typeof window !== "undefined" && window.YT && window.YT.Player) {
    ytApiLoaded = true;
    return Promise.resolve();
  }
  if (ytApiLoaded) return Promise.resolve();
  if (ytApiLoadPromise) return ytApiLoadPromise;

  ytApiLoadPromise = new Promise((resolve) => {
    const existingCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      if (existingCallback) existingCallback();
      resolve();
    };

    // Only inject the script once
    if (!document.getElementById("yt-iframe-api")) {
      const script = document.createElement("script");
      script.id = "yt-iframe-api";
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  });

  return ytApiLoadPromise;
}

export class YouTubeIFramePlayerAdapter implements YouTubePlayerAdapter {
  private player: YTPlayer | null = null;
  private isReady = false;
  private currentState: PlayerState = "UNSTARTED";
  private stateListeners: Set<(state: PlayerState) => void> = new Set();

  async initialize(container: HTMLElement, videoId: string): Promise<void> {
    await loadYouTubeAPI();

    return new Promise((resolve) => {
      this.isReady = false;
      this.player = new window.YT.Player(container, {
        videoId,
        playerVars: {
          // Golden Rule: NO ad-blocking, NO fake controls
          autoplay: 1,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            this.isReady = true;
            resolve();
          },
          onStateChange: (event) => {
            const state = YT_STATE_MAP[event.data] ?? "UNSTARTED";
            this.currentState = state;
            this.stateListeners.forEach((cb) => cb(state));
          },
          onError: (event) => {
            // Map YouTube errors to our ERROR state
            if (YT_UNPLAYABLE_ERRORS.has(event.data)) {
              this.currentState = "ERROR";
              this.stateListeners.forEach((cb) => cb("ERROR" as PlayerState));
            }
          },
        },
      });
    });
  }

  private _call<K extends keyof YTPlayer>(
    methodName: K,
    ...args: Parameters<YTPlayer[K]>
  ): ReturnType<YTPlayer[K]> | undefined {
    if (!this.isReady || !this.player) return undefined;
    const fn = this.player[methodName];
    if (typeof fn === "function") {
      return (fn as (...a: unknown[]) => unknown).apply(this.player, args) as ReturnType<YTPlayer[K]>;
    }
    return undefined;
  }

  async loadVideo(videoId: string): Promise<void> {
    if (!this.player) throw new Error("Player not initialized");
    this._call("loadVideoById", videoId);
    this._call("playVideo");
  }

  async play(): Promise<void> {
    this._call("playVideo");
  }

  async pause(): Promise<void> {
    this._call("pauseVideo");
  }

  mute(): void {
    this._call("mute");
  }

  unMute(): void {
    this._call("unMute");
  }

  setVolume(volume: number): void {
    this._call("setVolume", volume);
  }

  seekTo(seconds: number): void {
    this._call("seekTo", seconds, true);
  }

  getCurrentTime(): number {
    return this._call("getCurrentTime") ?? 0;
  }

  getDuration(): number {
    return this._call("getDuration") ?? 0;
  }

  getState(): PlayerState {
    return this.currentState;
  }

  onStateChange(callback: (state: PlayerState) => void): () => void {
    this.stateListeners.add(callback);
    // Return the unsubscribe function for React useEffect cleanup
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  destroy(): void {
    // CRITICAL: Remove all listeners before destroying to prevent memory leaks
    this.isReady = false;
    this.stateListeners.clear();
    if (this.player && typeof this.player.destroy === "function") {
      this.player.destroy();
    }
    this.player = null;
  }
}

// ─── Phase 3.3: Mock Implementation (for testing only) ───────────────────────

export class MockYouTubePlayerAdapter implements YouTubePlayerAdapter {
  private currentState: PlayerState = "UNSTARTED";
  private stateListeners: Set<(state: PlayerState) => void> = new Set();
  public currentVideoId: string = "";
  public initializeCalled = false;
  public destroyCalled = false;

  async initialize(_container: HTMLElement, videoId: string): Promise<void> {
    this.initializeCalled = true;
    this.currentVideoId = videoId;
  }

  async loadVideo(videoId: string): Promise<void> {
    this.currentVideoId = videoId;
    this._emitState("PLAYING");
  }

  async play(): Promise<void> {
    this._emitState("PLAYING");
  }

  async pause(): Promise<void> {
    this._emitState("PAUSED");
  }

  mute(): void { /* no-op in mock */ }
  unMute(): void { /* no-op in mock */ }
  setVolume(_volume: number): void { /* no-op in mock */ }
  seekTo(_seconds: number): void { /* no-op in mock */ }
  getCurrentTime(): number { return 0; }
  getDuration(): number { return 0; }

  getState(): PlayerState {
    return this.currentState;
  }

  onStateChange(callback: (state: PlayerState) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  destroy(): void {
    this.destroyCalled = true;
    this.stateListeners.clear();
  }

  /** Test helper: simulate a song ending naturally. */
  simulateSongEnd(): void {
    this._emitState("ENDED");
  }

  /** Test helper: simulate a video error (private/deleted video). */
  simulateError(): void {
    this._emitState("ERROR" as PlayerState);
  }

  private _emitState(state: PlayerState): void {
    this.currentState = state;
    this.stateListeners.forEach((cb) => cb(state));
  }
}