import { defineConfig, devices } from "@playwright/test";

/**
 * Run E2E tests in headed (visible browser) or headless mode.
 *
 * Headless (default):
 *   npx playwright test
 *   make test SUITE=e2e
 *
 * Headed (visible browser window — useful for debugging):
 *   HEADED=1 npx playwright test
 *   HEADED=1 make test SUITE=e2e
 */
const headed = !!process.env.HEADED;

export default defineConfig({
  testDir: "./__tests__/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    headless: !headed,
    // Slow down actions in headed mode so you can follow along
    launchOptions: headed ? { slowMo: 300 } : {},
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Start the Next.js dev server before running tests
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});