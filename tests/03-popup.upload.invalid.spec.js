import { test, expect } from "../fixtures/extension.js";
import {
  TestData,
  requireFixture,
  hasFixture,
  UI_STRINGS,
} from "../fixtures/testData.js";
import {
  setContext,
  clearDiagnostics,
  logInfo,
} from "../utils/helpers.js";

/**
 * GV-TC-004 / GV-TC-005 / GV-TC-009 — Validation & negative uploads
 *
 * Product behaviours (confirmed on V1.8):
 *  - Unsupported type (.gif/.jpg/.png/.pdf/no-ext/double-ext):
 *      "Only .sid, .tif, and .tiff files are supported."
 *  - Non-georeferenced .sid/.tif:
 *      "Error: This file does not contain georeferencing metadata.
 *       Please upload a valid georeferenced image."
 *  - Corrupt / empty: must NOT reach Analysis Complete + preview
 */
test.describe("Upload — Invalid / unsupported @p1 @upload", () => {
  test.setTimeout(35 * 60 * 1000);

  test("GV-TC-004-01 | Unsupported .gif is rejected client-side", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-004-01 unsupported .gif", flow: "Popup" });
    if (!requireFixture(TestData.fakeGif, testInfo)) return;

    await popupPage.open("GV-TC-004-01 unsupported .gif");
    await popupPage.assertIdleState();
    await popupPage.uploadFiles(TestData.fakeGif);
    await popupPage.assertUploadRejected(UI_STRINGS.onlySupported, 15_000);
    logInfo("✅ GV-TC-004-01 PASSED");
  });

  test("GV-TC-004-01b | Unsupported .jpg / .png / .pdf rejected", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-004-01b jpg/png/pdf", flow: "Popup" });
    const files = [TestData.fakeJpg, TestData.fakePng, TestData.fakePdf].filter(
      hasFixture
    );
    if (!files.length) {
      testInfo.skip(true, "No negative image fixtures");
      return;
    }

    await popupPage.open("GV-TC-004-01b jpg/png/pdf");
    await popupPage.assertIdleState();

    for (const f of files) {
      const name = f.split(/[/\\]/).pop();
      logInfo(`Rejecting unsupported file: ${name}`);
      await popupPage.uploadFiles(f);
      await popupPage.assertUploadRejected(UI_STRINGS.onlySupported, 12_000);
    }
    logInfo("✅ GV-TC-004-01b PASSED");
  });

  test("GV-TC-004-02 | Deceptive double-extension names rejected", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-004-02 double-extension", flow: "Popup" });
    const files = [
      TestData.deceptiveSidTxt,
      TestData.deceptiveTifExe,
    ].filter(hasFixture);
    if (!files.length) {
      testInfo.skip(true, "No deceptive-name fixtures");
      return;
    }

    await popupPage.open("GV-TC-004-02 double-extension");
    await popupPage.assertIdleState();

    for (const f of files) {
      const name = f.split(/[/\\]/).pop();
      logInfo(`Rejecting deceptive name: ${name}`);
      await popupPage.uploadFiles(f);
      // Product treats these as unsupported extension (last segment wins)
      await popupPage.page.waitForTimeout(1500);
      const status = ((await popupPage.statusValue.textContent()) || "").trim();
      const preview = await popupPage.previewImage.isVisible().catch(() => false);

      await popupPage.page.locator("#statusValue").evaluate((el) => {
        el.style.outline = "3px solid #FF6B00";
      }).catch(() => {});

      expect(preview, `Preview must stay hidden for ${name}`).toBeFalsy();
      expect(status).not.toMatch(/Analysis Complete|All files processed/i);
      // Prefer explicit support error when shown
      if (/Only \.sid/i.test(status) || /supported/i.test(status)) {
        logInfo(`✅ Explicit reject message for ${name}: ${status}`);
      } else {
        logInfo(`✅ No success for ${name}; status="${status}"`);
      }
    }
    logInfo("✅ GV-TC-004-02 PASSED");
  });

  test("GV-TC-004-03 | File with no extension rejected", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-004-03 no extension", flow: "Popup" });
    if (!requireFixture(TestData.noExt, testInfo)) return;

    await popupPage.open("GV-TC-004-03 no extension");
    await popupPage.assertIdleState();
    await popupPage.uploadFiles(TestData.noExt);

    await popupPage.page.waitForTimeout(2000);
    const status = ((await popupPage.statusValue.textContent()) || "").trim();
    const preview = await popupPage.previewImage.isVisible().catch(() => false);

    expect(preview).toBeFalsy();
    expect(status).not.toMatch(/Analysis Complete|All files processed/i);

    // Prefer the known client-side message
    if (/Only \.sid|supported/i.test(status)) {
      await popupPage.assertUploadRejected(UI_STRINGS.onlySupported, 5_000);
    } else {
      await popupPage.page.locator("#statusValue").evaluate((el) => {
        el.style.outline = "3px solid #FF6B00";
      });
      logInfo(`No-extension status: "${status}"`);
    }
    logInfo("✅ GV-TC-004-03 PASSED");
  });

  test("GV-TC-005-04 | Empty / zero-byte file does not produce success", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-005-04 empty file", flow: "Popup" });
    if (!requireFixture(TestData.tinySid, testInfo)) return;

    await popupPage.open("GV-TC-005-04 empty file");
    await popupPage.assertIdleState();
    await popupPage.uploadFiles(TestData.tinySid);
    await popupPage.page.waitForTimeout(15_000);

    const preview = await popupPage.previewImage.isVisible().catch(() => false);
    const status = ((await popupPage.statusValue.textContent()) || "").trim();
    await popupPage.page.locator("#statusValue").evaluate((el) => {
      el.style.outline = "3px solid #FF6B00";
    }).catch(() => {});

    const success =
      /Analysis Complete|All files processed/i.test(status) && preview;
    expect(success, `Empty file must not succeed. status="${status}"`).toBeFalsy();
    logInfo(`✅ GV-TC-005-04 PASSED — status="${status}"`);
  });

  test("GV-TC-009-01 | Non-georeferenced .tif shows georef error", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-009-01 non-georef .tif", flow: "Popup" });
    if (!requireFixture(TestData.nonGeorefTif, testInfo)) return;

    await popupPage.open("GV-TC-009-01 non-georef .tif");
    await popupPage.assertIdleState();
    await popupPage.uploadFiles(TestData.nonGeorefTif);

    // Product message (screenshot):
    // "Error: This file does not contain georeferencing metadata.
    //  Please upload a valid georeferenced image."
    await popupPage.assertUploadRejected(
      UI_STRINGS.noGeorefShort || /georeferencing metadata/i,
      60_000
    );
    logInfo("✅ GV-TC-009-01 PASSED");
  });

  test("GV-TC-009-02 | Non-georeferenced .sid shows georef error", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-009-02 non-georef .sid", flow: "Popup" });
    if (!requireFixture(TestData.nonGeorefSid, testInfo)) return;

    await popupPage.open("GV-TC-009-02 non-georef .sid");
    await popupPage.assertIdleState();
    await popupPage.uploadFiles(TestData.nonGeorefSid);

    await popupPage.assertUploadRejected(
      UI_STRINGS.noGeorefShort || /georeferencing metadata/i,
      60_000
    );
    logInfo("✅ GV-TC-009-02 PASSED");
  });

  test("GV-TC-009-03 | Corrupt .sid does not produce success preview", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-009-03 corrupt .sid", flow: "Popup" });
    if (!requireFixture(TestData.corruptSid, testInfo)) return;

    await popupPage.open("GV-TC-009-03 corrupt .sid");
    await popupPage.assertIdleState();
    await popupPage.uploadFiles(TestData.corruptSid);
    await popupPage.page.waitForTimeout(25_000);

    const preview = await popupPage.previewImage.isVisible().catch(() => false);
    const status = ((await popupPage.statusValue.textContent()) || "").trim();
    await popupPage.page.locator("#statusValue").evaluate((el) => {
      el.style.outline = "3px solid #FF6B00";
    }).catch(() => {});

    const success =
      /Analysis Complete|All files processed/i.test(status) && preview;
    expect(success, `Corrupt SID must not succeed. status="${status}"`).toBeFalsy();
    logInfo(`✅ GV-TC-009-03 PASSED — status="${status}"`);
  });

  test("GV-TC-009-04 | Corrupt .tif does not produce success preview", async ({
    popupPage,
  }, testInfo) => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-009-04 corrupt .tif", flow: "Popup" });
    if (!requireFixture(TestData.corruptTif, testInfo)) return;

    await popupPage.open("GV-TC-009-04 corrupt .tif");
    await popupPage.assertIdleState();
    await popupPage.uploadFiles(TestData.corruptTif);
    await popupPage.page.waitForTimeout(25_000);

    const preview = await popupPage.previewImage.isVisible().catch(() => false);
    const status = ((await popupPage.statusValue.textContent()) || "").trim();
    await popupPage.page.locator("#statusValue").evaluate((el) => {
      el.style.outline = "3px solid #FF6B00";
    }).catch(() => {});

    const success =
      /Analysis Complete|All files processed/i.test(status) && preview;
    expect(success, `Corrupt TIF must not succeed. status="${status}"`).toBeFalsy();
    logInfo(`✅ GV-TC-009-04 PASSED — status="${status}"`);
  });
});
