import { test, expect } from "../fixtures/extension.js";
import {
  showStep,
  logInfo,
  setContext,
  clearDiagnostics,
  highlight,
} from "../utils/helpers.js";

/**
 * GV-TC-001-05 — layout at multiple viewports
 */
test.describe("UI — Viewport layout @p2", () => {
  const VIEWPORTS = [
    { w: 1920, h: 1080, name: "1920x1080" },
    { w: 1366, h: 768, name: "1366x768" },
    { w: 800, h: 600, name: "800x600" },
  ];

  for (const vp of VIEWPORTS) {
    test(`GV-TC-001-05 | Layout usable at ${vp.name}`, async ({
      popupPage,
    }) => {
      clearDiagnostics();
      setContext({
        testcase: `GV-TC-001-05 ${vp.name}`,
        flow: "Popup",
      });

      await popupPage.page.setViewportSize({ width: vp.w, height: vp.h });
      await popupPage.open(`GV-TC-001-05 ${vp.name}`);

      await showStep(
        popupPage.page,
        `Check drop area + buttons at ${vp.name}`,
        popupPage.dropArea
      );
      await expect(popupPage.dropArea).toBeVisible();
      await expect(popupPage.showMapBtn).toBeVisible();
      await expect(popupPage.clearBtn).toBeVisible();

      // No severe horizontal overflow on body
      const overflow = await popupPage.page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
        };
      });
      logInfo(`Viewport metrics ${vp.name}`, overflow);
      // Allow small scrollbar tolerance
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 40);
      await highlight(popupPage.page, popupPage.dropArea, 300);
      logInfo(`✅ Layout OK at ${vp.name}`);
    });
  }
});
