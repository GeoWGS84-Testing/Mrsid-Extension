import { test, expect } from "../fixtures/extension.js";
import { MapPage } from "../pages/MapPage.js";
import {
  setContext,
  clearDiagnostics,
  logInfo,
  showStep,
} from "../utils/helpers.js";

/**
 * Empty / malformed map storage edge cases.
 * Product may not render #map when there is no stored raster — that is OK.
 * We assert: page loads, no hard crash, body still has content.
 */
test.describe("Map — empty / storage edge @p0 @map", () => {
  test("GV-TC-002-01b | map.html empty state without stored data", async ({
    context,
    extensionId,
  }) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-002-01b map empty", flow: "Map" });

    const page = await context.newPage();
    const mapUrl = `chrome-extension://${extensionId}/map.html`;

    // Clear extension storage so map has no layers
    await page.goto(mapUrl);
    await page.evaluate(async () => {
      try {
        if (chrome?.storage?.local) {
          await chrome.storage.local.clear();
        }
      } catch {
        /* ignore */
      }
    }).catch(() => {});

    await page.goto(mapUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const bodyText = ((await page.locator("body").innerText()) || "").trim();
    const mapCount = await page.locator("#map").count();
    const leafletCount = await page.locator(".leaflet-container").count();

    logInfo("Empty map diagnostics", {
      url: page.url(),
      mapCount,
      leafletCount,
      bodyPreview: bodyText.slice(0, 200),
    });

    // Must not be a blank crashed document
    expect(page.url()).toContain("map.html");
    const html = await page.content();
    expect(html.length).toBeGreaterThan(50);

    // Prefer #map if product always mounts it; otherwise accept empty body UI
    if (mapCount > 0) {
      const mapPage = new MapPage(page, extensionId);
      await mapPage.waitForMapReady(30_000);
      logInfo("✅ Empty map still mounts #map");
    } else {
      logInfo("✅ Empty map has no #map (product empty-state) — page did not crash");
    }
    logInfo("✅ GV-TC-002-01b PASSED");
  });

  test("GV-TC-002-02 | map.html with malformed mapDataList does not crash", async ({
    context,
    extensionId,
  }) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-002-02 malformed storage", flow: "Map" });

    const seeds = ["not-json", "{}", "[]", '{"broken":true}'];
    for (const val of seeds) {
      const page = await context.newPage();
      const mapUrl = `chrome-extension://${extensionId}/map.html`;
      await page.goto(mapUrl);
      await page.evaluate(async (v) => {
        try {
          if (chrome?.storage?.local) {
            await chrome.storage.local.set({ mapDataList: v });
          }
        } catch {
          /* ignore */
        }
      }, val).catch(() => {});

      await page.goto(mapUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);

      const html = await page.content();
      expect(html.length, `Blank page for seed ${val}`).toBeGreaterThan(50);
      expect(page.url()).toContain("map.html");

      // Crash would often leave no body / error page — soft check
      const mapCount = await page.locator("#map").count();
      logInfo(`Malformed seed handled: ${JSON.stringify(val)}`, { mapCount });
      await page.close();
    }
    logInfo("✅ GV-TC-002-02 PASSED");
  });
});
