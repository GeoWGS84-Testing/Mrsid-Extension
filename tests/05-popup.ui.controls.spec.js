import fs from "fs";
import { test, expect } from "../fixtures/extension.js";
import {
  pickValidRaster,
  TestData,
  hasFixture,
  requireFixture,
} from "../fixtures/testData.js";

/**
 * GV-TC-010 — UI chrome after preview
 */
test.describe("Popup — UI controls @p2", () => {
  test.setTimeout(35 * 60 * 1000);

  test("GV-TC-010-02 | Zoom controls present after successful preview", async ({
    popupPage,
  }, testInfo) => {
    const fixture = pickValidRaster();
    if (!fixture) {
      testInfo.skip(true, "No valid raster");
      return;
    }

    await popupPage.open("GV-TC-010-02 Zoom controls after preview");
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible();

    await expect(popupPage.zoomInBtn).toBeVisible();
    await expect(popupPage.zoomOutBtn).toBeVisible();
    await expect(popupPage.resetZoomBtn).toBeVisible();

    await popupPage.zoomIn();
    await popupPage.zoomOut();
    await popupPage.resetZoom();
  });

  test("GV-TC-008-07 | Multi-file set progress status", async ({
    popupPage,
  }, testInfo) => {
    const files = [
      TestData.multiFile0,
      TestData.multiFile1,
      TestData.multiFile2,
    ].filter(hasFixture);
    if (files.length < 2) {
      testInfo.skip(true, "Need at least 2 files from multi_file_set");
      return;
    }

    await popupPage.open("GV-TC-008-07 Multi-file progress status");
    await popupPage.uploadFiles(files);
    const result = await popupPage.waitForMultiFileComplete(files.length);
    expect(result.status).toMatch(/All files processed!|Analysis Complete/i);
  });
});
