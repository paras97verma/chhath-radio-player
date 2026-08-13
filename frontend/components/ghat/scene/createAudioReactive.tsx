"use client";

/**
 * createAudioReactive.tsx — Web Audio API analyser hook for music reactivity.
 *
 * Returns a ref (not state — zero re-renders) with current frequency band values.
 * If audioNode is null, all bands default to 0.5 (neutral — scene still animates).
 *
 * Usage in GhatScene:
 *   const audioBands = useAudioReactive(audioNode);
 *   // In useFrame: water.uWaveStrength = 0.12 + audioBands.current.bass * 0.08
 */

import { useRef, useEffect } from "react";

export interface AudioBands {
  /** 0–1, 20–250 Hz — drives water wave strength */
  bass: number;
  /** 0–1, 250–2000 Hz — drives crowd animation speed */
  mid: number;
  /** 0–1, 2000–8000 Hz — drives particle speed */
  high: number;
  /** 0–1, overall RMS — drives diya emissive intensity */
  volume: number;
}

const NEUTRAL: AudioBands = { bass: 0.5, mid: 0.5, high: 0.5, volume: 0.5 };

/**
 * useAudioReactive — creates an AnalyserNode from the passed AudioNode and
 * continuously reads frequency data into the returned ref.
 *
 * @param audioNode - Web Audio source node from the radio player, or null
 * @returns MutableRefObject<AudioBands> — read in useFrame without causing re-renders
 */
export function useAudioReactive(
  audioNode: AudioNode | null
): React.MutableRefObject<AudioBands> {
  const bandsRef = useRef<AudioBands>({ ...NEUTRAL });
  const rafRef   = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef     = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!audioNode) {
      bandsRef.current = { ...NEUTRAL };
      return;
    }

    const ctx = audioNode.context;

    // Create analyser
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    audioNode.connect(analyser);
    analyserRef.current = analyser;

    const bufferLength = analyser.frequencyBinCount; // 128
    const data = new Uint8Array(bufferLength);
    dataRef.current = data;

    // Frequency bin boundaries (assuming 44100 Hz sample rate, 128 bins)
    // Each bin covers: (sampleRate / 2) / bufferLength = ~172 Hz per bin
    const binHz = (ctx.sampleRate / 2) / bufferLength;
    const bassEnd  = Math.floor(250  / binHz);  // ~1–2 bins
    const midEnd   = Math.floor(2000 / binHz);  // ~12 bins
    const highEnd  = Math.floor(8000 / binHz);  // ~47 bins

    function average(arr: Uint8Array, start: number, end: number): number {
      let sum = 0;
      const count = Math.max(1, end - start);
      for (let i = start; i < end && i < arr.length; i++) sum += arr[i];
      return sum / count / 255; // normalize 0–1
    }

    function tick() {
      analyser.getByteFrequencyData(data);

      const bass   = average(data, 0,       bassEnd);
      const mid    = average(data, bassEnd,  midEnd);
      const high   = average(data, midEnd,   highEnd);

      // RMS volume across all bins
      let rms = 0;
      for (let i = 0; i < bufferLength; i++) rms += (data[i] / 255) ** 2;
      const volume = Math.sqrt(rms / bufferLength);

      bandsRef.current = { bass, mid, high, volume };
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      try { audioNode.disconnect(analyser); } catch { /* already disconnected */ }
      analyserRef.current = null;
      dataRef.current = null;
      bandsRef.current = { ...NEUTRAL };
    };
  }, [audioNode]);

  return bandsRef;
}