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
import type { AudioPlayerAdapter, PlayerState, StreamCandidateSource } from "./types";
import { fetchPipedStream, reportStreamFailure } from "../piped/piped-client";
import { extractDurationFromUrl } from "../piped/stream-selector";
import { updateMediaSessionPositionState } from "../media-session";

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
  private isPriming = false;
  private currentVideoId: string | null = null;
  private currentProxyUrl: string | null = null;
  private hasEndedEmitted = false;

  // Immediate recovery watchdog and multi-source failover hierarchy
  private recoveryTimer: any = null;
  private currentCandidates: Array<{ url: string; type: string }> = [];
  private currentCandidateIndex = 0;
  private hasTriedFreshExtraction = false;

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

  private _clearRecoveryWatchdog(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /**
   * Checks if a given song is currently active and resolved in the primary audio pipeline.
   */
  isSongLoaded(videoId: string): boolean {
    return (
      this.currentVideoId === videoId &&
      !!this.primaryAudio?.src &&
      !this.primaryAudio.src.startsWith("data:")
    );
  }

  /**
   * Synchronously primes both primary and secondary audio elements on user touch/click.
   * This permanently unlocks WebKit autoplay restrictions on iOS Safari across
   * all subsequent asynchronous stream resolution fetches and background transitions.
   */
  primeAudio(): void {
    if (this.hasUserInteracted) return;
    this.hasUserInteracted = true;
    this.isPriming = true;
    const silentSrc =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

    try {
      [this.primaryAudio, this.secondaryAudio].forEach((audio) => {
        if (!audio) return;
        if (!audio.src || audio.src.startsWith("data:")) {
          audio.src = silentSrc;
          const p = audio.play();
          if (p !== undefined) {
            p.then(() => {
              // Only pause if source is still the silent priming data URI
              if (audio.src.startsWith("data:")) {
                audio.pause();
              }
            }).catch(() => {
              /* ignore priming abort */
            });
          }
        }
      });
    } finally {
      setTimeout(() => {
        this.isPriming = false;
      }, 50);
    }
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

    const onPlay = () => {
      if (this.isPriming) return;
      this._emitState("PLAYING");
    };
    const onPlaying = () => {
      if (this.isPriming) return;
      this._clearRecoveryWatchdog();
      this._emitState("PLAYING");
      const dur = this.getDuration() || audio.duration;
      if (Number.isFinite(dur) && dur > 0) {
        this._emitProgress(audio.currentTime, dur);
        updateMediaSessionPositionState(audio.currentTime, dur, audio.playbackRate || 1);
      }
    };
    const onCanPlay = () => {
      if (this.isPriming) return;
      this._clearRecoveryWatchdog();
      if (this.currentState === "BUFFERING" || this.currentState === "UNSTARTED") {
        this._emitState("PLAYING");
      }
    };
    const onPause = () => {
      // Avoid emitting PAUSED if track just ended or if hardware is silently priming
      if (this.isPriming || audio.ended || this.hasEndedEmitted) return;
      this._emitState("PAUSED");
      const dur = this.getDuration() || audio.duration;
      if (Number.isFinite(dur) && dur > 0) {
        updateMediaSessionPositionState(audio.currentTime, dur, 0);
      }
    };
    const onWaiting = () => {
      if (this.isPriming) return;
      this._emitState("BUFFERING");
    };
    const onEnded = () => {
      if (this.isPriming || this.hasEndedEmitted) return;
      this._clearRecoveryWatchdog();
      this.hasEndedEmitted = true;
      this._emitState("ENDED");
    };
    const onError = async () => {
      // If a newer load request is active or audio element was reset, ignore stale errors
      if (this.isPriming || this.activeAbortController?.signal.aborted || this.isDestroyed) return;
      // If user has not interacted yet, or error is MEDIA_ERR_ABORTED (code 1), ignore
      if (!this.hasUserInteracted || audio.error?.code === 1) return;
      console.warn(`[Html5AudioAdapter] Audio error encountered for ${this.currentVideoId}:`, audio.error);
      this._clearRecoveryWatchdog();

      // Trigger immediate failover to next candidate source (Constraint 3)
      if (this.currentCandidates && this.currentCandidateIndex < this.currentCandidates.length - 1) {
        const curCandidate = this.currentCandidates[this.currentCandidateIndex];
        if (curCandidate?.type.includes("direct") && this.currentVideoId) {
          reportStreamFailure(this.currentVideoId, "direct");
        }
        const curPos = audio.currentTime || 0;
        await this._attemptPlayCandidate(this.currentVideoId!, this.activeRequestId, this.currentCandidateIndex + 1, curPos);
        return;
      }

      this._emitState("ERROR");
    };

    const onTimeUpdate = () => {
      const dur = this.getDuration() || audio.duration;
      const cur = audio.currentTime;
      if (Number.isFinite(dur) && dur > 0 && Number.isFinite(cur)) {
        this._emitProgress(cur, dur);
        updateMediaSessionPositionState(cur, dur, audio.playbackRate || 1);
        // If authoritative duration is known, end song when within 0.4s of the end
        // to prevent iOS Safari CoreAudio from playing 5 minutes of trailing silence!
        if (this.streamDuration && cur >= this.streamDuration - 0.4 && !audio.paused && !audio.ended && !this.hasEndedEmitted) {
          onEnded();
        }
      }
    };

    const onMetadata = () => {
      const dur = this.getDuration() || audio.duration;
      const cur = audio.currentTime;
      if (Number.isFinite(dur) && dur > 0) {
        this._emitProgress(Number.isFinite(cur) ? cur : 0, dur);
        updateMediaSessionPositionState(Number.isFinite(cur) ? cur : 0, dur, audio.playbackRate || 1);
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("loadeddata", onCanPlay);
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
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("loadeddata", onCanPlay);
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

    // Reset completion emission flag for newly requested song
    this.hasEndedEmitted = false;
    this._clearRecoveryWatchdog();

    // 1. Cancel any in-flight background preload so it does not contend with live playback
    if (this.preloadAbortController) {
      try {
        this.preloadAbortController.abort("Playback track load started");
      } catch {
        /* ignore */
      }
      this.preloadAbortController = null;
    }

    // 2. Cancel previous load request if in flight
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort("Superseded by new track selection");
      } catch {
        /* ignore */
      }
      this.activeAbortController = null;
    }

    const requestId = ++this.activeRequestId;
    const controller = new AbortController();
    this.activeAbortController = controller;

    // Check if the secondary audio element already has this song pre-buffered or has a resolved src
    if (
      this.preloadedSongId === videoId &&
      this.secondaryAudio &&
      this.secondaryAudio.src
    ) {
      this.hasEndedEmitted = false;
      // Instant seamless handoff! Swap primary and secondary
      const oldPrimary = this.primaryAudio;
      const newPrimary = this.secondaryAudio;

      this.primaryAudio = newPrimary;
      this.secondaryAudio = oldPrimary;
      this.preloadedSongId = null;
      this.currentVideoId = videoId;
      this.streamDuration = extractDurationFromUrl(this.primaryAudio.src);

      // Rebind events for the active primary
      this.cleanupFns.forEach((fn) => fn());
      this.cleanupFns = [];
      this._bindAudioEvents(this.primaryAudio);
      this._applyVolume(this.primaryAudio);

      this._emitState("PLAYING");
      // Start new audio first to maintain continuous audio session on iOS/Android lockscreen
      await this.primaryAudio.play();

      if (this.streamDuration && this.streamDuration > 0) {
        updateMediaSessionPositionState(0, this.streamDuration, 1);
      }

      // Only after new audio has started playing, clean up the previous audio element
      if (oldPrimary) {
        oldPrimary.pause();
        oldPrimary.removeAttribute("src");
        oldPrimary.load();
      }
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
      this.currentVideoId = videoId;
      this.currentProxyUrl = stream.proxy_url || null;
      this.hasTriedFreshExtraction = false;
      this.streamDuration = stream.duration ?? extractDurationFromUrl(stream.url) ?? null;

      // Build candidate sources in priority order (Constraint 3)
      const candidates: Array<{ url: string; type: string }> = [];

      // If backend already marked stream as DEGRADED (direct is IP-bound or confirmed 403),
      // place verified proxy FIRST so user experiences 0 delay!
      if (stream.status === "DEGRADED" && stream.proxy_url) {
        candidates.push({ url: stream.proxy_url, type: "proxy" });
        if (stream.direct_url && stream.direct_url !== stream.proxy_url) {
          candidates.push({ url: stream.direct_url, type: "direct" });
        }
      } else {
        if (stream.url) {
          candidates.push({ url: stream.url, type: stream.status === "DEGRADED" ? "proxy" : "direct" });
        }
        if (stream.proxy_url && stream.proxy_url !== stream.url) {
          candidates.push({ url: stream.proxy_url, type: "proxy" });
        }
      }

      // Add extra candidates from sources if available
      if (Array.isArray(stream.sources)) {
        for (const s of stream.sources) {
          if (s.url && !candidates.some((c) => c.url === s.url)) {
            candidates.push({ url: s.url, type: s.type || "fallback" });
          }
        }
      }

      this.currentCandidates = candidates.length > 0 ? candidates : [{ url: stream.url, type: "direct" }];
      this.currentCandidateIndex = 0;

      await this._attemptPlayCandidate(videoId, requestId, 0, 0);
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

  private async _attemptPlayCandidate(
    videoId: string,
    requestId: number,
    candidateIdx: number,
    resumePos: number = 0
  ): Promise<void> {
    if (this.activeRequestId !== requestId || this.isDestroyed) return;
    this._clearRecoveryWatchdog();

    if (!this.primaryAudio) return;

    if (candidateIdx >= this.currentCandidates.length) {
      // Last resort: Forced fresh extraction through another instance (Constraint 3)
      if (!this.hasTriedFreshExtraction) {
        this.hasTriedFreshExtraction = true;
        console.warn(`[Html5AudioAdapter] All cached sources failed for ${videoId}. Attempting forced upstream fresh extraction...`);
        try {
          const fresh = await fetchPipedStream(videoId, this.primaryAudio, undefined, true);
          if (this.activeRequestId === requestId && fresh?.url) {
            this.currentCandidates = [
              { url: fresh.url, type: fresh.status === "DEGRADED" ? "fresh_proxy" : "fresh_direct" },
            ];
            if (fresh.proxy_url && fresh.proxy_url !== fresh.url) {
              this.currentCandidates.push({ url: fresh.proxy_url, type: "fresh_proxy" });
            }
            return this._attemptPlayCandidate(videoId, requestId, 0, resumePos);
          }
        } catch {
          /* ignore */
        }
      }
      this._clearRecoveryWatchdog();
      this._emitState("ERROR");
      return;
    }

    this.currentCandidateIndex = candidateIdx;
    const candidate = this.currentCandidates[candidateIdx];
    this.primaryAudio.src = candidate.url;
    this.primaryAudio.preload = "auto";
    this._applyVolume(this.primaryAudio);

    if (resumePos > 0) {
      try {
        this.primaryAudio.currentTime = resumePos;
      } catch {
        /* ignore */
      }
    }

    if (this.streamDuration && this.streamDuration > 0) {
      updateMediaSessionPositionState(resumePos, this.streamDuration, 1);
    }

    // Schedule Immediate Recovery Watchdog (Constraint 3)
    // 1.8s for direct streams (to catch 403 / stalls before browser 15s retry loop), 2.8s for proxy streams
    const deadlineMs = candidate.type.includes("direct") ? 1800 : 2800;
    this.recoveryTimer = setTimeout(() => {
      if (this.activeRequestId !== requestId || this.isDestroyed) return;
      if (this.primaryAudio && !this.primaryAudio.paused && (this.primaryAudio.currentTime > 0 || this.currentState === "PLAYING")) {
        return; // successfully playing
      }
      console.warn(
        `[Html5AudioAdapter] Source ${candidate.type} exceeded ${deadlineMs}ms readiness deadline for ${videoId}. Auto-recovering to next candidate...`
      );
      if (candidate.type.includes("direct")) {
        reportStreamFailure(videoId, "direct");
      }
      const curPos = this.primaryAudio?.currentTime || resumePos;
      this._attemptPlayCandidate(videoId, requestId, candidateIdx + 1, curPos);
    }, deadlineMs);

    try {
      await this.primaryAudio.play();
      if (this.activeRequestId === requestId && !this.isDestroyed) {
        this._emitState("PLAYING");
      }
    } catch (playErr: any) {
      this._clearRecoveryWatchdog();
      if (playErr?.name === "NotAllowedError") {
        console.warn("[Html5AudioAdapter] Autoplay restricted by browser, waiting for user gesture:", playErr);
        this._emitState("PAUSED");
        return;
      }
      if (candidate.type.includes("direct")) {
        reportStreamFailure(videoId, "direct");
      }
      await this._attemptPlayCandidate(videoId, requestId, candidateIdx + 1, resumePos);
    }
  }

  /**
   * Attempts automatic recovery for a stalled or failed stream, preserving playback position.
   */
  async recoverPlayback(videoId: string, lastPosition: number = 0): Promise<boolean> {
    if (!videoId || this.isDestroyed) return false;
    try {
      this._emitState("BUFFERING");
      const stream = await fetchPipedStream(videoId, this.primaryAudio);
      if (!this.primaryAudio) return false;
      this.primaryAudio.src = stream.url;
      if (lastPosition > 0) {
        try {
          this.primaryAudio.currentTime = lastPosition;
        } catch {
          /* ignore */
        }
      }
      await this.primaryAudio.play();
      this._emitState("PLAYING");
      return true;
    } catch (err) {
      console.warn(`[Html5AudioAdapter] Recovery failed for ${videoId}:`, err);
      this._emitState("ERROR");
      return false;
    }
  }

  async preloadNextSong(song: Song): Promise<void> {
    if (!song?.youtube_video_id || !this.secondaryAudio) return;
    if (this.preloadedSongId === song.youtube_video_id) return; // already preloaded
    if (this.currentState === "BUFFERING") return; // do not compete during active track load

    if (this.preloadAbortController) {
      try {
        this.preloadAbortController.abort("Preload superseded by new track");
      } catch {
        /* ignore */
      }
      this.preloadAbortController = null;
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
    this._clearRecoveryWatchdog();
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort("Adapter destroyed");
      } catch {
        /* ignore */
      }
      this.activeAbortController = null;
    }
    if (this.preloadAbortController) {
      try {
        this.preloadAbortController.abort("Adapter destroyed");
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
    this.stateListeners.forEach((cb) => {
      try {
        cb(state);
      } catch (err) {
        console.warn("[Html5AudioAdapter] Error in state listener:", err);
      }
    });
  }
}
