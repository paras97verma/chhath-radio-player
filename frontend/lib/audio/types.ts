/**
 * Audio Engine Types and Interfaces
 *
 * Defines the contract between the audio playback subsystem and the rest of the application.
 * Supports native HTML5 audio with dual-pipeline pre-buffering as well as mock testing.
 */

import type { Song } from "../api";

export type PlayerState =
  | "UNSTARTED"
  | "ENDED"
  | "PLAYING"
  | "PAUSED"
  | "BUFFERING"
  | "CUED"
  | "ERROR";

export type StreamReadinessStatus =
  | "READY"
  | "DEGRADED"
  | "RESOLVING"
  | "VALIDATING"
  | "EXPIRED"
  | "FAILED";

export interface StreamCandidateSource {
  url: string;
  type: "direct" | "direct_alt" | "proxy" | "proxy_fallback" | "fallback";
  format?: string;
  mimeType?: string;
  bitrate?: number;
  expires_at?: number;
}

export interface AudioStreamInfo {
  url: string;
  direct_url?: string;
  proxy_url?: string;
  status?: StreamReadinessStatus;
  sources?: StreamCandidateSource[];
  format: string; // e.g. "WEBM_OPUS", "M4A"
  quality: string; // e.g. "160kbps", "128kbps"
  mimeType: string; // e.g. 'audio/webm; codecs="opus"', 'audio/mp4; codecs="mp4a.40.2"'
  codec: string;
  bitrate: number;
  duration?: number; // Authoritative duration in seconds from CDN/extractor metadata
  cache_tier?: string;
  title?: string;
}

export interface PipedInstance {
  name: string;
  apiUrl: string;
  locations?: string;
  cdn?: boolean;
}

export interface AudioPlayerAdapter {
  /** Optional WebKit user-gesture priming to unlock iOS mobile autoplay */
  primeAudio?(): void;
  /** Check if the given video ID is already actively loaded in the audio pipeline */
  isSongLoaded?(videoId: string): boolean;
  /** Initialize the player with DOM container/elements and initial song or videoId */
  initialize(container: HTMLElement | null, initial?: Song | string): Promise<void>;
  /** Load and play a new song */
  loadSong(song: Song): Promise<void>;
  /** Load and play by videoId */
  loadVideo(videoId: string): Promise<void>;
  /** Resume playback */
  play(): Promise<void>;
  /** Pause playback */
  pause(): Promise<void>;
  /** Mute audio output */
  mute(): void;
  /** Unmute audio output */
  unMute(): void;
  /** Set volume (0–100) */
  setVolume(volume: number): void;
  /** Seek to target seconds */
  seekTo(seconds: number): void;
  /** Get current position in seconds */
  getCurrentTime(): number;
  /** Get total duration in seconds */
  getDuration(): number;
  /** Get active player state */
  getState(): PlayerState;
  /** Subscribe to player state changes */
  onStateChange(callback: (state: PlayerState) => void): () => void;
  /** Subscribe to playback progress/timeupdate events */
  onProgress?(callback: (currentTime: number, duration: number) => void): () => void;
  /** Pre-buffer the upcoming song into the secondary audio element */
  preloadNextSong(song: Song): Promise<void>;
  /** Destroy the player and release audio resources */
  destroy(): void;
}
