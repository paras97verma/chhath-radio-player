/**
 * Phase 5.1: TimeOfDayEngine
 *
 * Takes the user's local browser time and returns a named time-of-day state
 * that drives the 3D scene's colors, lighting, and mood.
 */

export type TimeOfDay =
  | "DAWN"       // 04:30–06:30 — Usha Arghya mood: dark blue, orange horizon
  | "MORNING"    // 06:30–11:00 — Fresh, bright golden sun
  | "AFTERNOON"  // 11:00–16:30 — Clear sky, bright river
  | "SUNSET"     // 16:30–19:00 — Sandhya Arghya mood: deep orange, long reflections
  | "NIGHT";     // 19:00–04:30 — Deep navy, moon, glowing diyas

export interface TimeOfDayConfig {
  state: TimeOfDay;
  /** Sky/fog color (hex) */
  skyColor: string;
  /** Horizon/ambient color (hex) */
  horizonColor: string;
  /** Sun/moon color (hex) */
  celestialColor: string;
  /** River water color (hex) */
  waterColor: string;
  /** Fog density (0–1) */
  fogDensity: number;
  /** Whether to show the moon (true) or sun (false) */
  showMoon: boolean;
  /** Diya glow intensity (0–1) */
  diyaIntensity: number;
}

const CONFIGS: Record<TimeOfDay, TimeOfDayConfig> = {
  DAWN: {
    state: "DAWN",
    skyColor: "#1a1a3e",
    horizonColor: "#ff6b35",
    celestialColor: "#ff8c42",
    waterColor: "#2d3561",
    fogDensity: 0.04,
    showMoon: false,
    diyaIntensity: 0.9,
  },
  MORNING: {
    state: "MORNING",
    skyColor: "#87ceeb",
    horizonColor: "#ffd700",
    celestialColor: "#fff176",
    waterColor: "#4fc3f7",
    fogDensity: 0.01,
    showMoon: false,
    diyaIntensity: 0.2,
  },
  AFTERNOON: {
    state: "AFTERNOON",
    skyColor: "#5bc8f5",
    horizonColor: "#e0f7fa",
    celestialColor: "#ffffff",
    waterColor: "#29b6f6",
    fogDensity: 0.005,
    showMoon: false,
    diyaIntensity: 0.1,
  },
  SUNSET: {
    state: "SUNSET",
    skyColor: "#ff4500",
    horizonColor: "#ff8c00",
    celestialColor: "#ff6347",
    waterColor: "#b34700",
    fogDensity: 0.03,
    showMoon: false,
    diyaIntensity: 0.7,
  },
  NIGHT: {
    state: "NIGHT",
    skyColor: "#0a0a2e",
    horizonColor: "#1a1a4e",
    celestialColor: "#e8e8ff",
    waterColor: "#0d1b4b",
    fogDensity: 0.06,
    showMoon: true,
    diyaIntensity: 1.0,
  },
};

/**
 * Determine the time-of-day state from a Date object.
 * Uses the user's local browser time.
 */
export function getTimeOfDay(date: Date = new Date()): TimeOfDayConfig {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // 04:30 = 270, 06:30 = 390, 11:00 = 660, 16:30 = 990, 19:00 = 1140
  if (totalMinutes >= 270 && totalMinutes < 390) return CONFIGS.DAWN;
  if (totalMinutes >= 390 && totalMinutes < 660) return CONFIGS.MORNING;
  if (totalMinutes >= 660 && totalMinutes < 990) return CONFIGS.AFTERNOON;
  if (totalMinutes >= 990 && totalMinutes < 1140) return CONFIGS.SUNSET;
  return CONFIGS.NIGHT;
}

/**
 * Linearly interpolate between two hex colors.
 * Used for smooth transitions between time-of-day states.
 */
export function lerpColor(colorA: string, colorB: string, t: number): string {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return rgbToHex(r, g, bl);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}