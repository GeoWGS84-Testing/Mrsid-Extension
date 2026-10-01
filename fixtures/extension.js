import { test as base, chromium, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { PopupPage } from "../pages/PopupPage.js";
import { MapPage } from "../pages/MapPage.js";
import {
  captureTestFailure,
  clearDiagnostics,
  getWarnings,
} from "../utils/helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "..", "extension");

/**
 * Resolve absolute path and verify the unpacked extension exists.
 */
function resolveExtensionRoot() {
  const candidates = [
    EXTENSION_PATH,
    path.resolve(process.cwd(), "extension"),
    path.resolve(process.cwd(), "MrSid_Extension_V1.8"),
  ];
  for (const candidate of candidates) {
    const manifest = path.join(candidate, "manifest.json");
    if (fs.existsSync(manifest)) {
      // Playwright / Chromium need a real absolute path (no trailing slash issues)
      return path.resolve(candidate);
    }
  }
  throw new Error(
    `Unpacked extension not found. Looked for manifest.json under:\n` +
      candidates.map((c) => `  - ${c}`).join("\n") +
      `\nCopy Frontend_V1.8/MrSid_Extension_V1.8 into ./extension`
  );
}

/**
 * Wait until the MV3 service worker (or legacy background page) appears,
 * then return the extension id (hostname of chrome-extension:// URL).
 *
 * Headless Chromium often never starts extension SWs — use headed mode.
 */
async function getExtensionId(context, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // MV3 service worker
    for (const sw of context.serviceWorkers()) {
      const url = sw.url();
      if (url.startsWith("chrome-extension://")) {
        return new URL(url).hostname;
      }
    }
    // MV2 background page fallback
    for (const page of context.backgroundPages()) {
      const url = page.url();
      if (url.startsWith("chrome-extension://")) {
        return new URL(url).hostname;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Last attempt: event-based wait
  try {
    const sw = await context.waitForEvent("serviceworker", { timeout: 5_000 });
    if (sw.url().startsWith("chrome-extension://")) {
      return new URL(sw.url()).hostname;
    }
  } catch {
    /* fall through */
  }

  throw new Error(
    "Chrome extension service worker did not start within " +
      `${timeoutMs}ms.\n` +
      "Common causes on Windows:\n" +
      "  1. Tests ran headless — extensions need headed Chromium (HEADLESS=false).\n" +
      "  2. Extension folder missing or has no manifest.json.\n" +
      "  3. Path to extension is wrong (must be absolute).\n" +
      `Resolved extension path: ${resolveExtensionRoot()}`
  );
}

/**
 * Launch Chromium with the unpacked MrSID Viewer extension.
 * Defaults to HEADED mode because headless often skips extension SWs on Windows.
 */
async function launchExtensionContext(videoDir) {
  const extensionRoot = resolveExtensionRoot();
  const userDataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "pw-mrsid-")
  );

  // Headless breaks extension loading on many Playwright + Windows setups.
  // Override with HEADLESS=true only if you know your environment supports it.
  const headless =
    process.env.HEADLESS === "true"
      ? true
      : process.env.HEADLESS === "false"
        ? false
        : false; // default headed

  const args = [
    `--disable-extensions-except=${extensionRoot}`,
    `--load-extension=${extensionRoot}`,
    "--no-sandbox",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized",
  ];

  /** @type {import('@playwright/test').LaunchPersistentContextOptions} */
  const options = {
    headless,
    args,
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: null,
    recordVideo: { dir: videoDir },
    // Prefer system Chrome when available (better extension support on Windows)
    ...(process.env.PW_CHANNEL
      ? { channel: process.env.PW_CHANNEL }
      : process.platform === "win32"
        ? { channel: "chromium" }
        : {}),
  };

  // channel: "chrome" uses installed Google Chrome if present
  if (process.env.USE_SYSTEM_CHROME === "true") {
    options.channel = "chrome";
  }

  const context = await chromium.launchPersistentContext(userDataDir, options);

  // Attach cleanup of temp profile
  context._mrsidUserDataDir = userDataDir;

  return { context, extensionRoot, userDataDir };
}

/**
 * Playwright fixture: loads unpacked extension, resolves ID, exposes page objects.
 *
 * Usage:
 *   import { test, expect } from "../fixtures/extension.js";
 */
export const test = base.extend({
  context: async ({}, use, testInfo) => {
    const videoDir = testInfo.outputPath("recorded-videos");
    await fs.promises.mkdir(videoDir, { recursive: true });
    clearDiagnostics();
    const { context, userDataDir } = await launchExtensionContext(videoDir);
    const failure = () => ["failed", "timedOut"].includes(testInfo.status);
    const videos = context.pages()
      .map((page) => page.video())
      .filter(Boolean);
    try {
      await use(context);
    } finally {
      if (failure()) {
        const page = context.pages().filter((candidate) => !candidate.isClosed()).at(-1);
        await captureTestFailure(page, testInfo).catch(() => {});
      }
      await context.close().catch(() => {});
      if (getWarnings().length > 0 || failure()) {
        for (const [index, video] of videos.entries()) {
          try {
            const file = testInfo.outputPath(`video-${index + 1}.webm`);
            await video.saveAs(file);
            await testInfo.attach(`browser-video-${index + 1}`, {
              path: file,
              contentType: "video/webm",
            });
          } catch {
            /* video may be unavailable if Chromium exited unexpectedly */
          }
        }
      }
      // Best-effort cleanup of temp profile
      try {
        await fs.promises.rm(userDataDir, { recursive: true, force: true });
      } catch {
        /* ignore locked files on Windows */
      }
    }
  },

  extensionId: async ({ context }, use) => {
    const id = await getExtensionId(context, 60_000);
    await use(id);
  },

  popupPage: async ({ context, extensionId }, use) => {
    // Reuse first blank page if present, otherwise open a new one
    const page =
      context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
    const popup = new PopupPage(page, extensionId);
    await use(popup);
  },

  mapPageFactory: async ({ context, extensionId }, use) => {
    await use((page) => new MapPage(page, extensionId));
  },
});

export { expect };
