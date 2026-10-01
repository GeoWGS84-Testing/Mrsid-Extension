// @ts-check

import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Playwright reporters.
 *
 * Local:
 *   - list
 *   - HTML
 *
 * CI:
 *   - list
 *   - HTML
 *   - blob
 *
 * The blob reporter is important because the 8 shards are merged later
 * into one consolidated Playwright report.
 */
const reporter = [
  ["list"],
  [
    "html",
    {
      open: "never",
      outputFolder: "playwright-report",
    },
  ],
];

if (process.env.ENABLE_EMAIL_REPORTER === "true") {
  reporter.push(["./reporter/email-reporter.cjs"]);
}

if (process.env.CI) {
  reporter.push([
    "blob",
    {
      outputDir: "blob-report",
    },
  ]);
}

export default defineConfig({
  /**
   * Existing project structure.
   */
  testDir: "./tests",
  testMatch: "**/*.spec.js",

  /**
   * IMPORTANT FOR SHARDING
   *
   * true allows Playwright to distribute individual tests across shards
   * rather than treating every entire spec file as one indivisible unit.
   *
   * Each shard still uses workers=1 in CI, so tests are NOT executed
   * concurrently inside the same runner.
   */
  fullyParallel: true,

  /**
   * CI protection.
   */
  forbidOnly: !!process.env.CI,

  /**
   * Keep your existing retry behavior.
   */
  retries: process.env.CI ? 1 : 0,

  /**
   * Extension contexts are heavy.
   *
   * We deliberately keep ONE worker per GitHub Actions runner.
   *
   * Parallelism comes from the 8 GitHub Actions shards, not from multiple
   * Chromium extension workers inside one runner.
   */
  workers: 1,

  /**
   * Your existing timing configuration.
   */
  timeout: 180_000,

  expect: {
    timeout: 20_000,
  },

  reporter,

  use: {
    /**
     * Extension fixture already defaults to headed mode.
     *
     * CI workflow passes HEADLESS=false by default.
     */
    headless: process.env.HEADLESS === "true",

    /**
     * Preserve current troubleshooting behavior.
     */
    trace: "on-first-retry",

    /**
     * Failure screenshots.
     */
    screenshot: "only-on-failure",

    /**
     * Keep video enabled.
     */
    video: "on",

    /**
     * Preserve existing action/navigation timeouts.
     */
    actionTimeout: 30_000,

    navigationTimeout: 60_000,

    /**
     * Extension window should use the available screen size.
     */
    viewport: null,

    launchOptions: {
      slowMo: Number(process.env.PW_SLOWMO || 0),
    },
  },

  projects: [
    {
      name: "chromium-extension",

      use: {
        viewport: null,
      },
    },
  ],
});
