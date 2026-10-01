// @ts-check
import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('@playwright/test').ReporterDescription[]} */
const reporter = [
  ["list"],
  ["html", { open: "never", outputFolder: "playwright-report" }],
];

if (process.env.ENABLE_EMAIL_REPORTER === "true") {
  reporter.push(["./reporter/email-reporter.cjs"]);
}

if (process.env.CI) {
  reporter.push(["blob", { outputDir: "blob-report" }]);
}

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Extension contexts are heavy — keep workers at 1
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },

  reporter,

  use: {
    // Extensions require headed mode on most Windows setups
    headless: process.env.HEADLESS === "true",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
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
