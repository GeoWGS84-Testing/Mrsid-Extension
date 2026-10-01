import { test, expect } from "../fixtures/extension.js";
import {
  TestData,
  pickValidSid,
  pickValidTif,
  pickValidRaster,
  requireFixture,
  hasFixture,
} from "../fixtures/testData.js";
import { MapPage } from "../pages/MapPage.js";
import {
  showStep,
  logInfo,
  addWarning,
  addError,
  takeScreenshot,
  setContext,
  clearDiagnostics,
  isProcessingTimeoutError,
} from "../utils/helpers.js";

/**
 * GV-TC-003 / happy-path upload — metadata + timer + map
 */
test.describe("Upload — Valid processing @smoke @p0 @upload", () => {
  // Allow up to 30 min processing + overhead
  test.setTimeout(35 * 60 * 1000);
  test("GV-TC-003-01 | Select valid .sid → preview + full metadata", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-003-01 valid .sid", flow: "Popup" });

    const fixture = pickValidSid();
    if (!fixture) {
      testInfo.skip(true, "No valid .sid under test-data/valid");
      return;
    }
    logInfo(`Using fixture: ${fixture}`);

    await showStep(popupPage.page, "PART 1: Open popup + idle check");
    await popupPage.open("GV-TC-003-01 valid .sid");
    await popupPage.assertIdleState();

    await showStep(popupPage.page, "PART 2: Upload valid .sid");
    await popupPage.uploadFiles(fixture);

    await showStep(popupPage.page, "PART 3: Wait for processing");
    await Promise.race([
      popupPage.waitForExtractingPhase(20_000).catch(() => {}),
      popupPage.waitForProcessingComplete(),
    ]);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;

    await showStep(popupPage.page, "PART 4: Preview + full metadata + DOWNLOAD TIFF");
    await popupPage.assertPreviewVisible();
    await popupPage.assertFullMetadata();
    await popupPage.assertDownloadTiffForFile(fixture);
    logInfo("✅ GV-TC-003-01 PASSED");
  });

  test("GV-TC-003-02 | Select valid .tif → preview + full metadata", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-003-02 valid .tif", flow: "Popup" });

    const fixture = pickValidTif();
    if (!fixture) {
      testInfo.skip(true, "No valid .tif");
      return;
    }
    logInfo(`Using fixture: ${fixture}`);

    await popupPage.open("GV-TC-003-02 valid .tif");
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible();
    await popupPage.assertFullMetadata();
    // Product: DOWNLOAD TIFF only for .sid — hidden for .tif
    await popupPage.assertDownloadTiffForFile(fixture);
    logInfo("✅ GV-TC-003-02 PASSED");
  });

  test("GV-TC-003-03 | Select valid .tiff starts processing", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-003-03 valid .tiff", flow: "Popup" });

    // Valid_GeoTIFF.tiff is a real georeferenced file (~5824×9032) — needs longer timeout
    const fixture = hasFixture(TestData.validTiff)
      ? TestData.validTiff
      : pickValidTif();
    if (!fixture) {
      testInfo.skip(true, "No .tiff/.tif fixture");
      return;
    }
    logInfo(`Using fixture: ${fixture}`);

    await popupPage.open("GV-TC-003-03 valid .tiff");
    await popupPage.uploadFiles(fixture);

    // Large multi-megapixel GeoTIFF can sit on Vortex Engine for 1–3+ minutes
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible();
    await popupPage.assertFullMetadata();
    // DOWNLOAD TIFF is SID-only — expect hidden for .tiff
    await popupPage.assertDownloadTiffForFile(fixture);
    logInfo("✅ GV-TC-003-03 PASSED");
  });

  test("GV-TC-003-05 | UPPERCASE .SID / .TIF extensions are accepted", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-003-05 UPPERCASE extension", flow: "Popup" });

    const candidates = [TestData.upperTif, TestData.upperSid].filter(hasFixture);
    if (!candidates.length) {
      testInfo.skip(true, "No UPPERCASE extension fixtures in boundary/");
      return;
    }

    let lastError = null;
    for (const fixture of candidates) {
      logInfo(`Trying UPPERCASE fixture: ${fixture}`);
      await popupPage.open("GV-TC-003-05 UPPERCASE extension");
      await popupPage.uploadFiles(fixture);
      try {
        if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
        await popupPage.assertPreviewVisible();
        await popupPage.assertFullMetadata();
        logInfo(`✅ UPPERCASE accepted: ${fixture}`);
        return;
      } catch (error) {
        lastError = error;
        const status = (await popupPage.statusValue.textContent()) || "";
        await addWarning(`UPPERCASE file rejected or failed: ${fixture}`, { status });
      }
    }

    await addError("All UPPERCASE fixtures failed", { error: lastError?.message });
    throw lastError;
  });

  test("GV-TC-002-01 | Valid upload → VIEW ON MAP renders raster (highlighted)", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-002-01 VIEW ON MAP", flow: "Popup" });

    const fixture = pickValidRaster();
    if (!fixture) {
      testInfo.skip(true, "No valid raster");
      return;
    }
    logInfo(`Using fixture: ${fixture}`);

    await popupPage.open("GV-TC-002-01 VIEW ON MAP");
    await popupPage.assertIdleState();
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible();
    await popupPage.assertFullMetadata();

    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);

    setContext({ flow: "Map" });
    await mapPage.waitForMapReady(60_000);
    try {
      await mapPage.waitForRasterRendered(120_000);
    } catch (error) {
      const diag = await mapPage.getRenderDiagnostics();
      await addError("Raster did not render on map", { diag });
      await takeScreenshot(mapTab, "map-raster-missing");
      throw new Error(`Raster not rendered. Diagnostics: ${JSON.stringify(diag)}`);
    }

    await showStep(mapTab, "Validate final map state", mapPage.mapContainer);
    const diag = await mapPage.getRenderDiagnostics();
    expect(diag.leafletPresent).toBeTruthy();
    // ImageOverlay may be removed once HD tiles are active
    const hasRaster =
      (diag.overlayCount || 0) > 0 ||
      (diag.hdTileCount || 0) > 0 ||
      diag.hdActive ||
      (diag.layerItemCount || 0) > 0;
    expect(hasRaster, `No raster on map: ${JSON.stringify(diag)}`).toBeTruthy();

    // Map FILE METADATA panel (SHOW METADATA)
    await mapPage.assertMapMetadata({
      requiredFragments: ["FILE NAME", "FORMAT"],
    });
    const loc002 = MapPage.parseLatLng(
      (await popupPage.getMetadata().catch(() => ({}))).Location || ""
    );
    if (loc002) {
      await mapPage.assertGeolocationNear(loc002.lat, loc002.lng, { toleranceDeg: 1.5 });
    }
    logInfo("✅ GV-TC-002-01 PASSED", diag);
  });

  test("GV-TC-010-01 | Clear after successful upload", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-010-01 Clear after upload", flow: "Popup" });

    const fixture = pickValidRaster();
    if (!fixture) {
      testInfo.skip(true, "No valid raster");
      return;
    }

    await popupPage.open("GV-TC-010-01 Clear after upload");
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible();
    await popupPage.assertFullMetadata();

    const mapTab = await popupPage.clickViewOnMap();
    await expect.poll(() => popupPage.page.evaluate(() => new Promise(resolve => {
      chrome.storage.local.get("mapDataList", result => resolve(result.mapDataList || []));
    }))).toHaveLength(1);
    await mapTab.close();
    await popupPage.page.bringToFront();

    await popupPage.clickClear();
    await popupPage.assertClearedToIdle();
    const storedLayers = await popupPage.page.evaluate(() => new Promise(resolve => {
      chrome.storage.local.get("mapDataList", result => resolve(result.mapDataList || []));
    }));
    expect(storedLayers).toEqual([]);
    // After clear, DOWNLOAD TIFF should hide again
    await expect(popupPage.downloadTiffBtn).toBeHidden();
    logInfo("✅ GV-TC-010-01 PASSED");
  });

  test("GV-TC-014-01 | DOWNLOAD TIFF visible after valid process", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-014-01 DOWNLOAD TIFF", flow: "Popup" });

    // Product only shows DOWNLOAD TIFF for MrSID (.sid)
    const fixture = pickValidSid() || pickValidRaster();
    if (!fixture) {
      testInfo.skip(true, "No valid .sid raster");
      return;
    }
    if (!/\.sid$/i.test(fixture)) {
      testInfo.skip(true, "DOWNLOAD TIFF is SID-only; no .sid fixture");
      return;
    }

    await popupPage.open("GV-TC-014-01 DOWNLOAD TIFF");
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertDownloadTiffVisible(true);
    logInfo("✅ GV-TC-014-01 PASSED");
  });
});
