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
  beginTestDiagnostics,
  getTestDiagnostics,
  recordDiagnostic,
} from "../utils/helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "..", "extension");
const CLEANUP_TIMEOUT_MS = Number(process.env.PW_CLEANUP_TIMEOUT_MS) || 15_000;

async function bestEffortCleanup(label, operation, timeoutMs = CLEANUP_TIMEOUT_MS) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return true;
  } catch (error) {
    recordDiagnostic({
      severity: "error",
      message: `${label}: ${error.message || String(error)}`,
      stackTrace: error.stack || "",
      source: "playwright-cleanup",
    });
    console.warn(`[PLAYWRIGHT CLEANUP] ${label}: ${error.message || String(error)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function resolveExtensionRoot() {
  const candidates = [
    EXTENSION_PATH,
    path.resolve(process.cwd(), "extension"),
    path.resolve(process.cwd(), "MrSid_Extension_V1.8"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "manifest.json"))) {
      return path.resolve(candidate);
    }
  }
  throw new Error(
    `Unpacked extension not found. Looked for manifest.json under:\n` +
      candidates.map((candidate) => `  - ${candidate}`).join("\n") +
      "\nCopy Frontend_V1.8/MrSid_Extension_V1.8 into ./extension"
  );
}

async function getExtensionId(context, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      if (worker.url().startsWith("chrome-extension://")) {
        return new URL(worker.url()).hostname;
      }
    }
    for (const page of context.backgroundPages()) {
      if (page.url().startsWith("chrome-extension://")) {
        return new URL(page.url()).hostname;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  try {
    const worker = await context.waitForEvent("serviceworker", { timeout: 5_000 });
    if (worker.url().startsWith("chrome-extension://")) {
      return new URL(worker.url()).hostname;
    }
  } catch {
    /* fall through */
  }

  throw new Error(
    `Chrome extension service worker did not start within ${timeoutMs}ms. ` +
      `Resolved extension path: ${resolveExtensionRoot()}`
  );
}

async function launchExtensionContext(videoDir) {
  const extensionRoot = resolveExtensionRoot();
  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pw-mrsid-"));
  const headless = process.env.HEADLESS === "true";
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
    timeout: Number(process.env.PW_BROWSER_LAUNCH_TIMEOUT_MS) || 180_000,
    args,
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: null,
    recordVideo: { dir: videoDir },
    ...(process.env.PW_CHANNEL
      ? { channel: process.env.PW_CHANNEL }
      : process.platform === "win32"
        ? { channel: "chromium" }
        : {}),
  };
  if (process.env.USE_SYSTEM_CHROME === "true") options.channel = "chrome";

  try {
    const context = await chromium.launchPersistentContext(userDataDir, options);
    context._mrsidUserDataDir = userDataDir;
    return { context, extensionRoot, userDataDir };
  } catch (error) {
    await bestEffortCleanup("remove failed browser profile", () =>
      fs.promises.rm(userDataDir, { recursive: true, force: true })
    );
    throw error;
  }
}

async function persistShardDiagnostics() {
  const shard = String(Number(process.env.SHARD) || 0).padStart(2, "0");
  const diagnosticsDir = path.resolve(process.env.PW_DIAGNOSTICS_DIR || "diagnostics");
  const diagnosticsPath = path.join(diagnosticsDir, `shard-${shard}.json`);
  await fs.promises.mkdir(path.dirname(diagnosticsPath), { recursive: true });
  let existing = [];
  try {
    existing = JSON.parse(await fs.promises.readFile(diagnosticsPath, "utf8"));
  } catch {
    /* first test in this shard */
  }
  const temporaryPath = `${diagnosticsPath}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryPath, JSON.stringify([...existing, ...getTestDiagnostics()], null, 2));
  await fs.promises.rename(temporaryPath, diagnosticsPath);
}

export const test = base.extend({
  context: async ({}, use, testInfo) => {
    const videoDir = testInfo.outputPath("recorded-videos");
    await fs.promises.mkdir(videoDir, { recursive: true });
    clearDiagnostics();
    beginTestDiagnostics(testInfo.titlePath.join(" › "));

    let launched;
    try {
      launched = await launchExtensionContext(videoDir);
    } catch (error) {
      recordDiagnostic({
        severity: "error",
        message: error.message || String(error),
        stackTrace: error.stack || "",
        source: "browser-launch",
      });
      await persistShardDiagnostics();
      throw error;
    }
    const { context, userDataDir } = launched;
    const pendingMemorySnapshots = new Set();
    const videos = new Set();
    let tracingStarted = false;
    const failure = () => ["failed", "timedOut"].includes(testInfo.status);

    const captureMemory = (page, phase) => {
      if (page.isClosed()) return;
      let task;
      task = (async () => {
        const session = await context.newCDPSession(page);
        try {
          await session.send("Performance.enable");
          const { metrics } = await session.send("Performance.getMetrics");
          const values = Object.fromEntries(
            metrics
              .filter((metric) => ["JSHeapUsedSize", "JSHeapTotalSize", "Nodes", "Documents"].includes(metric.name))
              .map((metric) => [metric.name, metric.value])
          );
          recordDiagnostic({
            severity: "info",
            message: JSON.stringify({ phase, url: page.url(), ...values }),
            source: "browser-memory",
          });
        } finally {
          await session.detach().catch(() => {});
        }
      })()
        .catch((error) => recordDiagnostic({
          severity: "info",
          message: `Memory snapshot unavailable (${phase}): ${error.message}`,
          source: "browser-memory",
        }))
        .finally(() => pendingMemorySnapshots.delete(task));
      pendingMemorySnapshots.add(task);
    };

    const collectPage = (page) => {
      const video = page.video();
      if (video) videos.add(video);
      page.on("console", (message) => {
        const type = message.type();
        recordDiagnostic({
          severity: type === "error" ? "error" : ["warning", "warn"].includes(type) ? "warning" : "info",
          message: message.text(),
          source: `browser-console:${type}`,
        });
      });
      page.on("pageerror", (error) => recordDiagnostic({
        severity: "error", message: error.message, stackTrace: error.stack, source: "pageerror",
      }));
      page.on("crash", () => recordDiagnostic({
        severity: "error", message: `Page crashed: ${page.url()}`, source: "page-crash",
      }));
      page.on("requestfailed", (request) => recordDiagnostic({
        severity: "error",
        message: `${request.method()} ${request.url()} failed: ${request.failure()?.errorText || "unknown network error"}`,
        source: "network-request",
      }));
      page.on("response", (response) => {
        if (response.status() >= 400) recordDiagnostic({
          severity: "error",
          message: `${response.status()} ${response.request().method()} ${response.url()}`,
          source: "http-response",
        });
      });
    };

    context.pages().forEach((page) => {
      collectPage(page);
      captureMemory(page, "page-open");
    });
    context.on("page", (page) => {
      collectPage(page);
      captureMemory(page, "page-open");
    });

    const collectServiceWorker = (worker) => {
      worker.on("console", (message) => recordDiagnostic({
        severity: message.type() === "error" ? "error" : ["warning", "warn"].includes(message.type()) ? "warning" : "info",
        message: message.text(),
        source: "extension-console",
      }));
    };
    context.serviceWorkers().forEach(collectServiceWorker);
    context.on("serviceworker", collectServiceWorker);
    try {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      tracingStarted = true;
    } catch (error) {
      recordDiagnostic({ severity: "warning", message: error.message, source: "playwright-trace" });
      tracingStarted = false;
    }

    try {
      await use(context);
    } finally {
      if (failure()) {
        const page = context.pages().filter((candidate) => !candidate.isClosed()).at(-1);
        await bestEffortCleanup("capture failure evidence", () => captureTestFailure(page, testInfo));
      }
      for (const page of context.pages()) captureMemory(page, "test-end");
      await bestEffortCleanup(
        "collect memory snapshots",
        () => Promise.allSettled([...pendingMemorySnapshots]),
        Math.min(CLEANUP_TIMEOUT_MS, 5_000)
      );

      // Save videos BEFORE closing the context — saveAs fails after close.
      if (getWarnings().length > 0 || failure() || testInfo.retry > 0) {
        for (const [index, video] of [...videos].entries()) {
          const file = testInfo.outputPath(`video-${index + 1}.webm`);
          const saved = await bestEffortCleanup(
            `save video ${index + 1}`,
            () => video.saveAs(file),
            Math.max(CLEANUP_TIMEOUT_MS, 30_000)
          );
          if (saved) {
            await bestEffortCleanup(`attach video ${index + 1}`, () =>
              testInfo.attach(`browser-video-${index + 1}`, { path: file, contentType: "video/webm" })
            );
          }
        }
      }

      const tracePath = testInfo.outputPath("trace.zip");
      if (tracingStarted) {
        if (failure() || testInfo.retry > 0) {
          const saved = await bestEffortCleanup("save trace", () =>
            context.tracing.stop({ path: tracePath })
          );
          if (saved) {
            await bestEffortCleanup("attach trace", () =>
              testInfo.attach("trace", { path: tracePath, contentType: "application/zip" })
            );
          }
        } else {
          await bestEffortCleanup("stop trace", () => context.tracing.stop());
        }
      }

      const closed = await bestEffortCleanup("close browser context", () => context.close());
      if (!closed) {
        await bestEffortCleanup("force close browser", () => context.browser()?.close());
      }

      await persistShardDiagnostics();
      await bestEffortCleanup(
        "remove browser profile",
        () => fs.promises.rm(userDataDir, { recursive: true, force: true }),
        5_000
      );
    }
  },

  extensionId: async ({ context }, use) => {
    const id = await getExtensionId(context, 60_000);
    await use(id);
  },

  popupPage: async ({ context, extensionId }, use) => {
    const page = context.pages().find((candidate) => !candidate.isClosed()) ?? await context.newPage();
    await use(new PopupPage(page, extensionId));
  },

  mapPageFactory: async ({ context, extensionId }, use) => {
    await use((page) => new MapPage(page, extensionId));
  },
});

export { expect };
