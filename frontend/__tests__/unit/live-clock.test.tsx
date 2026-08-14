/**
 * Unit tests for LiveClock component and its helpers.
 *
 * Covers:
 *  - formatTime() — 24h and 12h output, AM/PM uppercase
 *  - formatDate() — DD-MMM-YYYY shape
 *  - <LiveClock /> — renders time/date, toggles 12/24h on click, badge updates
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

import LiveClock, { formatTime, formatDate } from "@/components/radio/LiveClock";

// ─── formatTime() ─────────────────────────────────────────────────────────────

describe("formatTime()", () => {
  // Fixed reference: 15:07:03 (3:07:03 PM)
  const d = new Date(2026, 7, 12, 15, 7, 3); // Aug 12 2026, 15:07:03

  describe("24-hour mode (hour12=false)", () => {
    it("returns a string containing hours, minutes, seconds", () => {
      const t = formatTime(d, false);
      expect(t).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });

    it("does not contain AM or PM", () => {
      const t = formatTime(d, false);
      expect(t.toUpperCase()).not.toMatch(/\bAM\b|\bPM\b/);
    });
  });

  describe("12-hour mode (hour12=true)", () => {
    it("returns a string containing hours, minutes, seconds", () => {
      const t = formatTime(d, true);
      expect(t).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });

    it("contains AM or PM (uppercase)", () => {
      const t = formatTime(d, true);
      expect(t).toMatch(/AM|PM/);
    });

    it("AM/PM is uppercase even if locale returns lowercase", () => {
      const t = formatTime(d, true);
      // Must not contain lowercase am/pm as standalone word
      expect(t).not.toMatch(/\bam\b|\bpm\b/);
    });

    it("shows PM for a 15:xx time", () => {
      const t = formatTime(d, true);
      expect(t).toContain("PM");
    });

    it("shows AM for a 09:xx time", () => {
      const morning = new Date(2026, 7, 12, 9, 5, 0);
      const t = formatTime(morning, true);
      expect(t).toContain("AM");
    });
  });
});

// ─── formatDate() ─────────────────────────────────────────────────────────────

describe("formatDate()", () => {
  const d = new Date(2026, 7, 12); // Aug 12 2026

  it("returns a non-empty string", () => {
    expect(formatDate(d).length).toBeGreaterThan(0);
  });

  it("contains the year 2026", () => {
    expect(formatDate(d)).toContain("2026");
  });

  it("contains the day number", () => {
    // Day 12 — may appear as "12" or "12th" depending on locale
    expect(formatDate(d)).toMatch(/12/);
  });

  it("contains a month abbreviation (3 letters)", () => {
    // e.g. "Aug", "Aug.", "Aug " — just check 3-letter alpha sequence
    expect(formatDate(d)).toMatch(/[A-Za-z]{3}/);
  });
});

// ─── <LiveClock /> component ──────────────────────────────────────────────────

describe("<LiveClock />", () => {
  beforeEach(() => {
    // Freeze time to a known value so assertions are deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 15, 7, 3)); // 15:07:03
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the clock container after mount", async () => {
    await act(async () => {
      render(<LiveClock />);
    });
    expect(screen.getByTestId("live-clock")).toBeDefined();
  });

  it("renders the time element", async () => {
    await act(async () => {
      render(<LiveClock />);
    });
    expect(screen.getByTestId("clock-time")).toBeDefined();
  });

  it("renders the date element", async () => {
    await act(async () => {
      render(<LiveClock />);
    });
    expect(screen.getByTestId("clock-date")).toBeDefined();
  });

  it("shows 24h badge by default", async () => {
    await act(async () => {
      render(<LiveClock />);
    });
    const badge = screen.getByTestId("clock-format-badge");
    expect(badge.textContent).toBe("24h");
  });

  it("time does not contain AM/PM in 24h mode", async () => {
    await act(async () => {
      render(<LiveClock />);
    });
    const timeEl = screen.getByTestId("clock-time");
    expect(timeEl.textContent?.toUpperCase()).not.toMatch(/\bAM\b|\bPM\b/);
  });

  it("clicking the time toggles to 12h mode", async () => {
    await act(async () => {
      render(<LiveClock />);
    });
    const timeBtn = screen.getByTestId("clock-time");
    await act(async () => {
      fireEvent.click(timeBtn);
    });
    const badge = screen.getByTestId("clock-format-badge");
    expect(badge.textContent).toBe("12h");
  });

  it("time contains AM or PM after switching to 12h", async () => {
    await act(async () => {
      render(<LiveClock />);
    });
    const timeBtn = screen.getByTestId("clock-time");
    await act(async () => {
      fireEvent.click(timeBtn);
    });
    expect(timeBtn.textContent).toMatch(/AM|PM/);
  });

  it("clicking again toggles back to 24h mode", async () => {
    await act(async () => {
      render(<LiveClock />);
    });
    const timeBtn = screen.getByTestId("clock-time");
    await act(async () => {
      fireEvent.click(timeBtn); // → 12h
      fireEvent.click(timeBtn); // → 24h
    });
    const badge = screen.getByTestId("clock-format-badge");
    expect(badge.textContent).toBe("24h");
  });

  it("date contains the year", async () => {
    await act(async () => {
      render(<LiveClock />);
    });
    const dateEl = screen.getByTestId("clock-date");
    expect(dateEl.textContent).toContain("2026");
  });

  it("time button has an accessible aria-label", async () => {
    await act(async () => {
      render(<LiveClock />);
    });
    const timeBtn = screen.getByTestId("clock-time");
    const label = timeBtn.getAttribute("aria-label") ?? "";
    expect(label.length).toBeGreaterThan(0);
    expect(label).toContain("12h");
  });
});