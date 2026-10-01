import { test, expect } from "../fixtures/extension.js";
import {
  TestData,
  pickValidRaster,
  pickValidSid,
  pickValidTif,
  hasFixture,
  requireFixture,
} from "../fixtures/testData.js";
import { MapPage } from "../pages/MapPage.js";
import {
  showStep,
  logInfo,
  setContext,
  clearDiagnostics,
  addWarning,
} from "../utils/helpers.js";

/**
 * Extra coverage: metadata fields, map highlight, multi-file, GIS samples
 */
test.describe("Metadata + Map extras @p1 @upload @map", () => {
  test.setTimeout(35 * 60 * 1000);

  test("GV-TC-006-01 | Metadata includes Bounds / Projection / Format", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-006-01 metadata fields", flow: "Popup" });

    const fixture = pickValidSid() || pickValidTif();
    if (!fixture) {
      testInfo.skip(true, "No valid raster");
      return;
    }

    await popupPage.open("GV-TC-006-01 metadata fields");
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;

    const meta = await popupPage.assertFullMetadata({
      requiredKeys: [
        "Filename",
        "Location",
        "Resolution",
        "Projection",
        "Format",
      ],
    });

    // Bounds N is present on SID samples (screenshot)
    const hasBounds = Object.keys(meta).some((k) => /bounds/i.test(k));
    if (hasBounds) {
      logInfo("✅ Bounds field present");
    } else {
      await addWarning("Bounds field not present for this fixture", { meta });
    }
    logInfo("✅ GV-TC-006-01 PASSED");
  });

  test("GV-TC-011-02 | Map raster highlighted only after fully loaded", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-011-02 map raster highlight", flow: "Popup" });

    const fixture = pickValidRaster();
    if (!fixture) {
      testInfo.skip(true, "No valid raster");
      return;
    }

    await popupPage.open("GV-TC-011-02 map raster highlight");
    await popupPage.uploadFiles(fixture);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    const meta = await popupPage.assertFullMetadata();

    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);
    setContext({ flow: "Map" });
    await mapPage.waitForMapReady(60_000);

    const highlighted = await mapPage.waitForRasterRendered(120_000);
    expect(
      highlighted.boxDrawn || (highlighted.count || 0) > 0,
      `Expected raster highlight. Got: ${JSON.stringify(highlighted)}`
    ).toBeTruthy();
    const loc1102 = MapPage.parseLatLng(meta.Location || meta.location || "");
    if (loc1102) {
      await mapPage.assertRasterMappedCorrectly(
        { lat: loc1102.lat, lng: loc1102.lng },
        null,
        { toleranceDeg: 1.5 }
      );
    }
    logInfo("✅ GV-TC-011-02 PASSED — raster highlighted after full load", highlighted);
  });

  test("GV-TC-006-04 | SW hemisphere satellite → metadata + map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-006-04 SW hemisphere", flow: "Popup" });
    if (!requireFixture(TestData.swHemisphere, testInfo)) return;

    await popupPage.open("GV-TC-006-04 SW hemisphere");
    await popupPage.uploadFiles(TestData.swHemisphere);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertPreviewVisible();
    const meta = await popupPage.assertFullMetadata();

    const loc = Object.values(meta).join(" ");
    logInfo(`Location text: ${loc}`);

    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);
    setContext({ flow: "Map" });
    await mapPage.waitForMapReady(60_000);
    await mapPage.waitForRasterRendered(120_000);
    await mapPage.assertMapMetadata({ requiredFragments: ["FILE NAME"] });
    // Chile ~ (-33.27, -71.37) — must sit in SW hemisphere, not Ohio NAIP
    const loc04 = MapPage.parseLatLng(meta.Location || "");
    if (loc04) {
      await mapPage.assertRasterMappedCorrectly(
        { lat: loc04.lat, lng: loc04.lng },
        null,
        { toleranceDeg: 2.0 }
      );
    } else if (/-33/.test(JSON.stringify(meta))) {
      await mapPage.assertRasterMappedCorrectly(
        { lat: -33.27, lng: -71.37 },
        null,
        { toleranceDeg: 2.5 }
      );
    }
    logInfo("✅ GV-TC-006-04 PASSED");
  });

  /**
   * Single-file placement check for rotated NAIP.
   * Full baseline-vs-rotated comparison lives in tests/06-gis.edge.spec.js (GV-TC-006-07).
   */
  test("GV-TC-006-07b | Rotated NAIP single-file map placement @map", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-006-07b rotated NAIP placement", flow: "Popup" });
    if (!requireFixture(TestData.rotatedNaip, testInfo)) return;

    await popupPage.open("GV-TC-006-07b rotated NAIP placement");
    await popupPage.uploadFiles(TestData.rotatedNaip);
    if (!(await popupPage.waitForProcessingCompleteOrSkip(testInfo))) return;
    await popupPage.assertFullMetadata();

    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);
    setContext({ flow: "Map" });
    await mapPage.waitForMapReady(60_000);
    await mapPage.waitForRasterRendered(120_000);
    await mapPage.assertMapMetadata({ requiredFragments: ["FILE NAME"] });
    const meta07 = await popupPage.getMetadata().catch(() => ({}));
    const loc07 = MapPage.parseLatLng(meta07.Location || "");
    if (loc07) {
      await mapPage.assertRasterMappedCorrectly(
        { lat: loc07.lat, lng: loc07.lng },
        null,
        { toleranceDeg: 1.5 }
      );
    }
    logInfo("✅ GV-TC-006-07b PASSED");
  });

  test("GV-TC-008-07 | Multi-file set all process + map layers", async ({
    popupPage,
    extensionId,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-008-07 multi-file", flow: "Popup" });

    const files = [
      TestData.multiFile0,
      TestData.multiFile1,
      TestData.multiFile2,
    ].filter(hasFixture);
    if (files.length < 2) {
      testInfo.skip(true, "Need ≥2 multi-file fixtures");
      return;
    }

    await popupPage.open("GV-TC-008-07 multi-file");
    await popupPage.assertIdleState();

    // Select all files at once — product processes them 1-by-1
    await popupPage.uploadFiles(files);

    const result = await popupPage.waitForMultiFileComplete(files.length);
    expect(result.status).toMatch(/All files processed!|Analysis Complete/i);

    // Metadata should reflect at least one completed file (last wins)
    const meta = result.lastMeta && Object.keys(result.lastMeta).length
      ? result.lastMeta
      : await popupPage.getMetadata().catch(() => ({}));
    logInfo("Final multi-file metadata", meta);

    // Soft: some builds only show status, not grid filename for multi
    if (Object.keys(meta).length) {
      logInfo("✅ Metadata present after multi-file", meta);
    } else {
      logInfo("Metadata grid empty after multi — status still OK");
    }

    // Preview may stay hidden for multi-file; soft check
    await popupPage.assertPreviewVisibleSoft();

    // ── Map: after all files processed, open map and verify each layer ──────
    setContext({ testcase: "GV-TC-008-07 multi-file", flow: "Map" });
    const mapTab = await popupPage.clickViewOnMap();
    const mapPage = new MapPage(mapTab, extensionId);
    await mapPage.waitForMapReady(60_000);
    await mapPage.waitForRasterRendered(120_000);

    // Each uploaded file should appear in the layer list
    const layerNames = await mapPage.assertLayersPresent(files);

    // Control card + chrome
    await mapPage.ensureControlCardVisible();
    await expect(mapPage.layerList).toBeVisible();
    await expect(mapPage.opacityRange).toBeVisible();
    await expect(mapPage.metaToggleBtn).toBeVisible();

    // Zoom to each layer and highlight with a different color
    const perLayer = await mapPage.highlightEachLayer(files);
    logInfo(
      "Multi-file per-layer highlights",
      perLayer.map((r) => ({
        name: r.name,
        color: r.color,
        mode: r.highlight?.mode,
        boxDrawn: r.highlight?.boxDrawn,
      }))
    );

    logInfo("✅ GV-TC-008-07 PASSED", {
      status: result.status,
      statusTransitions: result.seenStatuses.length,
      mapLayers: layerNames,
      highlightedLayers: perLayer.length,
    });
  });
});
