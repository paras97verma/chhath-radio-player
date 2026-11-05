/** Cross-browser playback checks against deterministic Invidious metadata/media mocks. */

import { test, expect, type Page, type Route } from "@playwright/test";

const SONGS = [
  {
    id: "e2e-song-1",
    title: "First E2E Song",
    artist: "Test Singer",
    youtube_video_id: "E2E12345678",
    youtube_url: null,
    category: "Chhath",
    enabled: true,
    sort_order: 1,
  },
  {
    id: "e2e-song-2",
    title: "Second E2E Song",
    artist: "Test Singer",
    youtube_video_id: "E2E23456789",
    youtube_url: null,
    category: "Chhath",
    enabled: true,
    sort_order: 2,
  },
];

type PlaybackScenario = "progress" | "delayed-progress" | "fallback" | "fail";

function streamResponse(videoId: string) {
  const now = Math.floor(Date.now() / 1000);
  const providerOrigin = "https://invidious.example.test";
  const directUrl = `https://media.example.test/${videoId}.m4a`;
  const proxyUrl = `${providerOrigin}/latest_version?id=${videoId}&itag=140&local=true`;
  const source = (mode: "direct" | "proxy", url: string) => ({
    mode,
    provider: "invidious",
    provider_origin: providerOrigin,
    url,
    itag: 140,
    mime_type: 'audio/mp4; codecs="mp4a.40.2"',
    codec: "mp4a.40.2",
    resolved_at: now,
    expires_at: null,
    refresh_at: now + 1200,
    validation_state: "validated",
  });

  return {
    schema_version: 1,
    video_id: videoId,
    generation: 1,
    refreshed_at: now,
    duration: 180,
    sources: [source("direct", directUrl), source("proxy", proxyUrl)],
  };
}

async function mockPlaybackEnvironment(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type TestWindow = Window & {
      __radioPlaybackScenario?: PlaybackScenario;
      __radioAudioAttempts?: string[];
      __radioFirstProgressAt?: number;
      __radioSelectionStartedAt?: number;
      __radioResolverStartedAt?: number;
      __radioResolverFinishedAt?: number;
    };
    const testWindow = window as TestWindow;
    testWindow.__radioPlaybackScenario = "progress";
    testWindow.__radioAudioAttempts = [];

    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (...args: Parameters<typeof window.fetch>) => {
      const resource = args[0];
      const requestUrl = resource instanceof Request ? resource.url : String(resource);
      const isStreamResolution = new URL(requestUrl, window.location.href).pathname === "/api/stream";
      if (isStreamResolution && testWindow.__radioResolverStartedAt === undefined) {
        testWindow.__radioResolverStartedAt = performance.now();
        const response = await originalFetch(...args);
        testWindow.__radioResolverFinishedAt = performance.now();
        return response;
      }
      return originalFetch(...args);
    }) as typeof window.fetch;

    type MockAudio = HTMLMediaElement & { __radioMockSrc?: string };
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      get(this: MockAudio) {
        return this.__radioMockSrc ?? "";
      },
      set(this: MockAudio, value: string) {
        this.__radioMockSrc = value ? new URL(value, document.baseURI).href : "";
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "currentSrc", {
      configurable: true,
      get(this: MockAudio) {
        return this.__radioMockSrc ?? "";
      },
    });
    const removeAttribute = Element.prototype.removeAttribute;
    Element.prototype.removeAttribute = function (name: string) {
      if (this instanceof HTMLMediaElement && name.toLowerCase() === "src") {
        (this as MockAudio).__radioMockSrc = "";
      }
      return removeAttribute.call(this, name);
    };

    HTMLMediaElement.prototype.load = function () {};
    HTMLMediaElement.prototype.pause = function () {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
    };
    HTMLMediaElement.prototype.play = function () {
      const audio = this;
      const sourceUrl = audio.src;
      if (sourceUrl.startsWith("data:") || sourceUrl.startsWith("blob:")) {
        return Promise.resolve();
      }

      const mode = new URL(sourceUrl).pathname === "/latest_version" ? "proxy" : "direct";
      testWindow.__radioAudioAttempts?.push(mode);
      const scenario = testWindow.__radioPlaybackScenario ?? "progress";
      const shouldFail = scenario === "fail" || (scenario === "fallback" && mode === "direct");
      const delay = scenario === "delayed-progress" ? 700 : 0;

      Object.defineProperty(audio, "paused", { configurable: true, value: false });
      Object.defineProperty(audio, "ended", { configurable: true, value: false });
      Reflect.deleteProperty(audio, "error");
      if (scenario === "delayed-progress") audio.dispatchEvent(new Event("canplay"));
      window.setTimeout(() => {
        if (shouldFail) {
          Object.defineProperty(audio, "error", { configurable: true, value: { code: 2 } });
          audio.dispatchEvent(new Event("error"));
          return;
        }

        if (testWindow.__radioFirstProgressAt === undefined) {
          testWindow.__radioFirstProgressAt = performance.now();
        }
        Object.defineProperty(audio, "currentTime", { configurable: true, value: 0.25 });
        audio.dispatchEvent(new Event("playing"));
        audio.dispatchEvent(new Event("timeupdate"));
        window.setTimeout(() => {
          Object.defineProperty(audio, "currentTime", { configurable: true, value: 0.5 });
          audio.dispatchEvent(new Event("timeupdate"));
        }, 350);
      }, delay);
      return Promise.resolve();
    };
  });

  await page.route("**/api/radio/queue", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SONGS) }),
  );
  await page.route("**/api/stream**", (route: Route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.endsWith("/source-failure")) {
      return route.fulfill({ status: 204, body: "" });
    }
    const videoId = requestUrl.searchParams.get("v");
    if (!videoId) return route.fulfill({ status: 400, body: "missing video id" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify(streamResponse(videoId)),
    });
  });
}

async function openRadio(page: Page): Promise<void> {
  await mockPlaybackEnvironment(page);
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText("First E2E Song", { exact: true })).toBeVisible({ timeout: 10_000 });
}

async function startFromSplash(page: Page): Promise<void> {
  const splash = page.getByRole("dialog", { name: /click to start/i });
  if (await splash.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /start chhath radio|tune in/i }).click();
    await expect(splash).not.toBeVisible({ timeout: 3_000 });
  }
}

async function setPlaybackScenario(page: Page, scenario: PlaybackScenario): Promise<void> {
  await page.evaluate((value) => {
    (window as Window & { __radioPlaybackScenario?: PlaybackScenario }).__radioPlaybackScenario = value;
  }, scenario);
}

async function playbackAttempts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & { __radioAudioAttempts?: string[] }).__radioAudioAttempts ?? []);
}

test.describe("Chhath Radio — Public Page", () => {
  test("page loads without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await openRadio(page);
    await expect(page).toHaveTitle(/Chhath Radio/i);
    expect(errors).toHaveLength(0);
  });

  test("radio controls and listener count render", async ({ page }) => {
    await openRadio(page);
    await startFromSplash(page);
    await expect(page.getByRole("region", { name: "Radio player" })).toBeVisible();
    await expect(page.getByRole("status").first()).toBeVisible();
  });
});

test.describe("Chhath Radio — Cross-browser playback recovery", () => {
  test("PLAYING waits for media progress, not canplay alone", async ({ page }) => {
    await openRadio(page);
    await setPlaybackScenario(page, "delayed-progress");
    const status = page.getByRole("status").first();

    await startFromSplash(page);
    await expect(status).toContainText(/Connecting to audio|Starting audio/, { timeout: 2_000 });
    await expect(status).toContainText("On air", { timeout: 5_000 });
    await expect.poll(() => playbackAttempts(page)).toContain("direct");
  });

  test("failed direct media falls back to Invidious proxy and reaches progress", async ({ page }) => {
    await openRadio(page);
    await setPlaybackScenario(page, "fallback");
    await startFromSplash(page);

    await expect(page.getByRole("status").first()).toContainText("On air", { timeout: 5_000 });
    await expect.poll(() => playbackAttempts(page)).toEqual(expect.arrayContaining(["direct", "proxy"]));
  });

  test("failure of both modes keeps the selected song instead of skipping", async ({ page }) => {
    await openRadio(page);
    await setPlaybackScenario(page, "fail");
    await startFromSplash(page);

    await expect.poll(() => playbackAttempts(page)).toEqual(expect.arrayContaining(["direct", "proxy"]));
    const player = page.getByRole("region", { name: "Radio player" });
    await expect(player.getByText("First E2E Song", { exact: true })).toBeVisible();
    await expect(player.getByText("Second E2E Song", { exact: true })).toHaveCount(0);
  });

  test("status and recovery actions stay clear at 320px and desktop widths", async ({ page }) => {
    test.setTimeout(35_000);
    await page.setViewportSize({ width: 320, height: 820 });
    await openRadio(page);
    await setPlaybackScenario(page, "fail");
    await startFromSplash(page);
    await expect.poll(() => playbackAttempts(page)).toEqual(expect.arrayContaining(["direct", "proxy"]));

    const player = page.getByRole("region", { name: "Radio player" });
    const status = player.getByRole("status");
    const title = player.getByText("First E2E Song", { exact: true });
    const recovery = player.getByRole("alert");
    await expect(recovery).toBeVisible({ timeout: 20_000 });
    const retry = recovery.getByRole("button", { name: "Retry song" });
    const skip = recovery.getByRole("button", { name: "Skip this song and play the next song" });
    const copy = recovery.getByText("Playback was interrupted").locator("..");
    const actions = retry.locator("..");

    const getBounds = async (locator: typeof player) => {
      const bounds = await locator.boundingBox();
      expect(bounds, "expected player content to have visible bounds").not.toBeNull();
      return bounds!;
    };
    const expectNoOverlap = (first: NonNullable<Awaited<ReturnType<typeof getBounds>>>, second: NonNullable<Awaited<ReturnType<typeof getBounds>>>) => {
      const separated = first.x + first.width <= second.x + 1
        || second.x + second.width <= first.x + 1
        || first.y + first.height <= second.y + 1
        || second.y + second.height <= first.y + 1;
      expect(separated, "player content should not overlap").toBe(true);
    };

    const assertLayout = async (width: number) => {
      await expect(player).toBeVisible();
      await expect(status).toContainText("Playback interrupted");
      await expect(retry).toBeVisible();
      await expect(skip).toBeVisible();

      const playerBounds = await getBounds(player);
      const titleBounds = await getBounds(title);
      const statusBounds = await getBounds(status);
      const recoveryBounds = await getBounds(recovery);
      const copyBounds = await getBounds(copy);
      const actionsBounds = await getBounds(actions);
      const retryBounds = await getBounds(retry);
      const skipBounds = await getBounds(skip);

      expect(playerBounds.width).toBeLessThanOrEqual(width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      expect(recoveryBounds.x).toBeGreaterThanOrEqual(playerBounds.x - 1);
      expect(recoveryBounds.x + recoveryBounds.width).toBeLessThanOrEqual(playerBounds.x + playerBounds.width + 1);
      expectNoOverlap(titleBounds, statusBounds);
      expectNoOverlap(copyBounds, actionsBounds);
      expectNoOverlap(retryBounds, skipBounds);
    };

    await assertLayout(320);
    await page.setViewportSize({ width: 1280, height: 900 });
    await assertLayout(1280);
  });
});

test.describe("Chhath Radio — Admin Link", () => {
  test("admin page is accessible at /admin", async ({ page }) => {
    await mockPlaybackEnvironment(page);
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toMatch(/\/admin/);
    await expect(page).toHaveTitle(/.+/);
  });
});

test.describe("Chhath Radio — Facts ticker", () => {
  test("stays above the player and hides while the playlist is open", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 820 });
    await openRadio(page);
    await startFromSplash(page);

    const fact = page.locator('[aria-label="Chhath Puja fact"]');
    const player = page.getByRole("region", { name: "Radio player" });
    const expectFactAbovePlayer = async () => {
      await expect(fact).toBeVisible();
      const factBounds = await fact.boundingBox();
      const playerBounds = await player.boundingBox();
      expect(factBounds, "fact should have visible bounds").not.toBeNull();
      expect(playerBounds, "player should have visible bounds").not.toBeNull();
      expect(factBounds!.y + factBounds!.height).toBeLessThanOrEqual(playerBounds!.y);
    };

    await expectFactAbovePlayer();
    await page.getByRole("button", { name: "Toggle playlist" }).click();
    await expect(page.getByRole("button", { name: "Close playlist" })).toBeVisible();
    await expect(fact).toHaveCount(0);

    await page.getByRole("button", { name: "Close playlist" }).click();
    await expectFactAbovePlayer();

    await page.setViewportSize({ width: 1280, height: 900 });
    await expectFactAbovePlayer();
  });
});

test("controlled fixture startup timings", async ({ page }, testInfo) => {
  test.skip(process.env.PLAYBACK_PERF !== "1", "opt-in performance evidence run");
  test.setTimeout(120_000);
  await mockPlaybackEnvironment(page);

  const samples: Array<{ selectionToProgressMs: number; resolverMs: number }> = [];
  const sampleCount = 20;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("First E2E Song", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("dialog", { name: /click to start/i })).toBeVisible({ timeout: 5_000 });
    await page.evaluate(() => {
      (window as Window & { __radioSelectionStartedAt?: number }).__radioSelectionStartedAt = performance.now();
    });
    await startFromSplash(page);
    await expect(page.getByRole("status").first()).toContainText("On air", { timeout: 5_000 });

    samples.push(await page.evaluate(() => {
      const timingWindow = window as Window & {
        __radioFirstProgressAt?: number;
        __radioSelectionStartedAt?: number;
        __radioResolverStartedAt?: number;
        __radioResolverFinishedAt?: number;
      };
      const selectionStartedAt = timingWindow.__radioSelectionStartedAt;
      const firstProgressAt = timingWindow.__radioFirstProgressAt;
      const resolverStartedAt = timingWindow.__radioResolverStartedAt;
      const resolverFinishedAt = timingWindow.__radioResolverFinishedAt;
      if (
        selectionStartedAt === undefined
        || firstProgressAt === undefined
        || resolverStartedAt === undefined
        || resolverFinishedAt === undefined
      ) throw new Error("Fixture timing instrumentation did not observe the full startup path");
      return {
        selectionToProgressMs: firstProgressAt - selectionStartedAt,
        resolverMs: resolverFinishedAt - resolverStartedAt,
      };
    }));
  }

  const quantile = (values: number[], q: number) => {
    const ordered = [...values].sort((a, b) => a - b);
    return Number(ordered[Math.ceil(q * ordered.length) - 1].toFixed(1));
  };
  const report = {
    engine: testInfo.project.name,
    n: samples.length,
    selectionToProgressMs: {
      p50: quantile(samples.map((sample) => sample.selectionToProgressMs), 0.5),
      p95: quantile(samples.map((sample) => sample.selectionToProgressMs), 0.95),
    },
    resolverHttpMs: {
      p50: quantile(samples.map((sample) => sample.resolverMs), 0.5),
      p95: quantile(samples.map((sample) => sample.resolverMs), 0.95),
    },
  };
  console.log(`PLAYBACK_PERF ${JSON.stringify(report)}`);
});
