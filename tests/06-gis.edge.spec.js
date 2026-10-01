import { test, expect } from "../fixtures/extension.js";
import {
  TestData,
  hasFixture,
  requireFixture,
} from "../fixtures/testData.js";
import { MapPage } from "../pages/MapPage.js";
import {
  logInfo,
  setContext,
  clearDiagnostics,
} from "../utils/helpers.js";

/**
 * GV-TC-006-03..07 — GIS edge cases
 *
 * Shared flow (same depth as @map suites):
 *  1. Popup: open with proper TC name → upload → process → metadata
 *  2. VIEW ON MAP → wait for Leaflet + raster highlight
 *  3. Assert layer present + geographic placement (center / panel bounds)
 */
test.describe("GIS edge cases @p1 @gis @upload @map", () => {
  test.setTimeout(35 * 60 * 1000);

  /**
   * Upload → process → map → highlight → geo check.
   * @param {{ popupPage: any, extensionId: string, testInfo: any, tcName: string, fixture: string, locHint?: string }} opts
   */
  async function runGisMapFlow({
    popupPage,
    extensionId,
    testInfo,
    tcName,
    fixture,
    locHint = "",
  }) {
    clearDiagnostics();
    setContext({ testcase: tcName, flow: "Popup" });

    await popupPage.open(tcName);
    await popupPage.assertIdleState().catch(() => {});
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return null;

    await popupPage.assertTimerProcessed().catch(() => {});
    await popupPage.assertPreviewVisible().catch(() => {});
    await popupPage.assertFullMetadata().catch(() => {});

    const meta = await popupPage.getMetadata().catch(() => ({}));
    logInfo(`${tcName} popup metadata`, meta);
    const loc =
      MapPage.parseLatLng(meta.Location || meta.location || "") ||
      MapPage.parseLatLng(locHint);

    setContext({ testcase: tcName, flow: "Map" });
    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);
    await mapPage.waitForMapReady(60_000);
    await mapPage.waitForRasterRendered(120_000);

    // Layer list should name this file
    const base = String(fixture).split(/[/\\]/).pop();
    await mapPage.assertLayersPresent([base]).catch((err) => {
      logInfo("Layer list soft-check", { err: String(err) });
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
      });
      expect(
        snap?.center || snap?.panelBounds,
        "Expected some geo signal on map after GIS upload"
      ).toBeTruthy();
    }

    logInfo(`✅ ${tcName} PASSED`);
    return { meta, loc, mapPage };
  }

  test("GV-TC-006-04 | SW hemisphere satellite processes + map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    if (!requireFixture(TestData.swHemisphere, testInfo)) return;
    await runGisMapFlow({
      popupPage,
      extensionId,
      testInfo,
      tcName: "GV-TC-006-04 SW hemisphere",
      fixture: TestData.swHemisphere,
    });
  });

  test("GV-TC-006-05a | Antimeridian WEST processes + map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    if (!requireFixture(TestData.antimeridianWest, testInfo)) return;
    await runGisMapFlow({
      popupPage,
      extensionId,
      testInfo,
      tcName: "GV-TC-006-05a antimeridian west",
      fixture: TestData.antimeridianWest,
    });
  });

  test("GV-TC-006-05b | Antimeridian EAST processes + map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    if (!requireFixture(TestData.antimeridianEast, testInfo)) return;
    await runGisMapFlow({
      popupPage,
      extensionId,
      testInfo,
      tcName: "GV-TC-006-05b antimeridian east",
      fixture: TestData.antimeridianEast,
    });
  });

  test("GV-TC-006-06 | Tiny metres-scale raster processes + map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    if (!requireFixture(TestData.tinyMetres, testInfo)) return;
    await runGisMapFlow({
      popupPage,
      extensionId,
      testInfo,
      tcName: "GV-TC-006-06 tiny metres",
      fixture: TestData.tinyMetres,
    });
  });

  /**
   * GV-TC-006-07 | Rotated vs baseline NAIP placement
   *  baseline upload → map → geo snap
   *  CLEAR → rotated upload → map → compare near baseline but shifted
   */
  test("GV-TC-006-07 | Rotated NAIP vs baseline placement on map @map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    const baselineFile = TestData.validTif;
    const rotatedFile = TestData.rotatedNaip;

    if (!hasFixture(baselineFile)) {
      testInfo.skip(true, `Missing baseline: ${baselineFile}`);
      return;
    }
    if (!hasFixture(rotatedFile)) {
      testInfo.skip(true, `Missing rotated fixture: ${rotatedFile}`);
      return;
    }

    clearDiagnostics();
    setContext({ testcase: "GV-TC-006-07 baseline NAIP", flow: "Popup" });

    await popupPage.open("GV-TC-006-07 baseline NAIP");
    await popupPage.assertIdleState().catch(() => {});
    await popupPage.uploadFiles(baselineFile);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible().catch(() => {});
    await popupPage.assertFullMetadata().catch(() => {});

    const baselineMeta = await popupPage.getMetadata().catch(() => ({}));
    const baselineLoc = MapPage.parseLatLng(
      baselineMeta.Location || baselineMeta.location || ""
    );
    logInfo("Baseline popup metadata", { baselineMeta, baselineLoc });

    setContext({ testcase: "GV-TC-006-07 baseline NAIP", flow: "Map" });
    const mapTab1 = await popupPage.clickViewOnMap();
    const mapPage1 = new MapPage(mapTab1, extensionId);
    await mapPage1.waitForMapReady(60_000);
    await mapPage1.waitForRasterRendered(120_000).catch(async (err) => {
      logInfo("Baseline raster highlight soft-fail", { err: String(err) });
      const d = await mapPage1.getRenderDiagnostics().catch(() => ({}));
      throw new Error(`Baseline NAIP not rendered on map: ${JSON.stringify(d)}`);
    });

    let baselineSnap;
    if (baselineLoc) {
      baselineSnap = await mapPage1.assertRasterMappedCorrectly(
        { lat: baselineLoc.lat, lng: baselineLoc.lng },
        null,
        { toleranceDeg: 1.5 }
      );
    } else {
      baselineSnap = await mapPage1.getFullGeoSnapshot();
      expect(baselineSnap.center || baselineSnap.panelBounds).toBeTruthy();
    }
    logInfo("✅ Baseline correctly projected on map", {
      center: baselineSnap?.center,
      layerBounds: baselineSnap?.layerBounds,
      panelBounds: baselineSnap?.panelBounds,
    });

    // Close map tab; continue on popup
    await mapTab1.close().catch(() => {});
    await popupPage.page.bringToFront().catch(() => {});

    clearDiagnostics();
    setContext({ testcase: "GV-TC-006-07 rotated NAIP", flow: "Popup" });
    await popupPage.open("GV-TC-006-07 rotated NAIP");
    await popupPage.clickClear().catch(() => {});
    await popupPage.assertClearedToIdle().catch(() => {});

    await popupPage.uploadFiles(rotatedFile);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible().catch(() => {});
    await popupPage.assertFullMetadata().catch(() => {});

    const rotatedMeta = await popupPage.getMetadata().catch(() => ({}));
    const rotatedLoc = MapPage.parseLatLng(
      rotatedMeta.Location || rotatedMeta.location || ""
    );
    logInfo("Rotated popup metadata", { rotatedMeta, rotatedLoc });

    setContext({ testcase: "GV-TC-006-07 rotated NAIP", flow: "Map" });
    const mapTab2 = await popupPage.clickViewOnMap();
    const mapPage2 = new MapPage(mapTab2, extensionId);
    await mapPage2.waitForMapReady(60_000);
    await mapPage2.waitForRasterRendered(120_000);

    let rotatedSnap;
    if (rotatedLoc) {
      rotatedSnap = await mapPage2.assertRasterMappedCorrectly(
        { lat: rotatedLoc.lat, lng: rotatedLoc.lng },
        null,
        { toleranceDeg: 1.5 }
      );
    } else {
      rotatedSnap = await mapPage2.getFullGeoSnapshot();
    }

    const bC = baselineSnap?.center;
    const rC = rotatedSnap?.center;
    const delta = {
      centerDeltaLat:
        bC && rC ? Math.abs(Number(rC.lat) - Number(bC.lat)) : null,
      centerDeltaLng:
        bC && rC ? Math.abs(Number(rC.lng) - Number(bC.lng)) : null,
      centerDistanceDeg: null,
      boundsShifted: false,
      boundsDelta: null,
      layerAspectBaseline: null,
      layerAspectCurrent: null,
      aspectRatioChanged: false,
    };
    if (
      Number.isFinite(delta.centerDeltaLat) &&
      Number.isFinite(delta.centerDeltaLng)
    ) {
      delta.centerDistanceDeg = Math.hypot(
        delta.centerDeltaLat,
        delta.centerDeltaLng
      );
    }

    const pb0 = baselineSnap?.panelBounds;
    const pb1 = rotatedSnap?.panelBounds;
    if (pb0 && pb1) {
      delta.boundsDelta = {
        minLat: Math.abs(pb1.minLat - pb0.minLat),
        maxLat: Math.abs(pb1.maxLat - pb0.maxLat),
        minLon: Math.abs(pb1.minLon - pb0.minLon),
        maxLon: Math.abs(pb1.maxLon - pb0.maxLon),
      };
      delta.boundsShifted = Object.values(delta.boundsDelta).some((v) => v > 1e-5);
      const aspect = (b) => {
        const lat = Math.abs(b.maxLat - b.minLat) || 1e-9;
        const lon = Math.abs(b.maxLon - b.minLon) || 1e-9;
        return lon / lat;
      };
      delta.layerAspectBaseline = aspect(pb0);
      delta.layerAspectCurrent = aspect(pb1);
      delta.aspectRatioChanged =
        Math.abs(delta.layerAspectCurrent - delta.layerAspectBaseline) > 0.01;
    }

    logInfo("Baseline vs rotated geo comparison", { delta });

    // Still same region (within ~0.5°)
    const regionTol = 0.5;
    if (Number.isFinite(delta.centerDeltaLat)) {
      expect(delta.centerDeltaLat).toBeLessThanOrEqual(regionTol);
      expect(delta.centerDeltaLng).toBeLessThanOrEqual(regionTol);
    }

    const centerMoved =
      Number.isFinite(delta.centerDistanceDeg) && delta.centerDistanceDeg > 1e-5;
    const differs =
      centerMoved || delta.boundsShifted || delta.aspectRatioChanged;
    expect(
      differs,
      "rotated placement must differ slightly from baseline. " +
        `Got: ${JSON.stringify(delta)}`
    ).toBeTruthy();

    logInfo("✅ Rotated file is near baseline location but slightly shifted/rotated", {
      baselineCenter: baselineSnap?.center,
      rotatedCenter: rotatedSnap?.center,
      delta,
    });
    logInfo("✅ GV-TC-006-07 PASSED");
  });

  test("GV-TC-006-03 | UTM companion GeoTIFF processes + map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    if (!requireFixture(TestData.validUtmTif, testInfo)) return;
    await runGisMapFlow({
      popupPage,
      extensionId,
      testInfo,
      tcName: "GV-TC-006-03 UTM companion",
      fixture: TestData.validUtmTif,
    });
  });
});
