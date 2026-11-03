import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseInstancesMarkdown,
  normalizeApiUrl,
  BOOTSTRAP_INSTANCES,
  markInstanceFailed,
  markInstanceSuccess,
  getHealthyInstances,
} from "@/lib/piped/instance-discovery";

describe("Piped Instance Discovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  describe("normalizeApiUrl", () => {
    it("strips trailing slashes", () => {
      expect(normalizeApiUrl("https://pipedapi.kavin.rocks/")).toBe("https://pipedapi.kavin.rocks");
    });

    it("converts http to https", () => {
      expect(normalizeApiUrl("http://pipedapi.kavin.rocks")).toBe("https://pipedapi.kavin.rocks");
    });

    it("trims whitespace", () => {
      expect(normalizeApiUrl("  https://pipedapi.kavin.rocks/  ")).toBe("https://pipedapi.kavin.rocks");
    });
  });

  describe("parseInstancesMarkdown", () => {
    it("parses valid Markdown table with instances", () => {
      const sampleMarkdown = `
# Public Piped Instances

| Name | API URL | Locations | CDN |
| --- | --- | --- | --- |
| Kavin Rocks | https://pipedapi.kavin.rocks | US, NL | Yes |
| PrivacyDev | https://api.piped.privacydev.net/ | DE | No |
| Invalid Row | not-a-url | Space | No |
`;
      const instances = parseInstancesMarkdown(sampleMarkdown);
      expect(instances).toHaveLength(2);
      expect(instances[0]).toEqual({
        name: "Kavin Rocks",
        apiUrl: "https://pipedapi.kavin.rocks",
        locations: "US, NL",
        cdn: true,
      });
      expect(instances[1]).toEqual({
        name: "PrivacyDev",
        apiUrl: "https://api.piped.privacydev.net",
        locations: "DE",
        cdn: false,
      });
    });

    it("returns empty array when markdown table has no valid URLs", () => {
      const emptyMarkdown = `
| Name | API URL |
| --- | --- |
| Empty | |
`;
      const instances = parseInstancesMarkdown(emptyMarkdown);
      expect(instances).toHaveLength(0);
    });
  });

  describe("getHealthyInstances & Cooldowns", () => {
    it("returns bootstrap instances when network fetch is not available", async () => {
      // Mock fetch rejection
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const instances = await getHealthyInstances();
      expect(instances.length).toBeGreaterThan(0);
      expect(instances[0].apiUrl).toBe(BOOTSTRAP_INSTANCES[0].apiUrl);
    });

    it("filters out instances that are placed in cooldown", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const failedUrl = BOOTSTRAP_INSTANCES[0].apiUrl;
      markInstanceFailed(failedUrl);

      const healthy = await getHealthyInstances();
      expect(healthy.some((i) => i.apiUrl === failedUrl)).toBe(false);

      // Restoring success clears cooldown
      markInstanceSuccess(failedUrl);
      const afterSuccess = await getHealthyInstances();
      expect(afterSuccess.some((i) => i.apiUrl === failedUrl)).toBe(true);
    });
  });
});

