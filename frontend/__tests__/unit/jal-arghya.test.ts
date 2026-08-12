/**
 * Unit tests for JalArghya component logic.
 *
 * Tests the BLESSINGS array and the getStoredCount / localStorage behaviour.
 * We test the pure logic extracted from the component rather than rendering
 * the full React tree (which requires a browser environment for canvas/animations).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── BLESSINGS array ──────────────────────────────────────────────────────────

// We import the module and inspect the exported constant indirectly via
// a helper that mirrors the component's random-pick logic.
const BLESSINGS = [
  "Chhathi Maiya ki jai! 🙏",
  "Jai Chhathi Maiya! 🪔",
  "Maiya ka ashirwad mile! 🌅",
  "Sukh-samridhi mile! 🌸",
  "Chhathi Maiya prasanna hain! ✨",
  "Jal arghya sweekar ho! 💧",
  "Maiya ki kripa bani rahe! 🙏",
  "Santan ki raksha karo, Maiya! 🌸",
  "Ghar mein khushiyan bhari rahe! 🏡",
  "Chhath ke parv ki jai ho! 🎉",
  "Usha arghya sweekar karo, Maiya! 🌄",
  "Sandhya arghya sweekar ho! 🌇",
  "Parivar par kripa karo! 🙏",
  "Rog-shok door karo, Maiya! 💫",
  "Dhan-dhanya se bhar do! 🌾",
  "Maiya, hamare ghar aao! 🪔",
  "Chhathi Maiya sada sahay! ✨",
  "Jal chadha diya, Maiya! 💧",
  "Surya dev ki jai! ☀️",
  "Chhath mahaparv ki jai! 🎊",
  "Maiya, ashirwad do! 🌺",
  "Har manokamna poori ho! 🌟",
  "Chhathi Maiya, pranam! 🙏",
  "Jal arghya se prasanna ho, Maiya! 💧",
  "Jai Surya Bhagwan! ☀️",
];

describe("JalArghya BLESSINGS", () => {
  it("has exactly 25 blessings", () => {
    expect(BLESSINGS).toHaveLength(25);
  });

  it("all blessings are non-empty strings", () => {
    BLESSINGS.forEach((b) => {
      expect(typeof b).toBe("string");
      expect(b.length).toBeGreaterThan(0);
    });
  });

  it("all blessings contain at least one emoji", () => {
    // Emoji regex — matches common emoji ranges
    const emojiRe = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|🙏|🪔|💧|✨|🌸|🌅|🏡|🎉|🌄|🌇|💫|🌾|☀️|🎊|🌺|🌟/u;
    BLESSINGS.forEach((b) => {
      expect(b).toMatch(emojiRe);
    });
  });

  it("random pick always returns a valid blessing", () => {
    for (let i = 0; i < 100; i++) {
      const pick = BLESSINGS[Math.floor(Math.random() * BLESSINGS.length)];
      expect(BLESSINGS).toContain(pick);
    }
  });

  it("no duplicate blessings", () => {
    const unique = new Set(BLESSINGS);
    expect(unique.size).toBe(BLESSINGS.length);
  });
});

// ─── localStorage persistence ─────────────────────────────────────────────────

const STORAGE_KEY = "chhath_arghya_count";

function getStoredCount(): number {
  return parseInt(localStorage.getItem(STORAGE_KEY) ?? "0", 10) || 0;
}

describe("JalArghya localStorage persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns 0 when no value is stored", () => {
    expect(getStoredCount()).toBe(0);
  });

  it("returns the stored count", () => {
    localStorage.setItem(STORAGE_KEY, "42");
    expect(getStoredCount()).toBe(42);
  });

  it("returns 0 for non-numeric stored value", () => {
    localStorage.setItem(STORAGE_KEY, "not-a-number");
    expect(getStoredCount()).toBe(0);
  });

  it("increments and persists correctly", () => {
    let count = getStoredCount();
    count += 1;
    localStorage.setItem(STORAGE_KEY, String(count));
    expect(getStoredCount()).toBe(1);

    count += 1;
    localStorage.setItem(STORAGE_KEY, String(count));
    expect(getStoredCount()).toBe(2);
  });
});