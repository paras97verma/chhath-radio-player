/**
 * Audio / YouTube Adapter Compatibility Layer
 *
 * Provides backward compatibility for components and tests that import from youtube-adapter.
 * Forwarding to the native Audio engine types and MockAudioAdapter.
 */

import type { AudioPlayerAdapter, PlayerState } from "./audio/types";
import { MockAudioAdapter } from "./audio/mock-audio-adapter";

export type { PlayerState };

export type YouTubePlayerAdapter = AudioPlayerAdapter;

export const YT_UNPLAYABLE_ERRORS = new Set([2, 5, 100, 101, 150]);

export function preloadYouTubeAPI(): void {
  // No-op in native audio mode
}

export class MockYouTubePlayerAdapter extends MockAudioAdapter implements YouTubePlayerAdapter {}

export { Html5AudioAdapter as YouTubeIFramePlayerAdapter } from "./audio/html5-audio-adapter";
