// @ts-check

import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testResultsDir = process.env.PW_TEST_RESULTS_DIR || "test-results";
const htmlReportDir = process.env.PW_HTML_REPORT_DIR || "playwright-report";
const blobReportDir = process.env.PW_BLOB_REPORT_DIR || "blob-report";

/**
 * Playwright reporters.
 *
 * Every run emits JSON, JUnit, and HTML reports.
 * CI additionally emits a blob report for shard aggregation.
 *
 * The blob reporter is important because the 8 shards are merged later
 * into one consolidated Playwright report.
 */
const reporter = [
  ["list"],
  ["json", { outputFile: path.join(testResultsDir, "results.json") }],
  ["junit", { outputFile: path.join(testResultsDir, "junit.xml") }],
  [
    "html",
    {
      open: "never",
      outputFolder: htmlReportDir,
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
      outputDir: blobReportDir,
    },
  ]);
}

export default defineConfig({
  /**
   * Existing project structure.
   */
  testDir: "./tests",
  outputDir: testResultsDir,
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

  maxFailures: process.env.CI ? 0 : undefined,
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
    video: "retain-on-failure",

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
