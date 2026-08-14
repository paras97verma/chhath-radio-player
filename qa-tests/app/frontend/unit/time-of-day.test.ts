/**
 * Unit tests for the TimeOfDayEngine.
 * Verifies that the correct time-of-day state is returned for each time window.
 */

import { describe, it, expect } from "vitest";
import { getTimeOfDay } from "@/lib/time-of-day";

function makeDate(hours: number, minutes: number): Date {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

describe("getTimeOfDay", () => {
  it("returns DAWN between 04:30 and 06:29", () => {
    expect(getTimeOfDay(makeDate(4, 30)).state).toBe("DAWN");
    expect(getTimeOfDay(makeDate(5, 0)).state).toBe("DAWN");
    expect(getTimeOfDay(makeDate(6, 29)).state).toBe("DAWN");
  });

  it("returns MORNING between 06:30 and 10:59", () => {
    expect(getTimeOfDay(makeDate(6, 30)).state).toBe("MORNING");
    expect(getTimeOfDay(makeDate(9, 0)).state).toBe("MORNING");
    expect(getTimeOfDay(makeDate(10, 59)).state).toBe("MORNING");
  });

  it("returns AFTERNOON between 11:00 and 16:29", () => {
    expect(getTimeOfDay(makeDate(11, 0)).state).toBe("AFTERNOON");
    expect(getTimeOfDay(makeDate(14, 0)).state).toBe("AFTERNOON");
    expect(getTimeOfDay(makeDate(16, 29)).state).toBe("AFTERNOON");
  });

  it("returns SUNSET between 16:30 and 18:59", () => {
    expect(getTimeOfDay(makeDate(16, 30)).state).toBe("SUNSET");
    expect(getTimeOfDay(makeDate(17, 30)).state).toBe("SUNSET");
    expect(getTimeOfDay(makeDate(18, 59)).state).toBe("SUNSET");
  });

  it("returns NIGHT between 19:00 and 04:29", () => {
    expect(getTimeOfDay(makeDate(19, 0)).state).toBe("NIGHT");
    expect(getTimeOfDay(makeDate(23, 59)).state).toBe("NIGHT");
    expect(getTimeOfDay(makeDate(0, 0)).state).toBe("NIGHT");
    expect(getTimeOfDay(makeDate(4, 29)).state).toBe("NIGHT");
  });

  it("NIGHT config shows moon and high diya intensity", () => {
    const config = getTimeOfDay(makeDate(22, 0));
    expect(config.showMoon).toBe(true);
    expect(config.diyaIntensity).toBe(1.0);
  });

  it("MORNING config does not show moon", () => {
    const config = getTimeOfDay(makeDate(8, 0));
    expect(config.showMoon).toBe(false);
  });
});