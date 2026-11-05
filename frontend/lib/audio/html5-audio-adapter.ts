/**
 * Production HTML5 Audio Adapter with Dual-Pipeline Pre-Buffering
 *
 * Implements the AudioPlayerAdapter interface using native HTML5 <audio> elements.
 * Features:
 * - Primary audio element for active playback
 * - Secondary audio element for pre-buffering upcoming songs (prevents gaps and mobile sleep)
 * - Audio format selection from current Invidious metadata
 * - Event forwarding to Zustand store (PLAYING, PAUSED, BUFFERING, ENDED, ERROR)
 */

import type { Song } from "../api";
import type { AudioPlayerAdapter, AudioStreamInfo, PlayerState } from "./types";
import { fetchInvidiousStream, reportStreamFailure } from "../piped/piped-client";
import {
  extractDurationFromUrl,
  isCurrentCanonicalSource,
  isMimeTypeSupportedByAudioElement,
} from "../piped/stream-selector";
import { updateMediaSessionPositionState } from "../media-session";

type ActivePlaybackAttempt = {
  id: number;
  requestId: number;
  candidateIndex: number;
  mode: "direct" | "proxy";
  providerOrigin?: string;
  generation?: number;
  url: string;
  ready: boolean;
  hasProgress: boolean;
  waiting: boolean;
  lastProgressTime: number;
};

type PlaybackCandidate = {
  url: string;
  type: string;
  mode?: "direct" | "proxy";
  providerOrigin?: string;
  generation?: number;
  mimeType?: string;
};

type PreparedPlaybackSource = {
  videoId: string;
  stream: AudioStreamInfo;
};

type RecoveryEpisode = {
  requestId: number;
  deadlineAt: number;
  retriesUsed: number;
};

export class Html5AudioAdapter implements AudioPlayerAdapter {
  private primaryAudio: HTMLAudioElement | null = null;
  private secondaryAudio: HTMLAudioElement | null = null;
  private currentState: PlayerState = "UNSTARTED";
  private stateListeners: Set<(state: PlayerState) => void> = new Set();
  private progressListeners: Set<(currentTime: number, duration: number) => void> = new Set();
  private preparedStream: PreparedPlaybackSource | null = null;
  private initialWarmupPromise: Promise<AudioStreamInfo> | null = null;
  private initialWarmupVideoId: string | null = null;
  private initialWarmupController: AbortController | null = null;
  private preloadedSongId: string | null = null;
  /** True only after the secondary element has fired canplay or progress (not just src assignment). */
  private preloadedSongReady = false;
  private preloadCleanupFns: Array<() => void> = [];
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

  // Per-attempt readiness/progress state and bounded recovery timers
  private firstProgressTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptSequence = 0;
  private activeAttempt: ActivePlaybackAttempt | null = null;
  private recoveryEpisode: RecoveryEpisode | null = null;
  private episodeDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private episodeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private currentCandidates: PlaybackCandidate[] = [];
  private currentCandidateIndex = 0;

  // Request sequencing and cooperative cancellation
  private activeRequestId = 0;
  private activeAbortController: AbortController | null = null;
  private preloadAbortController: AbortController | null = null;
  private preloadingSongId: string | null = null;
  private latestRequestedVideoId: string | null = null;

  // Active event listener cleanup callbacks
  private cleanupFns: Array<() => void> = [];

  private _clearPreloadReadinessListeners(): void {
    this.preloadCleanupFns.forEach((cleanup) => cleanup());
    this.preloadCleanupFns = [];
  }

  private _discardPreloadedSource(): void {
    this._clearPreloadReadinessListeners();
    this.preparedStream = null;
    this.preloadedSongId = null;
    this.preloadedSongReady = false;
    if (this.secondaryAudio?.src) {
      this.secondaryAudio.removeAttribute("src");
      this.secondaryAudio.load();
    }
  }

  constructor(primary?: HTMLAudioElement, secondary?: HTMLAudioElement) {
    if (primary) this.primaryAudio = primary;
    if (secondary) this.secondaryAudio = secondary;
  }

  private _clearRecoveryWatchdog(): void {
    if (this.firstProgressTimer !== null) {
      clearTimeout(this.firstProgressTimer);
      this.firstProgressTimer = null;
    }
    if (this.stallTimer !== null) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  private _clearRecoveryEpisode(): void {
    if (this.episodeDeadlineTimer !== null) clearTimeout(this.episodeDeadlineTimer);
    if (this.episodeRetryTimer !== null) clearTimeout(this.episodeRetryTimer);
    this.episodeDeadlineTimer = null;
    this.episodeRetryTimer = null;
    this.recoveryEpisode = null;
  }

  private _startRecoveryEpisode(requestId: number): void {
    if (this.recoveryEpisode?.requestId === requestId && this.episodeDeadlineTimer !== null) return;
    this._clearRecoveryEpisode();
    const episode = { requestId, deadlineAt: Date.now() + 20_000, retriesUsed: 0 };
    this.recoveryEpisode = episode;
    this.episodeDeadlineTimer = setTimeout(() => {
      this._finishRecoveryEpisode(requestId);
    }, 20_000);
  }

  private _clearEpisodeAfterProgress(requestId: number): void {
    if (this.recoveryEpisode?.requestId === requestId) this._clearRecoveryEpisode();
  }

  private _reportAttemptFailure(videoId: string, attempt: ActivePlaybackAttempt, reason: string): void {
    if (!attempt.providerOrigin || !attempt.generation) return;
    void reportStreamFailure(videoId, attempt.mode, reason, {
      providerOrigin: attempt.providerOrigin,
      generation: attempt.generation,
    });
  }

  private _finishRecoveryEpisode(requestId: number): void {
    if (this.activeRequestId !== requestId || this.isDestroyed) return;
    this._clearRecoveryWatchdog();
    this._clearRecoveryEpisode();
    this.activeAttempt = null;
    this.activeRequestId += 1;
    this.activeAbortController?.abort("Playback recovery deadline reached");
    this._emitState("ERROR");
  }

  private _scheduleAutomaticRetry(videoId: string, requestId: number, resumePosition: number): void {
    this._startRecoveryEpisode(requestId);
    this._emitState("BUFFERING");
    const episode = this.recoveryEpisode;
    if (!episode || episode.retriesUsed >= 3) {
      this._finishRecoveryEpisode(requestId);
      return;
    }

    const delay = [1000, 2000, 4000][episode.retriesUsed++];
    if (Date.now() + delay >= episode.deadlineAt) return;
    this.episodeRetryTimer = setTimeout(async () => {
      this.episodeRetryTimer = null;
      const controller = this.activeAbortController;
      if (
        this.activeRequestId !== requestId ||
        this.isDestroyed ||
        this.recoveryEpisode !== episode ||
        controller?.signal.aborted
      ) {
        return;
      }

      try {
        const stream = await fetchInvidiousStream(videoId, this.primaryAudio, controller?.signal, true);
        if (
          this.activeRequestId !== requestId ||
          this.isDestroyed ||
          controller?.signal.aborted
        ) {
          return;
        }
        this.streamDuration = stream.duration ?? extractDurationFromUrl(stream.url) ?? null;
        this.currentProxyUrl = stream.proxy_url || null;
        this.currentCandidates = this._buildCandidates(stream);
        this.currentCandidateIndex = 0;
        if (this.currentCandidates.length === 0) {
          this._finishRecoveryEpisode(requestId);
          return;
        }
        await this._attemptPlayCandidate(videoId, requestId, 0, resumePosition);
      } catch (error: any) {
        if (this.activeRequestId !== requestId || this.isDestroyed || error?.name === "AbortError") return;
        this._scheduleAutomaticRetry(videoId, requestId, resumePosition);
      }
    }, delay);
  }

  private _buildCandidates(stream: AudioStreamInfo): PlaybackCandidate[] {
    const candidates: PlaybackCandidate[] = [];
    const seen = new Set<string>();
    for (const source of stream.sources || []) {
      if (
        !("mode" in source) ||
        !isCurrentCanonicalSource(source, Date.now() / 1000, stream.video_id) ||
        !isMimeTypeSupportedByAudioElement(this.primaryAudio, source.mime_type) ||
        seen.has(source.url)
      ) continue;
      seen.add(source.url);
      candidates.push({
        url: source.url,
        type: source.mode,
        mode: source.mode,
        providerOrigin: source.provider_origin,
        generation: stream.generation,
        mimeType: source.mime_type,
      });
    }
    candidates.sort((a, b) => (a.mode === "direct" ? -1 : 1) - (b.mode === "direct" ? -1 : 1));
    return candidates;
  }

  private _isCurrentAttempt(requestId: number, attemptId: number): boolean {
    return (
      !this.isDestroyed &&
      this.activeRequestId === requestId &&
      this.activeAttempt?.requestId === requestId &&
      this.activeAttempt.id === attemptId
    );
  }

  private _getCurrentMediaAttempt(audio: HTMLAudioElement): ActivePlaybackAttempt | null {
    const attempt = this.activeAttempt;
    const currentSource = audio.currentSrc || audio.src;
    if (
      !attempt ||
      audio !== this.primaryAudio ||
      attempt.requestId !== this.activeRequestId ||
      currentSource !== attempt.url
    ) {
      return null;
    }
    return attempt;
  }

  private _recordMediaProgress(audio: HTMLAudioElement): void {
    const attempt = this._getCurrentMediaAttempt(audio);
    if (
      !attempt ||
      attempt.requestId !== this.activeRequestId ||
      audio.paused ||
      audio.ended ||
      !Number.isFinite(audio.currentTime) ||
      audio.currentTime <= attempt.lastProgressTime + 0.01
    ) {
      return;
    }

    attempt.lastProgressTime = audio.currentTime;
    attempt.hasProgress = true;
    this._clearEpisodeAfterProgress(attempt.requestId);
    if (this.firstProgressTimer !== null) {
      clearTimeout(this.firstProgressTimer);
      this.firstProgressTimer = null;
    }
    if (attempt.waiting) {
      attempt.waiting = false;
      if (this.stallTimer !== null) {
        clearTimeout(this.stallTimer);
        this.stallTimer = null;
      }
    }
    if (this.currentState !== "PLAYING") this._emitState("PLAYING");
  }

  private _beginPlaybackAttempt(
    videoId: string,
    requestId: number,
    candidateIndex: number,
    url: string,
    candidateType: string,
    audio: HTMLAudioElement,
    resumePosition: number,
    candidate?: PlaybackCandidate,
  ): ActivePlaybackAttempt {
    const attempt: ActivePlaybackAttempt = {
      id: ++this.attemptSequence,
      requestId,
      candidateIndex,
      mode: candidateType.includes("proxy") ? "proxy" : "direct",
      providerOrigin: candidate?.providerOrigin,
      generation: candidate?.generation,
      url,
      ready: audio.readyState >= 3,
      hasProgress: false,
      waiting: false,
      lastProgressTime: resumePosition,
    };
    this.activeAttempt = attempt;
    this.firstProgressTimer = setTimeout(() => {
      this.firstProgressTimer = null;
      if (!this._isCurrentAttempt(requestId, attempt.id)) return;
      this._recordMediaProgress(audio);
      if (!this._isCurrentAttempt(requestId, attempt.id) || attempt.hasProgress) return;

      this._reportAttemptFailure(videoId, attempt, "first_progress_timeout");
      const currentPosition = attempt.hasProgress
        ? attempt.lastProgressTime
        : Number.isFinite(audio.currentTime)
          ? audio.currentTime
          : resumePosition;
      this._attemptPlayCandidate(videoId, requestId, candidateIndex + 1, currentPosition);
    }, 5000);
    return attempt;
  }

  private _startStallWatchdog(audio: HTMLAudioElement, attempt: ActivePlaybackAttempt): void {
    if (this.stallTimer !== null) return;
    const { requestId, id: attemptId, candidateIndex } = attempt;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (!this._isCurrentAttempt(requestId, attemptId)) return;

      this._recordMediaProgress(audio);
      if (!this._isCurrentAttempt(requestId, attemptId) || !attempt.waiting) return;
      const resumePosition = Number.isFinite(audio.currentTime)
        ? Math.max(audio.currentTime, attempt.lastProgressTime)
        : attempt.lastProgressTime;
      this._startRecoveryEpisode(requestId);
      this._emitState("BUFFERING");
      this._reportAttemptFailure(this.currentVideoId!, attempt, "stall_timeout");
      this._attemptPlayCandidate(
        this.currentVideoId!,
        requestId,
        candidateIndex + 1,
        resumePosition,
      );
    }, 5000);
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

    // Warm initial metadata in the background; player readiness must not wait on an upstream resolver.
    const videoId = typeof initial === "string" ? initial : initial?.youtube_video_id;
    if (videoId) {
      const controller = new AbortController();
      const warmup = fetchInvidiousStream(videoId, this.primaryAudio, controller.signal);
      this.initialWarmupPromise = warmup;
      this.initialWarmupVideoId = videoId;
      this.initialWarmupController = controller;
      void warmup
        .then((stream) => {
          if (
            this.isDestroyed ||
            this.latestRequestedVideoId !== null ||
            this.preparedStream !== null
          ) return;
          this.preparedStream = { videoId, stream };
          this.preloadedSongId = videoId;
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.warn("[Html5AudioAdapter] Could not pre-warm initial song stream:", err);
        })
        .finally(() => {
          if (this.initialWarmupPromise === warmup) {
            this.initialWarmupPromise = null;
            this.initialWarmupVideoId = null;
            this.initialWarmupController = null;
          }
        });
    }
  }

  private _bindAudioEvents(audio: HTMLAudioElement | null) {
    if (!audio) return;

    const onPlay = () => {
      if (this.isPriming) return;
    };
    const onPlaying = () => {
      if (this.isPriming) return;
      const attempt = this._getCurrentMediaAttempt(audio);
      if (this.hasUserInteracted && !attempt) return;
      if (attempt && this.currentState !== "PLAYING") this._emitState("PLAYING");
      this._recordMediaProgress(audio);
      const dur = this.getDuration() || audio.duration;
      if (Number.isFinite(dur) && dur > 0) {
        this._emitProgress(audio.currentTime, dur);
        updateMediaSessionPositionState(audio.currentTime, dur, audio.playbackRate || 1);
      }
    };
    const onCanPlay = () => {
      if (this.isPriming) return;
      const attempt = this._getCurrentMediaAttempt(audio);
      if (attempt) {
        attempt.ready = true;
      }
    };
    const onPause = () => {
      // Avoid emitting PAUSED if track just ended or if hardware is silently priming
      if (this.isPriming || !audio.paused || audio.ended || this.hasEndedEmitted) return;
      if (this.hasUserInteracted) {
        const attempt = this._getCurrentMediaAttempt(audio);
        if (!attempt?.hasProgress) return;
      }
      this._emitState("PAUSED");
      const dur = this.getDuration() || audio.duration;
      if (Number.isFinite(dur) && dur > 0) {
        updateMediaSessionPositionState(audio.currentTime, dur, 0);
      }
    };
    const onWaiting = () => {
      if (this.isPriming) return;
      const attempt = this._getCurrentMediaAttempt(audio);
      if (this.hasUserInteracted && !attempt) return;
      if (!this.hasUserInteracted) {
        this._emitState("BUFFERING");
      }
      if (attempt && !audio.paused && attempt.hasProgress) {
        attempt.waiting = true;
        this._startStallWatchdog(audio, attempt);
      }
    };
    const onEnded = () => {
      if (this.isPriming || this.hasEndedEmitted) return;
      const attempt = this._getCurrentMediaAttempt(audio);
      if (this.hasUserInteracted && !attempt?.hasProgress) return;
      this._clearRecoveryWatchdog();
      this._clearRecoveryEpisode();
      this.activeAttempt = null;
      this.hasEndedEmitted = true;
      this._emitState("ENDED");
    };
    const onError = async () => {
      // If a newer load request is active or audio element was reset, ignore stale errors
      if (this.isPriming || this.activeAbortController?.signal.aborted || this.isDestroyed) return;
      const attempt = this._getCurrentMediaAttempt(audio);
      if (!attempt) return;
      // If user has not interacted yet, or error is MEDIA_ERR_ABORTED (code 1), ignore
      if (!this.hasUserInteracted || audio.error?.code === 1) return;
      console.warn(`[Html5AudioAdapter] Audio error encountered for ${this.currentVideoId}:`, audio.error);
      this._clearRecoveryWatchdog();
      this._startRecoveryEpisode(attempt.requestId);

      // A failed direct source switches to the proxy immediately; retries happen after both modes fail.
      if (attempt.candidateIndex < this.currentCandidates.length - 1) {
        if (this.currentVideoId) {
          this._reportAttemptFailure(this.currentVideoId, attempt, "media_error");
        }
        const curPos = attempt.hasProgress ? attempt.lastProgressTime : audio.currentTime || 0;
        await this._attemptPlayCandidate(this.currentVideoId!, attempt.requestId, attempt.candidateIndex + 1, curPos);
        return;
      }

      this.activeAttempt = null;
      const resumePosition = attempt.hasProgress ? attempt.lastProgressTime : audio.currentTime || 0;
      this._scheduleAutomaticRetry(this.currentVideoId!, attempt.requestId, resumePosition);
    };

    const onTimeUpdate = () => {
      if (this.hasUserInteracted && !this._getCurrentMediaAttempt(audio)) return;
      const dur = this.getDuration() || audio.duration;
      const cur = audio.currentTime;
      this._recordMediaProgress(audio);
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
      const attempt = this._getCurrentMediaAttempt(audio);
      if (this.hasUserInteracted && !attempt) return;
      if (
        attempt?.requestId === this.activeRequestId &&
        !attempt.hasProgress &&
        Number.isFinite(audio.currentTime) &&
        audio.currentTime < attempt.lastProgressTime
      ) {
        // A source without usable range seeking starts at zero; measure progress from there.
        attempt.lastProgressTime = audio.currentTime;
      }
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
    audio.addEventListener("stalled", onWaiting);
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
      audio.removeEventListener("stalled", onWaiting);
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
    const initialWarmup = this.initialWarmupVideoId === videoId
      ? this.initialWarmupPromise
      : null;
    this.latestRequestedVideoId = videoId;
    const preparedStream = this.preparedStream?.videoId === videoId
      ? this.preparedStream.stream
      : null;
    if (preparedStream) this.preparedStream = null;

    if (this.initialWarmupVideoId && this.initialWarmupVideoId !== videoId) {
      this.initialWarmupController?.abort("Initial stream warmup no longer selected");
      this.initialWarmupPromise = null;
      this.initialWarmupVideoId = null;
      this.initialWarmupController = null;
    }

    // Reset completion emission flag for newly requested song
    this.hasEndedEmitted = false;
    this._clearRecoveryWatchdog();
    this._clearRecoveryEpisode();
    this.activeAttempt = null;

    // 1. Cancel any in-flight background preload so it does not contend with live playback
    if (this.preloadAbortController && this.preloadingSongId !== videoId) {
      try {
        this.preloadAbortController.abort("Playback track load started");
      } catch {
        /* ignore */
      }
      this.preloadAbortController = null;
      this.preloadingSongId = null;
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
    this._startRecoveryEpisode(requestId);

    // Check if the secondary audio element is ready (actual media readiness confirmed) for this song
    if (
      this.preloadedSongId === videoId &&
      this.preloadedSongReady &&
      this.secondaryAudio &&
      this.secondaryAudio.src &&
      preparedStream
    ) {
      const candidates = this._buildCandidates(preparedStream);
      const candidate = candidates[0];
      if (!candidate) {
        this._discardPreloadedSource();
      } else {
        this.hasEndedEmitted = false;
        // Instant seamless handoff! Swap primary and secondary
        const oldPrimary = this.primaryAudio;
        const newPrimary = this.secondaryAudio;

        this.primaryAudio = newPrimary;
        this.secondaryAudio = oldPrimary;
        this._clearPreloadReadinessListeners();
        this.preloadedSongId = null;
        this.preloadedSongReady = false;
        this.currentVideoId = videoId;
        this.currentProxyUrl = preparedStream.proxy_url || null;
        this.streamDuration = preparedStream.duration ?? extractDurationFromUrl(candidate.url) ?? null;
        this.hasUserInteracted = true;

        // Rebind events for the active primary
        this.cleanupFns.forEach((fn) => fn());
        this.cleanupFns = [];
        this._bindAudioEvents(this.primaryAudio);
        this._applyVolume(this.primaryAudio);

        this.currentCandidates = candidates;
        this.currentCandidateIndex = 0;
        const attempt = this._beginPlaybackAttempt(
          videoId,
          requestId,
          0,
          candidate.url,
          candidate.type,
          this.primaryAudio,
          this.primaryAudio.currentTime || 0,
          candidate,
        );
        this._emitState("BUFFERING");
        // Start new audio first to maintain continuous audio session on iOS/Android lockscreen
        try {
          await this.primaryAudio.play();
        } catch (playError: any) {
          if (!this._isCurrentAttempt(requestId, attempt.id)) return;
          this._clearRecoveryWatchdog();
          this.activeAttempt = null;
          if (playError?.name === "NotAllowedError") {
            this._clearRecoveryEpisode();
            this._emitState("PAUSED");
            return;
          }
          await this._attemptPlayCandidate(videoId, requestId, 1, this.primaryAudio.currentTime || 0);
          return;
        }
        if (!this._isCurrentAttempt(requestId, attempt.id)) return;

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
    }

    // If preload was ignored, discard its pending source and continue through the normal path.
    if (this.preloadedSongId === videoId) this._discardPreloadedSource();

    // Standard resolution path
    this._emitState("BUFFERING");
    try {
      let stream: AudioStreamInfo;
      if (preparedStream) {
        stream = preparedStream;
      } else if (initialWarmup) {
        try {
          stream = await initialWarmup;
        } catch {
          stream = await fetchInvidiousStream(videoId, this.primaryAudio, controller.signal);
        }
      } else {
        stream = await fetchInvidiousStream(videoId, this.primaryAudio, controller.signal);
      }

      // Check if superseded or destroyed while fetching
      if (this.activeRequestId !== requestId || this.isDestroyed || controller.signal.aborted) {
        return;
      }

      if (!this.primaryAudio) throw new Error("Audio element not initialized");

      let candidates = this._buildCandidates(stream);
      if (candidates.length === 0 && preparedStream) {
        stream = await fetchInvidiousStream(videoId, this.primaryAudio, controller.signal);
        if (this.activeRequestId !== requestId || this.isDestroyed || controller.signal.aborted) return;
        candidates = this._buildCandidates(stream);
      }

      this.hasUserInteracted = true;
      this.currentVideoId = videoId;
      this.currentProxyUrl = stream.proxy_url || null;
      this.streamDuration = stream.duration ?? extractDurationFromUrl(stream.url) ?? null;
      this.currentCandidates = candidates;
      this.currentCandidateIndex = 0;

      if (this.currentCandidates.length === 0) {
        this._finishRecoveryEpisode(requestId);
        return;
      }

      await this._attemptPlayCandidate(videoId, requestId, 0, 0);
    } catch (err: any) {
      // If request was aborted by user switching tracks or superseded by a newer request, suppress error
      if (err?.name === "AbortError" || this.activeRequestId !== requestId || this.isDestroyed) {
        return;
      }
      console.error(`[Html5AudioAdapter] Failed to play video ${videoId}:`, err);
      this._scheduleAutomaticRetry(videoId, requestId, 0);
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
      this.activeAttempt = null;
      this._clearRecoveryWatchdog();
      this._scheduleAutomaticRetry(videoId, requestId, resumePos);
      return;
    }

    this._emitState("BUFFERING");
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

    const attempt = this._beginPlaybackAttempt(
      videoId,
      requestId,
      candidateIdx,
      candidate.url,
      candidate.type,
      this.primaryAudio,
      resumePos,
      candidate,
    );

    try {
      await this.primaryAudio.play();
      if (!this._isCurrentAttempt(requestId, attempt.id)) return;
    } catch (playErr: any) {
      if (!this._isCurrentAttempt(requestId, attempt.id)) return;
      this._clearRecoveryWatchdog();
      this.activeAttempt = null;
      if (playErr?.name === "NotAllowedError") {
        this._clearRecoveryEpisode();
        console.warn("[Html5AudioAdapter] Autoplay restricted by browser, waiting for user gesture:", playErr);
        this._emitState("PAUSED");
        return;
      }
      this._reportAttemptFailure(videoId, attempt, "play_rejected");
      const currentPosition = Number.isFinite(this.primaryAudio.currentTime)
        ? this.primaryAudio.currentTime
        : resumePos;
      await this._attemptPlayCandidate(videoId, requestId, candidateIdx + 1, currentPosition);
    }
  }

  /**
   * Attempts automatic recovery for a stalled or failed stream, preserving playback position.
   */
  async recoverPlayback(videoId: string, lastPosition: number = 0): Promise<boolean> {
    if (!videoId || this.isDestroyed) return false;
    this._clearRecoveryEpisode();
    const requestId = ++this.activeRequestId;
    this.activeAbortController?.abort("Superseded by playback recovery");
    const controller = new AbortController();
    this.activeAbortController = controller;
    this._startRecoveryEpisode(requestId);
    try {
      this._emitState("BUFFERING");
      const stream = await fetchInvidiousStream(videoId, this.primaryAudio, controller.signal);
      if (!this.primaryAudio || this.activeRequestId !== requestId || this.isDestroyed || controller.signal.aborted) return false;
      this._clearRecoveryWatchdog();
      this.currentVideoId = videoId;
      this.streamDuration = stream.duration ?? extractDurationFromUrl(stream.url) ?? null;
      this.currentCandidates = this._buildCandidates(stream);
      this.currentCandidateIndex = 0;
      const candidate = this.currentCandidates[0];
      if (!candidate) {
        this._finishRecoveryEpisode(requestId);
        return false;
      }
      this.primaryAudio.src = candidate.url;
      if (lastPosition > 0) {
        try {
          this.primaryAudio.currentTime = lastPosition;
        } catch {
          /* ignore */
        }
      }
      const attempt = this._beginPlaybackAttempt(
        videoId,
        requestId,
        0,
        candidate.url,
        candidate.type,
        this.primaryAudio,
        lastPosition,
      );
      await this.primaryAudio.play();
      return this._isCurrentAttempt(requestId, attempt.id);
    } catch (err) {
      console.warn(`[Html5AudioAdapter] Recovery failed for ${videoId}:`, err);
      if (this.activeRequestId === requestId && !this.isDestroyed) {
        this._scheduleAutomaticRetry(videoId, requestId, lastPosition);
      }
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
      this.preloadingSongId = null;
    }
    this._discardPreloadedSource();
    const controller = new AbortController();
    this.preloadAbortController = controller;
    this.preloadingSongId = song.youtube_video_id;

    try {
      const stream = await fetchInvidiousStream(song.youtube_video_id, this.secondaryAudio, controller.signal);
      if (
        controller.signal.aborted ||
        this.isDestroyed ||
        this.latestRequestedVideoId === song.youtube_video_id
      ) return;

      const candidate = this._buildCandidates(stream)[0];
      if (!candidate) return;

      this.preparedStream = { videoId: song.youtube_video_id, stream };
      this.preloadedSongReady = false;
      this.preloadedSongId = song.youtube_video_id;

      const secondary = this.secondaryAudio;
      if (secondary) {
        const source = stream.sources?.find(
          (sourceCandidate) => "mode" in sourceCandidate && sourceCandidate.url === candidate.url,
        );
        if (!source || !("mode" in source) || !isMimeTypeSupportedByAudioElement(secondary, source.mime_type)) return;

        const videoId = song.youtube_video_id;
        // Mark ready after the browser confirms actual media data is available.
        const markReady = () => {
          if (this.preloadedSongId === videoId && !this.preloadedSongReady) {
            this.preloadedSongReady = true;
            this._clearPreloadReadinessListeners();
          }
        };
        const removeCanPlay = () => secondary.removeEventListener("canplay", markReady);
        const removeProgress = () => secondary.removeEventListener("progress", markReady);
        // Attach before src assignment so synchronous readiness events cannot be missed.
        secondary.addEventListener("canplay", markReady);
        secondary.addEventListener("progress", markReady);
        this.preloadCleanupFns = [removeCanPlay, removeProgress];
        secondary.src = candidate.url;
        secondary.preload = "auto";
      }
    } catch {
      // Safely swallow all preload errors/aborts so no unhandled rejections reach the console/overlay
    } finally {
      if (this.preloadAbortController === controller) {
        this.preloadAbortController = null;
        this.preloadingSongId = null;
      }
    }
  }

  async play(): Promise<void> {
    if (this.primaryAudio) {
      try {
        await this.primaryAudio.play();
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
    this._clearRecoveryEpisode();
    this.activeAttempt = null;
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
      this.preloadingSongId = null;
    }
    this.initialWarmupController?.abort("Adapter destroyed");
    this.initialWarmupController = null;
    this.initialWarmupPromise = null;
    this.initialWarmupVideoId = null;
    this._clearPreloadReadinessListeners();
    this.preparedStream = null;
    this.preloadedSongId = null;
    this.preloadedSongReady = false;
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
