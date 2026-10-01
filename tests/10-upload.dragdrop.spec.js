import { test, expect } from "../fixtures/extension.js";
import {
  pickValidSid,
  pickValidRaster,
  TestData,
  hasFixture,
} from "../fixtures/testData.js";
import {
  showStep,
  logInfo,
  setContext,
  clearDiagnostics,
} from "../utils/helpers.js";

/**
 * GV-TC-003-04 — Drag & drop onto #dropArea
 */
test.describe("Upload — Drag & drop @p0 @upload", () => {
  test.setTimeout(35 * 60 * 1000);

  test("GV-TC-003-04 | Drag & drop valid .sid onto drop area", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-003-04 drag-drop", flow: "Popup" });

    const fixture = pickValidSid() || pickValidRaster();
    if (!fixture) {
      testInfo.skip(true, "No valid raster for drag-drop");
      return;
    }

    // Skip very large files for this smoke path
    const name = fixture.split(/[/\\]/).pop() || "";
    if (/large|1\.69GB|GB/i.test(name)) {
      testInfo.skip(true, "Use small fixture for drag-drop smoke");
      return;
    }

    logInfo(`Drag-drop fixture: ${fixture}`);
    await popupPage.open("GV-TC-003-04 drag-drop");
    await popupPage.assertIdleState();

    await popupPage.dragDropFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible();
    await popupPage.assertFullMetadata();
    logInfo("✅ GV-TC-003-04 PASSED");
  });
});
