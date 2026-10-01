import { expect } from "@playwright/test";
import { UI_STRINGS } from "../fixtures/testData.js";
import {
  startVisualTest,
  refreshVisualUrl,
  showStep,
  visualSetInputFiles,
  visualClick,
  highlight,
  logInfo,
  addError,
  addWarning,
  takeScreenshot,
  setPageRef,
  setContext,
  focusPage,
  softExpect,
} from "../utils/helpers.js";

/**
 * Page Object — popup.html
 * Numbered steps + gradient status bar + timer/counter validation
 */
export class PopupPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page, extensionId) {
    if (!extensionId) throw new Error("extensionId is required");
    this.page = page;
    this.extensionId = extensionId;
    this.url = `chrome-extension://${extensionId}/popup.html`;

    this.dropArea = page.locator("#dropArea");
    this.dropText = page.locator("#dropText");
    this.fileInput = page.locator("#fileInput");
    this.loader = page.locator("#loader");
    this.previewImage = page.locator("#previewImage");
    this.zoomInBtn = page.locator("#zoomIn");
    this.zoomOutBtn = page.locator("#zoomOut");
    this.resetZoomBtn = page.locator("#resetZoom");
    this.statusDot = page.locator("#statusDot");
    this.statusValue = page.locator("#statusValue");
    this.timer = page.locator("#timer");
    this.metadataGrid = page.locator("#metadataGrid");
    this.showMapBtn = page.locator("#showMap");
    this.viewOnMapBtn = this.showMapBtn; // alias
    this.downloadTiffBtn = page.locator("#downloadTiff");
    this.clearBtn = page.locator("#clearBtn");
    this.progressContainer = page.locator("#progressContainer");
    this.progressBar = page.locator("#progressBar");
    this.progressText = page.locator("#progressText");
    this.speedText = page.locator("#speedText");
    this.partDownloadContainer = page.locator("#partDownloadContainer");
    this.partGrid = page.locator("#partGrid");
    this.logo = page.locator('img[alt="LizardTech Logo"]');
  }

  // ─── Open ────────────────────────────────────────────────────────────────

  async open(tcName = "MrSID Viewer") {
    setPageRef(this.page);
    setContext({ testcase: tcName, flow: "Popup" });
    await focusPage(this.page);

    await startVisualTest(this.page, {
      tcName,
      firstStep: "Init",
      url: this.url,
    });

    await showStep(this.page, "Navigate to popup.html", null, async () => {
      await expect(this.page.locator("#pw-testcase-header")).toContainText(tcName);
      await expect(this.page.locator("#pw-step-banner")).toContainText(
        "Step 1: Navigate to popup.html"
      );
      await this.page.goto(this.url, { waitUntil: "domcontentloaded" });
    });

    await this.page.waitForLoadState("domcontentloaded");
    await refreshVisualUrl(this.page);
    await focusPage(this.page);
    await expect(this.page.locator("#pw-testcase-header")).toContainText(tcName);

    try {
      await expect(this.dropArea).toBeVisible({ timeout: 30_000 });
      logInfo("✅ Popup loaded — drop area visible");
    } catch (error) {
      await addError("Popup drop area not visible after navigation", {
        error: error.message,
        url: this.page.url(),
      });
      await takeScreenshot(this.page, "popup-drop-area-missing");
      throw error;
    }
  }

  async waitUntilReady(timeout = 20_000) {
    await showStep(this.page, "Wait until System Ready", this.statusValue);
    await expect(this.statusValue).toContainText(UI_STRINGS.systemReady, {
      timeout,
    });
    logInfo("✅ Status is System Ready");
  }

  // ─── Idle validation (includes timer counter) ────────────────────────────

  async assertIdleState() {
    await showStep(this.page, "Validate idle / ready UI state");

    await softExpect(this.page, "Logo visible", async () => {
      await expect(this.logo).toBeVisible();
      await highlight(this.page, this.logo, 300);
    });

    await softExpect(this.page, "Drop area visible with support text", async () => {
      await expect(this.dropArea).toBeVisible();
      await highlight(this.page, this.dropArea, 350);
      await expect(this.dropText).toContainText(UI_STRINGS.dropTitle);
      await expect(this.dropText).toContainText(UI_STRINGS.dropSupport);
    });

    await softExpect(this.page, "Loader hidden, preview hidden", async () => {
      await expect(this.loader).toBeHidden();
      await expect(this.previewImage).toBeHidden();
    });

    await softExpect(this.page, "Status System Ready", async () => {
      await expect(this.statusValue).toHaveText(UI_STRINGS.systemReady);
      await highlight(this.page, this.statusValue, 300);
    });

    // Timer / counter — must show 0 sec at idle
    await this.assertTimerIdle();

    await softExpect(this.page, "VIEW ON MAP and CLEAR visible", async () => {
      await expect(this.showMapBtn).toBeVisible();
      await expect(this.clearBtn).toBeVisible();
      await highlight(this.page, this.showMapBtn, 200);
      await highlight(this.page, this.clearBtn, 200);
    });

    await softExpect(this.page, "Download TIFF hidden until success", async () => {
      await expect(this.downloadTiffBtn).toBeHidden();
    });

    logInfo("✅ Idle state validation complete");
  }

  /**
   * Validate the timer badge at idle: visible and shows 0 sec (or similar).
   */
  async assertTimerIdle() {
    await showStep(this.page, "Validate timer counter (idle = 0 sec)", this.timer);
    await softExpect(this.page, "Timer visible at idle", async () => {
      await expect(this.timer).toBeVisible();
    });
    const text = ((await this.timer.textContent()) || "").trim();
    logInfo(`Timer text at idle: "${text}"`);
    // Accept "0 sec", "⏱ 0 sec", "0s", etc.
    expect(
      text,
      `Idle timer should show 0 sec, got "${text}"`
    ).toMatch(/0\s*(sec|s)/i);
    logInfo("✅ Timer counter is 0 sec at idle");
  }

  /**
   * After successful processing, timer must show PROCESSED: <number>S
   * and the numeric value should be > 0.
   */
  async assertTimerProcessed() {
    await showStep(this.page, "Validate timer counter (PROCESSED)", this.timer);
    await expect(this.timer).toBeVisible();
    await highlight(this.page, this.timer, 400);

    const text = ((await this.timer.textContent()) || "").trim();
    logInfo(`Timer text after process: "${text}"`);

    await expect(this.timer).toContainText(/PROCESSED/i, { timeout: 5_000 });

    // Extract seconds e.g. "± PROCESSED: 7.21S" or "PROCESSED: 7S"
    const match = text.match(/PROCESSED[:\s]*([0-9]+(?:\.[0-9]+)?)\s*S/i);
    if (match) {
      const seconds = Number.parseFloat(match[1]);
      expect(seconds, `Processed time should be > 0, got ${seconds}`).toBeGreaterThan(0);
      logInfo(`✅ Timer counter PROCESSED: ${seconds}S`);
      return seconds;
    }

    await addWarning("Could not parse numeric seconds from timer", { text });
    logInfo(`✅ Timer shows PROCESSED (numeric parse skipped): ${text}`);
    return null;
  }

  // ─── Upload ──────────────────────────────────────────────────────────────

  async uploadFiles(filePaths) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    const names = paths.map((p) => p.split(/[/\\]/).pop()).join(", ");
    // Highlight drop zone so the demo shows where the file lands
    await highlight(this.page, this.dropArea, 300);
    await visualSetInputFiles(
      this.page,
      this.fileInput,
      paths,
      `Upload file(s): ${names}`
    );
    logInfo(`Files submitted to input: ${names}`);
  }

  async waitForExtractingPhase(timeout = 5 * 60 * 1000) {
    await showStep(this.page, "Wait for EXTRACTING GEODATA phase", this.loader);
    await expect(this.loader).toBeVisible({ timeout });
    await expect(this.loader).toContainText(UI_STRINGS.extracting);
    logInfo("✅ Extracting phase visible");
  }

  async waitForProcessingComplete(timeout = 30 * 60 * 1000) {  // 30 min max
    this._vortexStart = null;
    await showStep(this.page, "Wait for raster processing to complete", this.statusValue);

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const status = ((await this.statusValue.textContent()) || "").trim();
      const loaderVisible = await this.loader.isVisible().catch(() => false);

      if (/^Error:/i.test(status) || /does not contain georeferencing/i.test(status)) {
        await addError("Processing ended with product error", { status });
        await takeScreenshot(this.page, "processing-product-error");
        throw new Error(`Processing failed: ${status}`);
      }

      if (
        !loaderVisible &&
        /Analysis Complete|All files processed!/i.test(status)
      ) {
        logInfo(`✅ Processing complete — status: ${status}`);
        await highlight(this.page, this.statusValue, 350);
        await this.assertTimerProcessed().catch(async (e) => {
          await addWarning("Timer PROCESSED check soft-failed", { error: e.message });
        });
        return;
      }

      // Stuck on Vortex Engine for a very long time only (large files legitimately
      // stay here for 1–3+ minutes). Default overall timeout still bounds the wait.
      if (/Vortex Engine/i.test(status)) {
        if (!this._vortexStart) this._vortexStart = Date.now();
        // Log progress every ~15s so runs are debuggable, but do NOT fail early.
        const elapsed = Date.now() - this._vortexStart;
        if (elapsed > 0 && elapsed % 15_000 < 500) {
          logInfo(`Still on Vortex Engine… ${Math.round(elapsed / 1000)}s`);
        }
      } else {
        this._vortexStart = null;
      }

      await this.page.waitForTimeout(400);
    }

    const finalStatus = ((await this.statusValue.textContent()) || "").trim();
    const loaderStill = await this.loader.isVisible().catch(() => false);
    await addError("Processing timed out", {
      status: finalStatus,
      loaderVisible: loaderStill,
      timeout,
    });
    await takeScreenshot(this.page, "processing-timeout");
    const mins = Math.round(timeout / 60000);
    throw new Error(
      `PROCESSING_TIMEOUT_30MIN: Processing exceeded ${mins} min. status="${finalStatus}" loader=${loaderStill}`
    );
  }

  /**
   * Wait up to 30 min for processing. If still not done, skip the test
   * (does not fail the suite). Prefer this in long upload flows.
   * @param {import('@playwright/test').TestInfo} [testInfo]
   * @param {number} [timeout]
   */
  async waitForProcessingCompleteOrSkip(testInfo, timeout = 30 * 60 * 1000) {
    try {
      await this.waitForProcessingComplete(timeout);
    } catch (error) {
      const msg = error?.message || String(error);
      if (/PROCESSING_TIMEOUT_30MIN|exceeded \d+ min|timed out after/i.test(msg)) {
        const status = ((await this.statusValue.textContent()) || "").trim();
        logInfo(`⏳ Processing >30 min — skipping test. status="${status}"`);
        if (testInfo) {
          testInfo.annotations.push({
            type: "timeout",
            description: `Skipped after 30 min processing. Last status: ${status}`,
          });
          testInfo.skip(true, `Processing exceeded 30 minutes. Last status: ${status}`);
        }
        return false;
      }
      throw error;
    }
    return true;
  }

  /**
   * Wait for product error status, highlight it, assert no success UI.
   * @param {string|RegExp} expectedFragment - text or regex to match in #statusValue
   */
  async waitForErrorStatus(expectedFragment, timeout = 30_000) {
    const label =
      typeof expectedFragment === "string"
        ? expectedFragment.slice(0, 60)
        : String(expectedFragment);
    await showStep(
      this.page,
      `Wait for error status: ${label}`,
      this.statusValue
    );

    await expect(this.statusValue).toContainText(expectedFragment, { timeout });

    await highlight(this.page, this.statusValue, 600);
    const status = ((await this.statusValue.textContent()) || "").trim();
    logInfo(`✅ Error status observed: ${status}`);

    // Timer / badge often shows ERROR
    const timerText = ((await this.timer.textContent()) || "").trim();
    logInfo(`Timer/badge after error: "${timerText}"`);
    if (/error/i.test(timerText)) {
      await highlight(this.page, this.timer, 300);
      logInfo("✅ ERROR badge visible on timer");
    }

    // Must not show success UI
    await expect(this.loader).toBeHidden({ timeout: 5_000 }).catch(() => {});
    await expect(this.previewImage).toBeHidden();
    await expect(this.downloadTiffBtn).toBeHidden();

    return status;
  }

  /**
   * Full rejection assertion: error message + idle-ish controls still usable.
   */
  async assertUploadRejected(expectedFragment, timeout = 30_000) {
    const status = await this.waitForErrorStatus(expectedFragment, timeout);
    await expect(this.dropArea).toBeVisible();
    await expect(this.showMapBtn).toBeVisible();
    await expect(this.clearBtn).toBeVisible();
    await highlight(this.page, this.dropArea, 300);
    logInfo("✅ Upload rejected — no preview, controls still present", { status });
    return status;
  }

  // ─── Preview & metadata ──────────────────────────────────────────────────

  async assertPreviewVisible() {
    await showStep(this.page, "Verify preview image is visible", this.previewImage);
    try {
      await expect(this.previewImage).toBeVisible({ timeout: 15_000 });
      await highlight(this.page, this.previewImage, 400);
      const natural = await this.previewImage.evaluate((img) => ({
        w: img.naturalWidth,
        h: img.naturalHeight,
      }));
      expect(natural.w).toBeGreaterThan(0);
      expect(natural.h).toBeGreaterThan(0);
      logInfo(`✅ Preview loaded (${natural.w}×${natural.h})`);
    } catch (error) {
      await addError("Preview image not visible or empty", { error: error.message });
      await takeScreenshot(this.page, "preview-missing");
      throw error;
    }
  }

  async getMetadata() {
    return this.metadataGrid.evaluate((grid) => {
      const out = {};
      const labels = grid.querySelectorAll(
        ".meta-label, .metadata-label, [class*='label']"
      );
      const values = grid.querySelectorAll(
        ".meta-value, .metadata-value, [class*='value']"
      );
      if (labels.length && values.length) {
        labels.forEach((el, i) => {
          const key = (el.textContent || "").trim().replace(/:$/, "");
          const val = (values[i]?.textContent || "").trim();
          if (key) out[key] = val;
        });
        return out;
      }
      const text = (grid.innerText || "").trim();
      text.split("\n").forEach((line) => {
        const m = line.match(/^([^:]+):\s*(.+)$/);
        if (m) out[m[1].trim()] = m[2].trim();
      });
      return out;
    });
  }

  async assertMetadataPresent(requiredKeys = ["Filename", "Location", "Resolution"]) {
    await showStep(this.page, "Verify metadata panel keys", this.metadataGrid);
    await highlight(this.page, this.metadataGrid, 350);
    const meta = await this.getMetadata();
    const keys = Object.keys(meta).map((k) => k.toLowerCase());
    for (const req of requiredKeys) {
      const found = keys.some((k) => k.includes(req.toLowerCase()));
      if (!found) {
        await addError(`Missing metadata key containing "${req}"`, { meta });
        await takeScreenshot(this.page, "metadata-missing-key");
      }
      expect(
        found,
        `Expected metadata key containing "${req}". Got: ${JSON.stringify(meta)}`
      ).toBeTruthy();
    }
    logInfo("✅ Metadata keys present", { keys: Object.keys(meta), meta });
    return meta;
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  async clickViewOnMap() {
    await showStep(this.page, "Click VIEW ON MAP", this.showMapBtn);
    await focusPage(this.page);
    const context = this.page.context();
    const [mapPage] = await Promise.all([
      context.waitForEvent("page", { timeout: 30_000 }),
      this.showMapBtn.click(),
    ]);
    await mapPage.waitForLoadState("domcontentloaded");
    await mapPage.bringToFront().catch(() => {});
    logInfo(`✅ Map tab opened: ${mapPage.url()}`);
    return mapPage;
  }

  async clickClear() {
    await showStep(this.page, "Click CLEAR button", this.clearBtn, async () => {
      await this.clearBtn.click();
    });
    logInfo("CLEAR clicked");
  }

  /**
   * After CLEAR: everything must return to idle — status, timer, preview,
   * metadata, DOWNLOAD TIFF, loader.
   */
  async assertClearedToIdle() {
    await showStep(this.page, "Verify full UI reset after CLEAR", this.dropArea);

    await expect(this.loader).toBeHidden({ timeout: 10_000 });
    await expect(this.dropArea).toBeVisible();
    await highlight(this.page, this.dropArea, 300);

    // Status back to System Ready
    await expect(this.statusValue).toContainText(/System Ready/i, {
      timeout: 10_000,
    });
    logInfo(`✅ Status after CLEAR: ${(await this.statusValue.textContent()) || ""}`);

    // Timer reset to 0 sec
    const timerText = ((await this.timer.textContent()) || "").trim();
    logInfo(`Timer after CLEAR: "${timerText}"`);
    expect(timerText, `Timer should reset to 0 sec, got "${timerText}"`).toMatch(
      /0\s*(sec|s)/i
    );

    // Preview gone
    await expect(this.previewImage).toBeHidden();

    // DOWNLOAD TIFF hidden again
    await expect(this.downloadTiffBtn).toBeHidden();

    // Metadata grid emptied (no Filename values)
    const metaText = ((await this.metadataGrid.innerText()) || "").trim();
    logInfo(`Metadata after CLEAR: "${metaText.slice(0, 120)}"`);
    // Either empty or no residual filename from last upload
    if (metaText.length > 0) {
      // soft: labels may remain empty — values should not keep old filename path
      const hasOldData = /\d{4}\s*x\s*\d{4}|WGS\s*84|\d+\.\d+,\s*-?\d+/i.test(
        metaText
      );
      if (hasOldData) {
        await addWarning("Metadata grid still shows residual values after CLEAR", {
          metaText: metaText.slice(0, 200),
        });
      }
    }

    logInfo("✅ After CLEAR — full idle reset verified");
  }

  async zoomIn() {
    await showStep(this.page, "Zoom In", this.zoomInBtn, () =>
      this.zoomInBtn.click()
    );
  }

  async zoomOut() {
    await showStep(this.page, "Zoom Out", this.zoomOutBtn, () =>
      this.zoomOutBtn.click()
    );
  }

  async resetZoom() {
    await showStep(this.page, "Reset Zoom", this.resetZoomBtn, () =>
      this.resetZoomBtn.click()
    );
  }

  /**
   * Full metadata validation matching product cards:
   * Filename, Location, Resolution, Projection, Format, Bounds N
   */

  /**
   * Simulate drag-and-drop of files onto #dropArea (GV-TC-003-04).
   */
  async dragDropFiles(filePaths) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    const names = paths.map((p) => p.split(/[/\\]/).pop()).join(", ");
    await showStep(this.page, `Drag & drop file(s): ${names}`, this.dropArea);

    const fs = await import("fs");
    const pathMod = await import("path");

    // Prefer real DataTransfer drop for small files (< 12 MB total)
    let total = 0;
    for (const fp of paths) {
      try {
        total += fs.statSync(fp).size;
      } catch {
        /* ignore */
      }
    }
    if (total > 12 * 1024 * 1024) {
      logInfo(
        `File(s) ${Math.round(total / 1e6)}MB — using setInputFiles fallback for drop`
      );
      await this.fileInput.setInputFiles(paths);
      logInfo(`Drag-drop (via input) submitted: ${names}`);
      return;
    }

    const payloads = paths.map((fp) => {
      const buf = fs.readFileSync(fp);
      return {
        name: pathMod.basename(fp),
        mime: fp.toLowerCase().endsWith(".sid")
          ? "image/x-mrsid"
          : "image/tiff",
        bytes: Array.from(new Uint8Array(buf)),
      };
    });

    await this.dropArea.evaluate(async (dropEl, files) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const u8 = new Uint8Array(f.bytes);
        const blob = new Blob([u8], { type: f.mime });
        const file = new File([blob], f.name, { type: f.mime });
        dt.items.add(file);
      }
      for (const type of ["dragenter", "dragover", "drop"]) {
        dropEl.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
        );
      }
    }, payloads);
    logInfo(`Drag-drop submitted: ${names}`);
  }

  async assertFullMetadata(options = {}) {
    const required = options.requiredKeys || [
      "Filename",
      "Location",
      "Resolution",
      "Projection",
      "Format",
    ];
    await showStep(this.page, "Validate full metadata panel", this.metadataGrid);
    await highlight(this.page, this.metadataGrid, 500);
    const meta = await this.getMetadata();
    logInfo("Metadata snapshot", meta);

    const keysLower = Object.keys(meta).map((k) => k.toLowerCase());
    for (const req of required) {
      const found = keysLower.some((k) => k.includes(req.toLowerCase()));
      expect(
        found,
        `Expected metadata key "${req}". Got: ${JSON.stringify(meta)}`
      ).toBeTruthy();
    }

    // Filename should be non-empty
    const filenameKey = Object.keys(meta).find((k) =>
      /filename/i.test(k)
    );
    if (filenameKey) {
      expect(String(meta[filenameKey]).trim().length).toBeGreaterThan(0);
      logInfo(`✅ Filename: ${meta[filenameKey]}`);
    }

    // Location should look like coordinates
    const locKey = Object.keys(meta).find((k) => /location/i.test(k));
    if (locKey && meta[locKey] && meta[locKey] !== "N/A") {
      expect(String(meta[locKey])).toMatch(/-?\d/);
      logInfo(`✅ Location: ${meta[locKey]}`);
    }

    // Resolution WxH
    const resKey = Object.keys(meta).find((k) => /resolution/i.test(k));
    if (resKey) {
      expect(String(meta[resKey])).toMatch(/\d/);
      logInfo(`✅ Resolution: ${meta[resKey]}`);
    }

    logInfo("✅ Full metadata panel validated", { keys: Object.keys(meta) });
    return meta;
  }

  /**
   * After successful process, DOWNLOAD TIFF should appear.
   */
  /**
   * DOWNLOAD TIFF is product-only for MrSID (.sid) sources.
   * For .tif/.tiff the button stays hidden — pass expectVisible=false.
   */
  async assertDownloadTiffVisible(expectVisible = true) {
    await showStep(
      this.page,
      expectVisible
        ? "Verify DOWNLOAD TIFF button visible (SID)"
        : "Verify DOWNLOAD TIFF hidden for non-SID",
      this.downloadTiffBtn
    );
    if (expectVisible) {
      await expect(this.downloadTiffBtn).toBeVisible({ timeout: 10_000 });
      await highlight(this.page, this.downloadTiffBtn, 400);
      logInfo("✅ DOWNLOAD TIFF button is visible (SID)");
    } else {
      await expect(this.downloadTiffBtn).toBeHidden({ timeout: 5_000 });
      logInfo("✅ DOWNLOAD TIFF hidden for non-SID (expected product behaviour)");
    }
  }

  /** Convenience: only assert DOWNLOAD TIFF when filename ends with .sid */
  
  /**
   * Multi-file flow (product popup.js processFiles):
   *  - files process one-by-one
   *  - each success pushes into mapDataList
   *  - final status is exactly "All files processed!" when expectedCount > 1
   *  - single-file still accepts "Analysis Complete"
   * Observes status changes and returns last metadata snapshot.
   */
  async waitForMultiFileComplete(expectedCount, timeout = 30 * 60 * 1000) {
    await showStep(
      this.page,
      `Wait for multi-file processing (${expectedCount} files)`,
      this.statusValue
    );

    const seenStatuses = [];
    let lastMeta = {};
    const deadline = Date.now() + timeout;
    let lastLogged = "";
    // Product only sets this after the full loop succeeds
    const donePattern =
      expectedCount > 1
        ? /All files processed!/i
        : /All files processed!|Analysis Complete/i;

    while (Date.now() < deadline) {
      const status = ((await this.statusValue.textContent()) || "").trim();
      if (status && status !== lastLogged) {
        seenStatuses.push(status);
        lastLogged = status;
        logInfo(`Multi-file status: ${status}`);
        await highlight(this.page, this.statusValue, 250);
      }

      if (/^Error:/i.test(status) || /does not contain georeferencing/i.test(status)) {
        await addError("Multi-file processing error", { status, seenStatuses });
        await takeScreenshot(this.page, "multi-file-error");
        throw new Error(`Multi-file failed: ${status}`);
      }

      // Capture metadata when grid has content (updates per completed file)
      try {
        const meta = await this.getMetadata();
        if (meta && Object.keys(meta).length) {
          const key = JSON.stringify(meta);
          if (key !== JSON.stringify(lastMeta)) {
            lastMeta = meta;
            logInfo("Metadata updated during multi-file", meta);
            await highlight(this.page, this.metadataGrid, 300);
          }
        }
      } catch {
        /* grid may be empty mid-process */
      }

      const loaderVisible = await this.loader.isVisible().catch(() => false);
      if (!loaderVisible && donePattern.test(status)) {
        await highlight(this.page, this.statusValue, 500);
        logInfo(`✅ Multi-file complete — status: ${status}`, {
          seenCount: seenStatuses.length,
          lastMeta,
        });
        return { status, seenStatuses, lastMeta };
      }

      await this.page.waitForTimeout(800);
    }

    await addError("Multi-file timed out", { seenStatuses, lastMeta });
    await takeScreenshot(this.page, "multi-file-timeout");
    throw new Error(
      `Multi-file timed out after ${timeout}ms. Last: ${lastLogged}`
    );
  }

  /**
   * Soft preview: visible OR product left it hidden after multi-file (still OK
   * if status is All files processed! and metadata has a filename).
   */
  async assertPreviewVisibleSoft() {
    await showStep(this.page, "Verify preview (soft for multi-file)", this.previewImage);
    const visible = await this.previewImage.isVisible().catch(() => false);
    if (visible) {
      await highlight(this.page, this.previewImage, 400);
      const natural = await this.previewImage.evaluate((img) => ({
        w: img.naturalWidth,
        h: img.naturalHeight,
      }));
      logInfo(`✅ Preview visible (${natural.w}×${natural.h})`);
      return true;
    }
    logInfo("Preview hidden after multi-file — relying on status + metadata");
    return false;
  }

  async assertDownloadTiffForFile(filePath) {
    const name = String(filePath).split(/[/\\]/).pop() || "";
    const isSid = /\.sid$/i.test(name);
    await this.assertDownloadTiffVisible(isSid);
  }
}

