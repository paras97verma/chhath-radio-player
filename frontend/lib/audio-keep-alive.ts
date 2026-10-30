/**
 * Audio Keep-Alive Service
 *
 * Keeps the browser's audio engine and media session pipeline active when:
 * 1. The mobile device screen locks / turns off (iOS & Android).
 * 2. The browser tab goes into the background or loses focus.
 *
 * How it works:
 * - Declares `navigator.audioSession.type = 'playback'` on Safari 16.4+ / iOS,
 *   marking this web app as a full media player (Spotify / Apple Music style).
 * - Appends and plays an invisible, looping silent audio track (/sounds/silence.wav)
 *   via an HTML5 `<audio>` element attached to document.body.
 *   On iOS and Android, an active HTML5 audio element assigns the page an active
 *   OS Audio Session, preventing the background process from being frozen or killed by the OS.
 * - Powers a Web Audio AudioContext with a silent buffer source so the audio hardware
 *   clock continues ticking even when display is off.
 */

let silentAudioElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let silentSource: AudioBufferSourceNode | null = null;
let isRunning = false;

// Minimal 44-byte silent WAV base64 fallback
const FALLBACK_SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABkYXRhAgAAAAEA";

function configureAudioSession(): void {
  if (typeof navigator === "undefined") return;
  // W3C Audio Session API (Safari / WebKit on iOS 16.4+)
  if ("audioSession" in navigator) {
    try {
      const navWithSession = navigator as unknown as {
        audioSession: { type: string };
      };
      navWithSession.audioSession.type = "playback";
    } catch (err) {
      console.warn("[AudioKeepAlive] Could not configure audioSession:", err);
    }
  }
}

function getOrCreateAudioElement(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (silentAudioElement) {
    if (document.body && !silentAudioElement.parentElement) {
      document.body.appendChild(silentAudioElement);
    }
    return silentAudioElement;
  }

  try {
    const audio = new Audio();
    audio.src = "/sounds/silence.wav";
    audio.loop = true;
    audio.preload = "auto";
    // Minimal volume so OS audio managers treat it as active sound production
    audio.volume = 0.01;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.setAttribute("aria-hidden", "true");

    audio.style.position = "fixed";
    audio.style.width = "1px";
    audio.style.height = "1px";
    audio.style.opacity = "0.01";
    audio.style.pointerEvents = "none";
    audio.style.bottom = "-20px";
    audio.style.left = "-20px";
    audio.style.zIndex = "-999";

    audio.addEventListener("error", () => {
      // If static file fails to load, fallback to base64 data URI
      if (audio.src !== FALLBACK_SILENT_WAV) {
        audio.src = FALLBACK_SILENT_WAV;
        if (isRunning) {
          audio.play().catch(() => {
            /* ignore */
          });
        }
      }
    });

    if (document.body) {
      document.body.appendChild(audio);
    }

    silentAudioElement = audio;
    return audio;
  } catch (err) {
    console.warn("[AudioKeepAlive] Could not create audio element:", err);
    return null;
  }
}

function primeWebAudio(): void {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {
        /* ignore */
      });
    }

    // Keep an inaudible buffer source running so the Web Audio clock never suspends
    if (!silentSource && audioContext) {
      try {
        const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = audioContext.createGain();
        gain.gain.value = 0.001;
        source.connect(gain);
        gain.connect(audioContext.destination);
        source.start();
        silentSource = source;
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn("[AudioKeepAlive] Could not prime WebAudio:", err);
  }
}

/**
 * Start the audio keep-alive mechanism.
 * MUST be called during a direct user gesture (e.g. click "Tune In" or "Play").
 */
export async function startAudioKeepAlive(): Promise<void> {
  isRunning = true;
  configureAudioSession();
  primeWebAudio();

  const audio = getOrCreateAudioElement();
  if (audio) {
    try {
      if (audio.paused) {
        await audio.play();
      }
    } catch (err) {
      console.warn("[AudioKeepAlive] Silent audio autoplay failed:", err);
    }
  }
}

/**
 * Pause the audio keep-alive mechanism when the user explicitly pauses playback.
 */
export function stopAudioKeepAlive(): void {
  isRunning = false;
  if (silentAudioElement && !silentAudioElement.paused) {
    try {
      silentAudioElement.pause();
    } catch {
      /* ignore */
    }
  }
}

export function isAudioKeepAliveRunning(): boolean {
  return isRunning;
}
