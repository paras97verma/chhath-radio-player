/**
 * Mock Audio Player Adapter for Unit & Integration Testing
 *
 * Simulates the AudioPlayerAdapter contract in Node/Vitest test environments
 * without real network or hardware media devices.
 */

import type { Song } from "../api";
import type { AudioPlayerAdapter, PlayerState } from "./types";

export class MockAudioAdapter implements AudioPlayerAdapter {
  private currentState: PlayerState = "UNSTARTED";
  private stateListeners: Set<(state: PlayerState) => void> = new Set();
  private progressListeners: Set<(currentTime: number, duration: number) => void> = new Set();
  public currentVideoId: string = "";
  public currentSong: Song | null = null;
  public preloadedSong: Song | null = null;
  public initializeCalled = false;
  public destroyCalled = false;
  public volume: number = 80;
  public isMuted: boolean = false;
  public currentTime: number = 0;
  public duration: number = 240;

  async initialize(_container: HTMLElement | null, initial?: Song | string): Promise<void> {
    this.initializeCalled = true;
    if (typeof initial === "string") {
      this.currentVideoId = initial;
    } else if (initial && typeof initial === "object") {
      this.currentSong = initial;
      this.currentVideoId = initial.youtube_video_id;
    }
  }

  async loadSong(song: Song): Promise<void> {
    this.currentSong = song;
    await this.loadVideo(song.youtube_video_id);
  }

  async loadVideo(videoId: string): Promise<void> {
    this.currentVideoId = videoId;
    this._emitState("PLAYING");
  }

  async preloadNextSong(song: Song): Promise<void> {
    this.preloadedSong = song;
  }

  async play(): Promise<void> {
    this._emitState("PLAYING");
  }

  async pause(): Promise<void> {
    this._emitState("PAUSED");
  }

  mute(): void {
    this.isMuted = true;
  }

  unMute(): void {
    this.isMuted = false;
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }

  seekTo(seconds: number): void {
    this.currentTime = seconds;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getDuration(): number {
    return this.duration;
  }

  getState(): PlayerState {
    return this.currentState;
  }

  onStateChange(callback: (state: PlayerState) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  onProgress(callback: (currentTime: number, duration: number) => void): () => void {
    this.progressListeners.add(callback);
    return () => this.progressListeners.delete(callback);
  }

  destroy(): void {
    this.destroyCalled = true;
    this.stateListeners.clear();
    this.progressListeners.clear();
  }

  simulateProgress(currentTime: number, duration: number): void {
    this.currentTime = currentTime;
    this.duration = duration;
    this.progressListeners.forEach((cb) => cb(currentTime, duration));
  }

  /** Test helper: simulate a song ending naturally */
  simulateSongEnd(): void {
    this._emitState("ENDED");
  }

  /** Test helper: simulate an unplayable video error */
  simulateError(): void {
    this._emitState("ERROR");
  }

  private _emitState(state: PlayerState): void {
    this.currentState = state;
    this.stateListeners.forEach((cb) => cb(state));
  }
}
