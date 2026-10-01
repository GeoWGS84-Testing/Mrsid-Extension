import { test, expect } from "../fixtures/extension.js";
import { UI_STRINGS } from "../fixtures/testData.js";
import {
  showStep,
  logInfo,
  addWarning,
  setContext,
  clearDiagnostics,
} from "../utils/helpers.js";

/**
 * GV-TC-001 — Startup / Popup
 */
test.describe("Startup / Popup @smoke @p0", () => {
  test("GV-TC-001-01 | Popup opens and shows System Ready state", async ({
    popupPage,
  }) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-001-01 Popup opens and shows ready state" });

    await showStep(popupPage.page, "PART 1: Open extension popup");
    await popupPage.open("GV-TC-001-01 Popup opens and shows ready state");

    await showStep(popupPage.page, "PART 2: Validate idle UI");
    await popupPage.assertIdleState();

    await showStep(popupPage.page, "PART 3: Explicit status + timer checks");
    await expect(popupPage.statusValue).toHaveText(UI_STRINGS.systemReady);
    await expect(popupPage.timer).toContainText(/0\s*sec/i);
    await expect(popupPage.dropText).toContainText(UI_STRINGS.dropTitle);
    await expect(popupPage.showMapBtn).toBeVisible();
    await expect(popupPage.clearBtn).toBeVisible();
    logInfo("✅ GV-TC-001-01 PASSED");
  });

  test("GV-TC-001-03 | No critical console errors on popup load", async ({
    popupPage,
  }) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-001-03 No critical console errors" });

    const errors = [];
    popupPage.page.on("pageerror", (e) => errors.push(e.message));
    popupPage.page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await popupPage.open("GV-TC-001-03 No critical console errors");
    await popupPage.waitUntilReady();
    await popupPage.page.waitForTimeout(1500);

    // Benign / expected when backend .env or remote config is unreachable
    const critical = errors.filter(
      (m) =>
        !/favicon|Extension context|net::ERR_/i.test(m) &&
        !/Failed to load resource/i.test(m) &&
        !/Could not load backend URL configuration/i.test(m) &&
        !/Failed to fetch/i.test(m)
    );

    if (errors.length && !critical.length) {
      await addWarning("Non-critical console messages on load (filtered)", {
        messages: errors,
      });
      await expect(popupPage.page.locator("#pw-diagnostic-overlay")).toHaveCount(0);
      logInfo("Console noise filtered (backend config fetch is optional)");
    }

    expect(critical, `Critical console errors: ${JSON.stringify(critical)}`).toEqual(
      []
    );
    logInfo("✅ GV-TC-001-03 PASSED — no critical console errors");
  });

  test("GV-TC-001-04 | Popup static assets render (logo)", async ({
    popupPage,
  }) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-001-04 Popup static assets" });

    await popupPage.open("GV-TC-001-04 Popup static assets");
    await expect(popupPage.logo).toBeVisible();
    const natural = await popupPage.logo.evaluate((img) => ({
      w: img.naturalWidth,
      h: img.naturalHeight,
    }));
    expect(natural.w).toBeGreaterThan(0);
    expect(natural.h).toBeGreaterThan(0);
    logInfo(`✅ Logo rendered ${natural.w}×${natural.h}`);
  });

  test("GV-TC-001-02 | File input accept attribute lists supported extensions", async ({
    popupPage,
  }) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-001-02 File input accept" });

    await popupPage.open("GV-TC-001-02 File input accept");
    const accept = (await popupPage.fileInput.getAttribute("accept")) || "";
    logInfo(`accept attribute: ${accept}`);
    expect(accept.toLowerCase()).toMatch(/\.sid/);
    expect(accept.toLowerCase()).toMatch(/\.tif/);
    logInfo("✅ Accept attribute lists .sid and .tif");
  });
});
