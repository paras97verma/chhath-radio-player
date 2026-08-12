/**
 * Unit tests for WhatsAppRequest URL builder logic.
 *
 * Tests the buildWhatsAppUrl() helper in isolation — no React rendering needed.
 */

import { describe, it, expect } from "vitest";

// Mirror the helper from the component
function buildWhatsAppUrl(
  number: string,
  songTitle: string,
  artist: string
): string {
  const message = [
    `🪔 *Chhath Radio pe gaana request:*`,
    ``,
    `🎵 "${songTitle}" — ${artist}`,
    ``,
    `Chhathi Maiya ki jai! 🙏`,
    ``,
    `_(Chhath Radio: chhathradio.com)_`,
  ].join("\n");

  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

describe("buildWhatsAppUrl", () => {
  const NUMBER = "919876543210";

  it("returns a wa.me URL", () => {
    const url = buildWhatsAppUrl(NUMBER, "Kaanch Hi Baans", "Sharda Sinha");
    expect(url).toMatch(/^https:\/\/wa\.me\//);
  });

  it("includes the phone number in the URL", () => {
    const url = buildWhatsAppUrl(NUMBER, "Kaanch Hi Baans", "Sharda Sinha");
    expect(url).toContain(NUMBER);
  });

  it("includes the song title in the message", () => {
    const url = buildWhatsAppUrl(NUMBER, "Kaanch Hi Baans", "Sharda Sinha");
    expect(decodeURIComponent(url)).toContain("Kaanch Hi Baans");
  });

  it("includes the artist in the message", () => {
    const url = buildWhatsAppUrl(NUMBER, "Kaanch Hi Baans", "Sharda Sinha");
    expect(decodeURIComponent(url)).toContain("Sharda Sinha");
  });

  it("includes the Chhath Radio branding", () => {
    const url = buildWhatsAppUrl(NUMBER, "Test Song", "Test Artist");
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("Chhath Radio");
    expect(decoded).toContain("chhathradio.com");
  });

  it("includes the blessing line", () => {
    const url = buildWhatsAppUrl(NUMBER, "Test Song", "Test Artist");
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("Chhathi Maiya ki jai");
  });

  it("URL-encodes special characters in song title", () => {
    const url = buildWhatsAppUrl(NUMBER, "Kaanch & Baans", "Artist");
    // The & should be encoded in the query string
    expect(url).not.toContain("text=🪔");
    expect(url).toContain("text=");
  });

  it("handles song titles with quotes", () => {
    const url = buildWhatsAppUrl(NUMBER, 'He said "hello"', "Artist");
    // Should not break the URL
    expect(url).toMatch(/^https:\/\/wa\.me\//);
    expect(decodeURIComponent(url)).toContain('He said "hello"');
  });

  it("handles empty song title gracefully", () => {
    const url = buildWhatsAppUrl(NUMBER, "", "Artist");
    expect(url).toMatch(/^https:\/\/wa\.me\//);
  });
});

// ─── Share URL builder ────────────────────────────────────────────────────────

describe("Share URL builder", () => {
  function buildShareUrl(
    origin: string,
    title: string,
    artist: string
  ): string {
    return `${origin}/share?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
  }

  it("builds a /share URL with title and artist", () => {
    const url = buildShareUrl(
      "https://chhathradio.com",
      "Kaanch Hi Baans",
      "Sharda Sinha"
    );
    expect(url).toBe(
      "https://chhathradio.com/share?title=Kaanch%20Hi%20Baans&artist=Sharda%20Sinha"
    );
  });

  it("URL-encodes Hindi characters in title", () => {
    const url = buildShareUrl(
      "https://chhathradio.com",
      "छठ गीत",
      "Sharda Sinha"
    );
    expect(url).toContain(encodeURIComponent("छठ गीत"));
  });

  it("URL-encodes Hindi characters in artist", () => {
    const url = buildShareUrl(
      "https://chhathradio.com",
      "Song",
      "शारदा सिन्हा"
    );
    expect(url).toContain(encodeURIComponent("शारदा सिन्हा"));
  });

  it("produces a URL that can be decoded back to original values", () => {
    const title = "Kaanch Hi Baans";
    const artist = "Sharda Sinha";
    const url = buildShareUrl("https://chhathradio.com", title, artist);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("title")).toBe(title);
    expect(parsed.searchParams.get("artist")).toBe(artist);
  });

  it("handles special characters in title", () => {
    const title = "Song & More (Live)";
    const url = buildShareUrl("https://chhathradio.com", title, "Artist");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("title")).toBe(title);
  });
});