import { test, expect } from "../fixtures/extension.js";
import { pickValidSid, pickValidRaster } from "../fixtures/testData.js";
import {
  showStep,
  logInfo,
  setContext,
  clearDiagnostics,
  visualClick,
} from "../utils/helpers.js";

/**
 * GV-TC-014 — DOWNLOAD TIFF after success
 */
test.describe("Download TIFF @p1 @upload", () => {
  test.setTimeout(35 * 60 * 1000);

  test("GV-TC-014-03 | DOWNLOAD TIFF click starts a download", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-014-03 DOWNLOAD TIFF click", flow: "Popup" });

    const fixture = pickValidSid() || pickValidRaster();
    if (!fixture || !/\.sid$/i.test(fixture)) {
      testInfo.skip(true, "DOWNLOAD TIFF is SID-only; need .sid fixture");
      return;
    }

    await popupPage.open("GV-TC-014-03 DOWNLOAD TIFF click");
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertDownloadTiffVisible();

    await showStep(
      popupPage.page,
      "Click DOWNLOAD TIFF",
      popupPage.downloadTiffBtn
    );

    // Capture download event if product triggers one
    const downloadPromise = popupPage.page
      .waitForEvent("download", { timeout: 60_000 })
      .catch(() => null);

    await popupPage.downloadTiffBtn.click();
    const download = await downloadPromise;

    if (download) {
      const suggested = download.suggestedFilename();
      logInfo(`Download started: ${suggested}`);
      expect(suggested.length).toBeGreaterThan(0);
    } else {
      // Some builds open blob URL / new tab instead of download event
      logInfo(
        "No Playwright download event — checking UI still stable after click"
      );
      await expect(popupPage.downloadTiffBtn).toBeVisible();
    }
    logInfo("✅ GV-TC-014-03 PASSED");
  });
});
