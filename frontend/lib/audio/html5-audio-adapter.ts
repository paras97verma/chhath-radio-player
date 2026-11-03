/**
 * Production HTML5 Audio Adapter with Dual-Pipeline Pre-Buffering
 *
 * Implements the AudioPlayerAdapter interface using native HTML5 <audio> elements.
 * Features:
 * - Primary audio element for active playback
 * - Secondary audio element for pre-buffering upcoming songs (prevents gaps and mobile sleep)
 * - Automatic codec negotiation via PipedClient
 * - Event forwarding to Zustand store (PLAYING, PAUSED, BUFFERING, ENDED, ERROR)
 */

import type { Song } from "../api";
import type { AudioPlayerAdapter, PlayerState } from "./types";
import { fetchPipedStream } from "../piped/piped-client";
import { extractDurationFromUrl } from "../piped/stream-selector";

export class Html5AudioAdapter implements AudioPlayerAdapter {
  private primaryAudio: HTMLAudioElement | null = null;
  private secondaryAudio: HTMLAudioElement | null = null;
  private currentState: PlayerState = "UNSTARTED";
  private stateListeners: Set<(state: PlayerState) => void> = new Set();
  private progressListeners: Set<(currentTime: number, duration: number) => void> = new Set();
  private preloadedSongId: string | null = null;
  private isDestroyed = false;
  private isMuted = false;
  private volumeLevel = 80; // 0-100

  // Authoritative duration tracking & user gesture priming
  private streamDuration: number | null = null;
  private hasUserInteracted = false;

  // Request sequencing and cooperative cancellation
  private activeRequestId = 0;
  private activeAbortController: AbortController | null = null;
  private preloadAbortController: AbortController | null = null;

  // Active event listener cleanup callbacks
  private cleanupFns: Array<() => void> = [];

  constructor(primary?: HTMLAudioElement, secondary?: HTMLAudioElement) {
    if (primary) this.primaryAudio = primary;
    if (secondary) this.secondaryAudio = secondary;
  }

  /**
   * Synchronously primes both primary and secondary audio elements on user touch/click.
   * This permanently unlocks WebKit autoplay restrictions on iOS Safari across
   * all subsequent asynchronous stream resolution fetches and background transitions.
   */
  primeAudio(): void {
    this.hasUserInteracted = true;
    const silentSrc =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

    [this.primaryAudio, this.secondaryAudio].forEach((audio) => {
      if (!audio) return;
      if (!audio.src) {
        audio.src = silentSrc;
        const p = audio.play();
        if (p !== undefined) {
          p.then(() => {
            audio.pause();
          }).catch(() => {
            /* ignore priming abort */
          });
        }
      }
    });
  }

  async initialize(container: HTMLElement | null, initial?: Song | string): Promise<void> {
    if (this.isDestroyed) return;

    // Attach or look up DOM audio elements
    if (typeof document !== "undefined") {
      if (!this.primaryAudio) {
        this.primaryAudio =
          (document.getElementById("chhath-audio-primary") as HTMLAudioElement) ||
          document.createElement("audio");
        this.primaryAudio.id = "chhath-audio-primary";
      }
      if (!this.secondaryAudio) {
        this.secondaryAudio =
          (document.getElementById("chhath-audio-secondary") as HTMLAudioElement) ||
          document.createElement("audio");
        this.secondaryAudio.id = "chhath-audio-secondary";
      }

      this.primaryAudio.preload = "none";
      this.primaryAudio.setAttribute("playsinline", "true");
      this.secondaryAudio.preload = "none";
      this.secondaryAudio.setAttribute("playsinline", "true");

      // If elements are not yet mounted in container or document body, attach them
      if (container) {
        if (!this.primaryAudio.parentElement) container.appendChild(this.primaryAudio);
        if (!this.secondaryAudio.parentElement) container.appendChild(this.secondaryAudio);
      }
    }

    this._bindAudioEvents(this.primaryAudio);
    this._applyVolume(this.primaryAudio);
    this._applyVolume(this.secondaryAudio);

    // Warm up initial song metadata in cache if provided (without assigning unprimed src on mobile)
    const videoId = typeof initial === "string" ? initial : initial?.youtube_video_id;
    if (videoId) {
      try {
        const stream = await fetchPipedStream(videoId, this.primaryAudio);
        if (stream.duration) {
          this.streamDuration = stream.duration;
        }
      } catch (err) {
        console.warn("[Html5AudioAdapter] Could not pre-warm initial song stream:", err);
      }
    }
  }

  private _bindAudioEvents(audio: HTMLAudioElement | null) {
    if (!audio) return;

    const onPlay = () => this._emitState("PLAYING");
    const onPlaying = () => {
      this._emitState("PLAYING");
      const dur = this.getDuration() || audio.duration;
      if (Number.isFinite(dur) && dur > 0) {
        this._emitProgress(audio.currentTime, dur);
      }
    };
    const onPause = () => {
      // Avoid emitting PAUSED if track just ended
      if (audio.ended) return;
      this._emitState("PAUSED");
    };
    const onWaiting = () => this._emitState("BUFFERING");
    const onEnded = () => this._emitState("ENDED");
    const onError = () => {
      // If a newer load request is active or audio element was reset, ignore stale errors
      if (this.activeAbortController?.signal.aborted || this.isDestroyed) return;
      // If user has not interacted yet, or error is MEDIA_ERR_ABORTED (code 1), ignore
      if (!this.hasUserInteracted || audio.error?.code === 1) return;
      console.warn("[Html5AudioAdapter] Audio playback error:", audio.error);
      this._emitState("ERROR");
    };

    const onTimeUpdate = () => {
      const dur = this.getDuration() || audio.duration;
      const cur = audio.currentTime;
      if (Number.isFinite(dur) && dur > 0 && Number.isFinite(cur)) {
        this._emitProgress(cur, dur);
        // If authoritative duration is known, end song when within 0.4s of the end
        // to prevent iOS Safari CoreAudio from playing 5 minutes of trailing silence!
        if (this.streamDuration && cur >= this.streamDuration - 0.4 && !audio.paused && !audio.ended) {
          onEnded();
        }
      }
    };

    const onMetadata = () => {
      const dur = this.getDuration() || audio.duration;
      const cur = audio.currentTime;
      if (Number.isFinite(dur) && dur > 0) {
        this._emitProgress(Number.isFinite(cur) ? cur : 0, dur);
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("durationchange", onMetadata);
    audio.addEventListener("seeked", onTimeUpdate);

    this.cleanupFns.push(() => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("durationchange", onMetadata);
      audio.removeEventListener("seeked", onTimeUpdate);
    });
  }

  private _applyVolume(audio: HTMLAudioElement | null) {
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, this.volumeLevel / 100));
    audio.muted = this.isMuted;
  }

  async loadSong(song: Song): Promise<void> {
    const videoId = song.youtube_video_id;
    await this.loadVideo(videoId);
  }

  async loadVideo(videoId: string): Promise<void> {
    if (!videoId) return;

    // 1. Cancel any in-flight background preload so it does not contend with live playback
    if (this.preloadAbortController) {
      try {
        this.preloadAbortController.abort();
      } catch {
        /* ignore */
      }
      this.preloadAbortController = null;
    }

    // 2. Cancel previous load request if in flight
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch {
        /* ignore */
      }
      this.activeAbortController = null;
    }

    const requestId = ++this.activeRequestId;
    const controller = new AbortController();
    this.activeAbortController = controller;

    // Check if the secondary audio element already has this song pre-buffered
    if (
      this.preloadedSongId === videoId &&
      this.secondaryAudio &&
      this.secondaryAudio.src &&
      this.secondaryAudio.readyState >= 2 // HAVE_CURRENT_DATA or higher
    ) {
      // Instant seamless handoff! Swap primary and secondary
      const oldPrimary = this.primaryAudio;
      const newPrimary = this.secondaryAudio;

      if (oldPrimary) {
        oldPrimary.pause();
        oldPrimary.removeAttribute("src");
        oldPrimary.load();
      }

      this.primaryAudio = newPrimary;
      this.secondaryAudio = oldPrimary;
      this.preloadedSongId = null;
      this.streamDuration = extractDurationFromUrl(this.primaryAudio.src);

      // Rebind events for the active primary
      this.cleanupFns.forEach((fn) => fn());
      this.cleanupFns = [];
      this._bindAudioEvents(this.primaryAudio);
      this._applyVolume(this.primaryAudio);

      this._emitState("PLAYING");
      await this.primaryAudio.play();
      return;
    }

    // Standard resolution path
    this._emitState("BUFFERING");
    try {
      const stream = await fetchPipedStream(videoId, this.primaryAudio, controller.signal);

      // Check if superseded or destroyed while fetching
      if (this.activeRequestId !== requestId || this.isDestroyed || controller.signal.aborted) {
        return;
      }

      if (!this.primaryAudio) throw new Error("Audio element not initialized");

      this.hasUserInteracted = true;
      this.streamDuration = stream.duration ?? extractDurationFromUrl(stream.url) ?? null;
      this.primaryAudio.src = stream.url;
      this.primaryAudio.preload = "auto";
      this._applyVolume(this.primaryAudio);

      try {
        await this.primaryAudio.play();
        if (this.activeRequestId === requestId && !this.isDestroyed) {
          this._emitState("PLAYING");
        }
      } catch (playErr: any) {
        if (playErr?.name === "NotAllowedError") {
          console.warn("[Html5AudioAdapter] Autoplay restricted by browser, waiting for user gesture:", playErr);
          this._emitState("PAUSED");
          return;
        }
        throw playErr;
      }
    } catch (err: any) {
      // If request was aborted by user switching tracks or superseded by a newer request, suppress error
      if (err?.name === "AbortError" || this.activeRequestId !== requestId || this.isDestroyed) {
        return;
      }
      console.error(`[Html5AudioAdapter] Failed to play video ${videoId}:`, err);
      this._emitState("ERROR");
      throw err;
    }
  }

  async preloadNextSong(song: Song): Promise<void> {
    if (!song?.youtube_video_id || !this.secondaryAudio) return;
    if (this.preloadedSongId === song.youtube_video_id) return; // already preloaded
    if (this.currentState === "BUFFERING") return; // do not compete during active track load

    if (this.preloadAbortController) {
      try {
        this.preloadAbortController.abort();
      } catch {
        /* ignore */
      }
    }
    const controller = new AbortController();
    this.preloadAbortController = controller;

    try {
      const stream = await fetchPipedStream(song.youtube_video_id, this.secondaryAudio, controller.signal);
      if (controller.signal.aborted || this.isDestroyed) return;

      if (this.secondaryAudio) {
        this.secondaryAudio.src = stream.url;
        this.secondaryAudio.preload = "auto";
        this.preloadedSongId = song.youtube_video_id;
      }
    } catch {
      // Safely swallow all preload errors/aborts so no unhandled rejections reach the console/overlay
    }
  }

  async play(): Promise<void> {
    if (this.primaryAudio) {
      try {
        await this.primaryAudio.play();
        this._emitState("PLAYING");
      } catch (err) {
        console.warn("[Html5AudioAdapter] Play was prevented by browser policy:", err);
        throw err;
      }
    }
  }

  async pause(): Promise<void> {
    if (this.primaryAudio) {
      this.primaryAudio.pause();
      this._emitState("PAUSED");
    }
  }

  mute(): void {
    this.isMuted = true;
    if (this.primaryAudio) this.primaryAudio.muted = true;
    if (this.secondaryAudio) this.secondaryAudio.muted = true;
  }

  unMute(): void {
    this.isMuted = false;
    if (this.primaryAudio) this.primaryAudio.muted = false;
    if (this.secondaryAudio) this.secondaryAudio.muted = false;
  }

  setVolume(volume: number): void {
    this.volumeLevel = Math.max(0, Math.min(100, volume));
    this._applyVolume(this.primaryAudio);
    this._applyVolume(this.secondaryAudio);
  }

  seekTo(seconds: number): void {
    if (this.primaryAudio && Number.isFinite(seconds)) {
      this.primaryAudio.currentTime = Math.max(0, seconds);
      const dur = this.getDuration();
      if (Number.isFinite(dur) && dur > 0) {
        this._emitProgress(this.primaryAudio.currentTime, dur);
      }
    }
  }

  getCurrentTime(): number {
    return this.primaryAudio?.currentTime || 0;
  }

  getDuration(): number {
    if (this.streamDuration && Number.isFinite(this.streamDuration) && this.streamDuration > 0) {
      return this.streamDuration;
    }
    return this.primaryAudio?.duration && !isNaN(this.primaryAudio.duration)
      ? this.primaryAudio.duration
      : 0;
  }

  getState(): PlayerState {
    return this.currentState;
  }

  onStateChange(callback: (state: PlayerState) => void): () => void {
    this.stateListeners.add(callback);
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  onProgress(callback: (currentTime: number, duration: number) => void): () => void {
    this.progressListeners.add(callback);
    return () => {
      this.progressListeners.delete(callback);
    };
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch {
        /* ignore */
      }
      this.activeAbortController = null;
    }
    if (this.preloadAbortController) {
      try {
        this.preloadAbortController.abort();
      } catch {
        /* ignore */
      }
      this.preloadAbortController = null;
    }
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    this.stateListeners.clear();
    this.progressListeners.clear();

    if (this.primaryAudio) {
      this.primaryAudio.pause();
      this.primaryAudio.removeAttribute("src");
      this.primaryAudio.load();
      this.primaryAudio = null;
    }

    if (this.secondaryAudio) {
      this.secondaryAudio.pause();
      this.secondaryAudio.removeAttribute("src");
      this.secondaryAudio.load();
      this.secondaryAudio = null;
    }
  }

  private _emitProgress(currentTime: number, duration: number): void {
    this.progressListeners.forEach((cb) => {
      try {
        cb(currentTime, duration);
      } catch (err) {
        console.warn("[Html5AudioAdapter] Error in progress listener:", err);
      }
    });
  }

  private _emitState(state: PlayerState): void {
    this.currentState = state;
    this.stateListeners.forEach((cb) => cb(state));
  }
}
