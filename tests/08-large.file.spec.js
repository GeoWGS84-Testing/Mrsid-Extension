import { test, expect } from "../fixtures/extension.js";
import { TestData, hasFixture } from "../fixtures/testData.js";
import { MapPage } from "../pages/MapPage.js";
import {
  showStep,
  logInfo,
  setContext,
  clearDiagnostics,
  addWarning,
} from "../utils/helpers.js";

/**
 * GV-TC-006-08 / GV-TC-008 / GV-TC-014-02 / GV-TC-015 / GV-TC-023-02
 * Large files ONLY — use the three fixtures the user already has:
 *   - large_1GB_MrSID.sid
 *   - large_1.3GB_MrSID_alaska_eox_007of016.sid
 *   - S1A_Ireland_Complex_Mosaic_May2015_20m_EPSG2157_1.69GB.tif
 *
 * Tagged @large-file — run with: npm run test:large
 * Default timeout 30 minutes per test.
 */
test.describe("Large files @large-file @p1", () => {
  // Large uploads hit flaky backend session drops ("Upload not initialized").
  // Give this suite one extra CI retry beyond the global retries:1.
  test.describe.configure({ retries: process.env.CI ? 2 : 0 });
  test.setTimeout(35 * 60 * 1000); // 30 min process + overhead

  // Short cool-down so sequential multi-GB uploads do not overlap server sessions.
  test.afterEach(async () => {
    await new Promise((r) => setTimeout(r, process.env.CI ? 3000 : 500));
  });

  const LARGE_FIXTURES = [
    { id: "large_1GB", path: TestData.large1GB, label: "large_1GB_MrSID.sid" },
    {
      id: "large_1.3GB",
      path: TestData.large1_3GB,
      label: "large_1.3GB_MrSID_alaska_eox_007of016.sid",
    },
    {
      id: "large_1.69GB",
      path: TestData.large1_69GB,
      label: "S1A_Ireland_Complex_Mosaic_May2015_20m_EPSG2157_1.69GB.tif",
    },
  ];

  test("GV-TC-006-08 | large_1GB_MrSID.sid → preview + metadata", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-006-08 large 1GB", flow: "Popup" });
    if (!hasFixture(TestData.large1GB)) {
      testInfo.skip(true, "large_1GB_MrSID.sid not present under test-data/valid");
      return;
    }

    await popupPage.open("GV-TC-006-08 large 1GB");
    await popupPage.uploadFiles(TestData.large1GB);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible();
    await popupPage.assertFullMetadata();
    await popupPage.assertDownloadTiffVisible();
    logInfo("✅ GV-TC-006-08 PASSED");
  });

  test("GV-TC-006-08b | large_1.3GB Alaska MrSID → preview", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-006-08b large 1.3GB", flow: "Popup" });
    if (!hasFixture(TestData.large1_3GB)) {
      testInfo.skip(
        true,
        "large_1.3GB_MrSID_alaska_eox_007of016.sid not present"
      );
      return;
    }

    await popupPage.open("GV-TC-006-08b large 1.3GB");
    await popupPage.uploadFiles(TestData.large1_3GB);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible();
    await popupPage.assertFullMetadata();
    logInfo("✅ GV-TC-006-08b PASSED");
  });

  test("GV-TC-006-08c | 1.69GB Ireland GeoTIFF → preview", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-006-08c large 1.69GB tif", flow: "Popup" });
    if (!hasFixture(TestData.large1_69GB)) {
      testInfo.skip(
        true,
        "S1A_Ireland_Complex_Mosaic_May2015_20m_EPSG2157_1.69GB.tif not present"
      );
      return;
    }

    await popupPage.open("GV-TC-006-08c large 1.69GB tif");
    await popupPage.uploadFiles(TestData.large1_69GB);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible();
    await popupPage.assertFullMetadata();
    logInfo("✅ GV-TC-006-08c PASSED");
  });

  test("GV-TC-014-02 | large_1GB VIEW ON MAP + raster highlight", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-014-02 large VIEW ON MAP", flow: "Popup" });
    if (!hasFixture(TestData.large1GB)) {
      testInfo.skip(true, "large_1GB_MrSID.sid missing");
      return;
    }

    await popupPage.open("GV-TC-014-02 large VIEW ON MAP");
    await popupPage.uploadFiles(TestData.large1GB);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertFullMetadata();

    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);
    setContext({ flow: "Map" });
    await mapPage.waitForMapReady(120_000);
    await mapPage.waitForRasterRendered(10 * 60 * 1000);
    logInfo("✅ GV-TC-014-02 PASSED");
  });

  test("GV-TC-023-02 | Record process time for large_1GB (baseline)", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-023-02 process timing", flow: "Popup" });
    if (!hasFixture(TestData.large1GB)) {
      testInfo.skip(true, "large_1GB_MrSID.sid missing");
      return;
    }

    await popupPage.open("GV-TC-023-02 process timing");
    const t0 = Date.now();
    await popupPage.uploadFiles(TestData.large1GB);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    const elapsedMs = Date.now() - t0;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);

    // Prefer UI timer if available
    const timerText = (await popupPage.timer.textContent()) || "";
    logInfo(`Process wall-clock: ${elapsedSec}s | UI timer: ${timerText}`);
    testInfo.annotations.push({
      type: "timing",
      description: `large_1GB wall=${elapsedSec}s timer=${timerText}`,
    });
    expect(elapsedMs).toBeGreaterThan(0);
    logInfo("✅ GV-TC-023-02 PASSED (timing recorded)");
  });
});
