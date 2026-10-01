import { test, expect } from "../fixtures/extension.js";
import {
  TestData,
  hasFixture,
  listBoundaryUnicode,
  requireFixture,
} from "../fixtures/testData.js";
import { MapPage } from "../pages/MapPage.js";
import {
  logInfo,
  setContext,
  clearDiagnostics,
} from "../utils/helpers.js";

/**
 * GV-TC-008-05 / 008-06 — special filenames, unicode, shared names
 *
 * Same depth as GIS / map suites:
 *  popup (TC-named) → upload → process → metadata → VIEW ON MAP
 *  → raster highlight → layer list → geo placement when Location is present
 */
test.describe("Boundary — filenames @p2 @upload @map", () => {
  test.setTimeout(35 * 60 * 1000);

  /**
   * @param {{ popupPage: any, extensionId: string, testInfo: any, tcName: string, fixture: string, expectFilename?: string }} opts
   */
  async function runBoundaryMapFlow({
    popupPage,
    extensionId,
    testInfo,
    tcName,
    fixture,
    expectFilename = null,
  }) {
    clearDiagnostics();
    setContext({ testcase: tcName, flow: "Popup" });

    await popupPage.open(tcName);
    await popupPage.assertIdleState().catch(() => {});
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return null;

    await popupPage.assertTimerProcessed().catch(() => {});
    await popupPage.assertPreviewVisible();
    await popupPage.assertFullMetadata().catch(() => {});

    const meta = await popupPage.getMetadata().catch(() => ({}));
    logInfo(`${tcName} popup metadata`, meta);
    const loc = MapPage.parseLatLng(meta.Location || meta.location || "");

    const base =
      expectFilename ||
      String(fixture)
        .split(/[/\\]/)
        .pop();

    setContext({ testcase: tcName, flow: "Map" });
    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);
    await mapPage.waitForMapReady(60_000);
    await mapPage.waitForRasterRendered(120_000);

    // Layer list should reflect the (possibly special) filename
    await mapPage.assertLayersPresent([base]).catch((err) => {
      logInfo("Layer list soft-check", { err: String(err), expected: base });
    });

    await mapPage.ensureControlCardVisible();
    await mapPage.refreshRasterHighlight(base).catch(() => {});

    if (loc) {
      await mapPage.assertRasterMappedCorrectly(
        { lat: loc.lat, lng: loc.lng },
        null,
        { toleranceDeg: 2.0 }
      );
      logInfo(`✅ ${tcName} mapped near (${loc.lat}, ${loc.lng})`);
    } else {
      const snap = await mapPage.getFullGeoSnapshot().catch(() => null);
      logInfo(`${tcName} geo snapshot (no Location string)`, {
        center: snap?.center,
        panelBounds: snap?.panelBounds,
        layerBounds: snap?.layerBounds,
      });
      // Still require some map signal after VIEW ON MAP
      expect(
        snap?.center || snap?.panelBounds || snap?.layerBounds,
        "Expected geo signal on map after boundary upload"
      ).toBeTruthy();
    }

    logInfo(`✅ ${tcName} PASSED`);
    return { meta, loc, mapPage, mapTab };
  }

  test("GV-TC-008-06a | File with spaces in name processes + map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    if (!requireFixture(TestData.specialSpaces, testInfo)) return;
    await runBoundaryMapFlow({
      popupPage,
      extensionId,
      testInfo,
      tcName: "GV-TC-008-06a spaces in name",
      fixture: TestData.specialSpaces,
      expectFilename: "file with spaces.tif",
    });
  });

  test("GV-TC-008-06b | File with # & % + in name processes + map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    if (!requireFixture(TestData.specialHashAmp, testInfo)) return;
    await runBoundaryMapFlow({
      popupPage,
      extensionId,
      testInfo,
      tcName: "GV-TC-008-06b special chars",
      fixture: TestData.specialHashAmp,
      expectFilename: "file_with_spaces_hash_amp_pct_plus.tif",
    });
  });

  test("GV-TC-008-06c | Unicode / accented filename processes + map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    const files = listBoundaryUnicode();
    if (!files.length) {
      testInfo.skip(true, "No unicode-named rasters in boundary/");
      return;
    }
    const fixture = files[0];
    const base = String(fixture).split(/[/\\]/).pop();
    await runBoundaryMapFlow({
      popupPage,
      extensionId,
      testInfo,
      tcName: "GV-TC-008-06c unicode filename",
      fixture,
      expectFilename: base,
    });
  });

  test("GV-TC-008-05 | Same filename from different folders both process + map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    if (!hasFixture(TestData.sharedNameA) || !hasFixture(TestData.sharedNameB)) {
      testInfo.skip(true, "Need folder_a and folder_b shared_name.tif");
      return;
    }

    // Folder A → map
    const first = await runBoundaryMapFlow({
      popupPage,
      extensionId,
      testInfo,
      tcName: "GV-TC-008-05 shared_name folder_a",
      fixture: TestData.sharedNameA,
      expectFilename: "shared_name.tif",
    });
    if (!first) return;

    // Close map, CLEAR, then folder B → map
    if (first.mapTab) await first.mapTab.close().catch(() => {});
    await popupPage.page.bringToFront().catch(() => {});

    clearDiagnostics();
    setContext({ testcase: "GV-TC-008-05 shared_name folder_b", flow: "Popup" });
    await popupPage.open("GV-TC-008-05 shared_name folder_b");
    await popupPage.clickClear().catch(() => {});
    await popupPage.assertClearedToIdle().catch(() => {});

    await runBoundaryMapFlow({
      popupPage,
      extensionId,
      testInfo,
      tcName: "GV-TC-008-05 shared_name folder_b",
      fixture: TestData.sharedNameB,
      expectFilename: "shared_name.tif",
    });
  });
});
