/**
 * Phase 9.2 & 9.3: Playwright E2E Tests for Chhath Radio
 *
 * These tests run against the live Next.js dev server.
 * They verify:
 * - The page loads with the correct title
 * - The Play button is accessible and has the correct aria-label
 * - The Admin login page renders correctly
 * - Accessibility: key elements have aria-labels
 */

import { test, expect } from "@playwright/test";

test.describe("Chhath Radio — Public Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page has the correct title", async ({ page }) => {
    await expect(page).toHaveTitle(/Chhath Radio/);
  });

  test("page shows the Chhath Radio heading", async ({ page }) => {
    await expect(page.getByText("Chhath Radio")).toBeVisible();
  });

  test("Play button is visible and has correct aria-label", async ({ page }) => {
    // Wait for the radio player to initialize
    const playButton = page.getByRole("button", { name: /play/i });
    await expect(playButton).toBeVisible({ timeout: 10_000 });
  });

  test("radio controls group has accessible label", async ({ page }) => {
    const controls = page.getByRole("group", { name: "Radio controls" });
    await expect(controls).toBeVisible({ timeout: 10_000 });
  });

  test("page has a link to the admin dashboard", async ({ page }) => {
    const adminLink = page.getByRole("link", { name: /admin/i });
    await expect(adminLink).toBeVisible();
    await expect(adminLink).toHaveAttribute("href", "/admin");
  });
});

test.describe("Chhath Radio — Admin Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
  });

  test("admin login form is visible", async ({ page }) => {
    await expect(page.getByRole("form", { name: "Admin login" })).toBeVisible();
  });

  test("email and password fields are present", async ({ page }) => {
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("sign in button is present", async ({ page }) => {
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.getByLabel("Email").fill("wrong@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should show an error message
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });
  });
});