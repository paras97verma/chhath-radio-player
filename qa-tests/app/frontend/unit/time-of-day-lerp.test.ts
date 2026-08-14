/**
 * Unit tests for lerpColor() in lib/time-of-day.ts.
 * Verifies linear interpolation between hex colors.
 */

import { describe, it, expect } from "vitest";
import { lerpColor } from "@/lib/time-of-day";

describe("lerpColor", () => {
  it("returns colorA when t=0", () => {
    expect(lerpColor("#000000", "#ffffff", 0)).toBe("#000000");
  });

  it("returns colorB when t=1", () => {
    expect(lerpColor("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  it("returns midpoint grey when t=0.5 between black and white", () => {
    // 0x80 = 128 decimal → "80" in hex
    expect(lerpColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("interpolates red channel correctly", () => {
    // From #ff0000 to #000000 at t=0.5 → #800000
    expect(lerpColor("#ff0000", "#000000", 0.5)).toBe("#800000");
  });

  it("interpolates green channel correctly", () => {
    // From #00ff00 to #000000 at t=0.5 → #008000
    expect(lerpColor("#00ff00", "#000000", 0.5)).toBe("#008000");
  });

  it("interpolates blue channel correctly", () => {
    // From #0000ff to #000000 at t=0.5 → #000080
    expect(lerpColor("#0000ff", "#000000", 0.5)).toBe("#000080");
  });

  it("returns colorA when colorA equals colorB", () => {
    expect(lerpColor("#ff6b35", "#ff6b35", 0.5)).toBe("#ff6b35");
  });

  it("handles t values outside [0,1] by extrapolating (no clamping)", () => {
    // This tests the actual behavior — the function does not clamp
    // t=2 between #000000 and #404040 → r=128, g=128, b=128
    const result = lerpColor("#000000", "#404040", 2);
    // 0x40 = 64; 64 * 2 = 128 = 0x80
    expect(result).toBe("#808080");
  });

  it("returns a valid 7-character hex string", () => {
    const result = lerpColor("#1a1a3e", "#ff6b35", 0.3);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("works with DAWN sky and horizon colors", () => {
    // DAWN: skyColor="#1a1a3e", horizonColor="#ff6b35"
    const result = lerpColor("#1a1a3e", "#ff6b35", 0);
    expect(result).toBe("#1a1a3e");
  });
});