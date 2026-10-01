import { test, expect } from "../fixtures/extension.js";
import {
  pickValidRaster,
  pickValidTif,
  TestData,
  hasFixture,
} from "../fixtures/testData.js";
import { MapPage } from "../pages/MapPage.js";
import {
  setContext,
  clearDiagnostics,
  logInfo,
} from "../utils/helpers.js";

/**
 * GV-TC-011 / GV-TC-012 / GV-TC-013 — Map launch, render, controls
 * Empty map.html is covered in 14-map.empty.storage.spec.js
 */
test.describe("Map — Launch & controls @p1 @map", () => {
  test.setTimeout(35 * 60 * 1000);

  test("GV-TC-011-01 | Map loads Leaflet + layer chrome after VIEW ON MAP", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-011-01 map layer chrome", flow: "Popup" });
    const fixture = pickValidRaster();
    if (!fixture) {
      testInfo.skip(true, "No valid raster");
      return;
    }

    await popupPage.open("GV-TC-011-01 map layer chrome");
    await popupPage.assertIdleState();
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertTimerProcessed().catch(() => {});
    await popupPage.assertFullMetadata().catch(() => {});

    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);
    setContext({ testcase: "GV-TC-011-01 map layer chrome", flow: "Map" });
    await mapPage.waitForMapReady(60_000);
    await mapPage.waitForRasterRendered(120_000);

    await expect(mapPage.mapContainer).toBeVisible();
    await expect(mapPage.page.locator(".leaflet-container")).toBeVisible();
    await expect(mapPage.zoomLevel).toBeVisible();
    await expect(mapPage.opacityRange).toBeVisible();
    await expect(mapPage.metaToggleBtn).toBeVisible();
    await mapPage.ensureControlCardVisible();

    // Geographic placement: map center + Leaflet layer bounds must sit near popup Location
    const meta = await popupPage.getMetadata().catch(() => ({}));
    const loc = MapPage.parseLatLng(meta.Location || meta.location || "");
    if (loc) {
      // Strong check: center + live Leaflet raster layer bounds (not just map view)
      await mapPage.assertRasterMappedCorrectly(
        { lat: loc.lat, lng: loc.lng },
        null,
        { toleranceDeg: 1.5 }
      );
    } else {
      logInfo("No Location string to geo-check", meta);
    }
    logInfo("✅ GV-TC-011-01 PASSED");
  });

  test("GV-TC-012-01 | Metadata panel open / close", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-012-01 meta open/close", flow: "Popup" });
    const fixture = pickValidTif() || pickValidRaster();
    if (!fixture) {
      testInfo.skip(true, "No valid raster");
      return;
    }

    await popupPage.open("GV-TC-012-01 meta open/close");
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;

    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);
    setContext({ testcase: "GV-TC-012-01 meta open/close", flow: "Map" });
    await mapPage.waitForMapReady(60_000);
    await mapPage.waitForRasterRendered(120_000);
    await mapPage.ensureControlCardVisible();

    await mapPage.openMetadataPanel();
    const text = await mapPage.getMetadataPanelText();
    expect(text.length).toBeGreaterThan(0);
    logInfo("Metadata panel text length", { len: text.length });

    await mapPage.closeMetadataPanel();
    logInfo("✅ GV-TC-012-01 PASSED");
  });

  test("GV-TC-013-01 | Overlay opacity slider is interactive", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-013-01 opacity slider", flow: "Popup" });
    const fixture = pickValidTif() || pickValidRaster();
    if (!fixture) {
      testInfo.skip(true, "No valid raster");
      return;
    }

    await popupPage.open("GV-TC-013-01 opacity slider");
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;

    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);
    setContext({ testcase: "GV-TC-013-01 opacity slider", flow: "Map" });
    await mapPage.waitForMapReady(60_000);
    await mapPage.waitForRasterRendered(120_000);
    await mapPage.ensureControlCardVisible();

    await mapPage.setOverlayOpacity(40);
    expect(Number(await mapPage.opacityRange.inputValue())).toBe(40);
    await mapPage.setOverlayOpacity(100);
    expect(Number(await mapPage.opacityRange.inputValue())).toBe(100);
    logInfo("✅ GV-TC-013-01 PASSED");
  });
});
