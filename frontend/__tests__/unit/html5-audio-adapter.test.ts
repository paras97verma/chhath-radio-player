import { describe, it, expect, vi, beforeEach } from "vitest";
import { Html5AudioAdapter } from "@/lib/audio/html5-audio-adapter";

describe("Html5AudioAdapter", () => {
  let primaryAudio: HTMLAudioElement;
  let secondaryAudio: HTMLAudioElement;
  let adapter: Html5AudioAdapter;

  beforeEach(async () => {
    vi.restoreAllMocks();
    primaryAudio = document.createElement("audio");
    secondaryAudio = document.createElement("audio");
    adapter = new Html5AudioAdapter(primaryAudio, secondaryAudio);
    await adapter.initialize(null);
  });

  it("initializes audio elements with playsinline and preload", () => {
    expect(primaryAudio.preload).toBe("auto");
    expect(secondaryAudio.preload).toBe("auto");
    expect(primaryAudio.getAttribute("playsinline")).toBe("true");
    expect(secondaryAudio.getAttribute("playsinline")).toBe("true");
  });

  it("updates volume and mute settings across both audio elements", () => {
    adapter.setVolume(50);
    expect(primaryAudio.volume).toBe(0.5);
    expect(secondaryAudio.volume).toBe(0.5);

    adapter.mute();
    expect(primaryAudio.muted).toBe(true);
    expect(secondaryAudio.muted).toBe(true);

    adapter.unMute();
    expect(primaryAudio.muted).toBe(false);
    expect(secondaryAudio.muted).toBe(false);
  });

  it("forwards audio play and pause events to listeners", () => {
    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    // Simulate play event
    primaryAudio.dispatchEvent(new Event("play"));
    expect(states).toContain("PLAYING");

    // Simulate pause event
    primaryAudio.dispatchEvent(new Event("pause"));
    expect(states).toContain("PAUSED");
  });

  it("forwards waiting/buffering and ended events to listeners", () => {
    const states: string[] = [];
    adapter.onStateChange((s) => states.push(s));

    primaryAudio.dispatchEvent(new Event("waiting"));
    expect(states).toContain("BUFFERING");

    primaryAudio.dispatchEvent(new Event("ended"));
    expect(states).toContain("ENDED");
  });

  it("cleans up listeners and pauses audio upon destroy", () => {
    const pauseSpy = vi.spyOn(primaryAudio, "pause");
    adapter.destroy();
    expect(pauseSpy).toHaveBeenCalled();
  });

  it("forwards timeupdate and metadata progress events to onProgress listeners", () => {
    let recordedCur = 0;
    let recordedDur = 0;
    adapter.onProgress((cur, dur) => {
      recordedCur = cur;
      recordedDur = dur;
    });

    Object.defineProperty(primaryAudio, "duration", { value: 210, configurable: true });
    Object.defineProperty(primaryAudio, "currentTime", { value: 45, configurable: true, writable: true });

    primaryAudio.dispatchEvent(new Event("timeupdate"));
    expect(recordedCur).toBe(45);
    expect(recordedDur).toBe(210);

    adapter.seekTo(90);
    expect(primaryAudio.currentTime).toBe(90);
    expect(recordedCur).toBe(90);
  });
});
