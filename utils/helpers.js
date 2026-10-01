/**
 * Professional visual helpers (GeoViewer + Datastore84 style)
 * Gradient status bar · numbered steps · highlight + focus · diagnostics
 */
import fs from "fs";
import path from "path";

export const VISUAL_STEP_DELAY_MS = Number(
  process.env.VISUAL_STEP_DELAY_MS || process.env.PW_SLOWMO || 500
);
export const DIAG_DIR = process.env.PW_DIAGNOSTICS_DIR
  ? path.resolve(process.env.PW_DIAGNOSTICS_DIR)
  : path.join(process.cwd(), "diagnostics");
export const SCREENSHOT_DIR = path.join(process.cwd(), "test-results", "manual-shots");

let CURRENT_PAGE = null;
let CURRENT_TC = "";
let CURRENT_FLOW = "";
let CURRENT_STEP = "";
let STEP_COUNTER = 0;
let INFOS = [];
let WARNINGS = [];
let ERRORS = [];
let TEST_DIAGNOSTICS = [];
let ACTIVE_TEST_TITLE = "";
/** @type {WeakMap<object, {tc:string, step:string, url:string}>} */
const PAGE_VISUAL_STATE = new WeakMap();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(DIAG_DIR);
ensureDir(SCREENSHOT_DIR);

function ts() {
  return new Date().toISOString();
}

function contextPrefix() {
  const parts = [];
  if (CURRENT_TC) parts.push(`(${CURRENT_TC})`);
  if (CURRENT_FLOW) parts.push(`[${CURRENT_FLOW}]`);
  return parts.join(" ");
}

function safeName(s) {
  return String(s || "shot")
    .substring(0, 60)
    .replace(/[^a-zA-Z0-9_\-]/g, "_");
}

// ─── Context ─────────────────────────────────────────────────────────────────

export function setPageRef(page) {
  CURRENT_PAGE = page;
}

export function getPageRef() {
  return CURRENT_PAGE;
}

export function getCurrentTestcase() {
  return CURRENT_TC;
}

export function setContext({ testcase, flow } = {}) {
  if (testcase !== undefined) {
    CURRENT_TC = testcase;
    CURRENT_STEP = "";
    STEP_COUNTER = 0;
  }
  if (flow !== undefined) CURRENT_FLOW = flow;
  logInfo("Context set");
}

export function clearDiagnostics() {
  INFOS = [];
  WARNINGS = [];
  ERRORS = [];
  STEP_COUNTER = 0;
  CURRENT_STEP = "";
}

export function beginTestDiagnostics(title) {
  TEST_DIAGNOSTICS = [];
  ACTIVE_TEST_TITLE = title;
}

export function recordDiagnostic({ severity, message, stackTrace = "", source = "application" }) {
  TEST_DIAGNOSTICS.push({
    timestamp: ts(),
    shard: Number(process.env.SHARD) || null,
    testName: ACTIVE_TEST_TITLE || CURRENT_TC || "UNKNOWN",
    severity,
    message: String(message || ""),
    stackTrace: String(stackTrace || ""),
    source,
  });
}

export function getTestDiagnostics() {
  return TEST_DIAGNOSTICS;
}

export function getWarnings() {
  return WARNINGS;
}
export function getErrors() {
  return ERRORS;
}
export function getInfos() {
  return INFOS;
}

// ─── Logging ─────────────────────────────────────────────────────────────────

export function logInfo(message, meta = {}) {
  const entry = {
    time: ts(),
    level: "info",
    test: CURRENT_TC,
    flow: CURRENT_FLOW,
    message,
    meta,
  };
  INFOS.push(entry);
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[INFO] ${entry.time} ${contextPrefix()} - ${message}${metaStr}`);
}

async function showDiagnosticOverlay(page, level, message, testcase, step) {
  if (!page || page.isClosed()) return false;
  try {
    await page.evaluate(({ level, message, testcase, step }) => {
      document.getElementById("pw-diagnostic-overlay")?.remove();
      const overlay = document.createElement("div");
      overlay.id = "pw-diagnostic-overlay";
      overlay.setAttribute("role", "alert");
      Object.assign(overlay.style, {
        position: "fixed",
        left: "12px",
        right: "12px",
        bottom: "12px",
        zIndex: "2147483647",
        padding: "12px 16px",
        color: "#fff",
        background: level === "WARNING" ? "#8a4b00" : "#8b1e1e",
        border: `2px solid ${level === "WARNING" ? "#ffd166" : "#ff9b9b"}`,
        borderRadius: "6px",
        boxShadow: "0 4px 18px rgba(0,0,0,.45)",
        font: "600 13px/1.45 Segoe UI, system-ui, sans-serif",
        whiteSpace: "pre-wrap",
        pointerEvents: "none",
      });
      overlay.textContent = `${level} | TC: ${testcase || "unknown"} | Step: ${step || "before first action"} | Reason: ${message}`;
      (document.body || document.documentElement).appendChild(overlay);
    }, { level, message: String(message), testcase, step });
    return true;
  } catch {
    return false;
  }
}

async function removeDiagnosticOverlay(page) {
  if (!page || page.isClosed()) return;
  await page.evaluate(() => document.getElementById("pw-diagnostic-overlay")?.remove()).catch(() => {});
}

export async function addWarning(message, meta = {}) {
  const entry = {
    time: ts(),
    level: "warning",
    test: CURRENT_TC,
    flow: CURRENT_FLOW,
    message,
    meta,
  };
  WARNINGS.push(entry);
  recordDiagnostic({ severity: "warning", message, stackTrace: meta.error?.stack || "" });
  console.warn(`[WARNING] ${entry.time} ${contextPrefix()} - ${message}`);
  if (CURRENT_PAGE && !CURRENT_PAGE.isClosed()) {
    await showDiagnosticOverlay(CURRENT_PAGE, "WARNING", message, CURRENT_TC, CURRENT_STEP);
    try {
      return await takeScreenshot(CURRENT_PAGE, `WARNING_${safeName(message)}`);
    } finally {
      await removeDiagnosticOverlay(CURRENT_PAGE);
    }
  }
  return null;
}

export async function addError(message, meta = {}) {
  const entry = {
    time: ts(),
    level: "error",
    test: CURRENT_TC,
    flow: CURRENT_FLOW,
    message,
    meta,
  };
  ERRORS.push(entry);
  recordDiagnostic({ severity: "error", message, stackTrace: meta.error?.stack || "" });
  console.error(`[ERROR] ${entry.time} ${contextPrefix()} - ${message}`);
  if (CURRENT_PAGE && !CURRENT_PAGE.isClosed()) {
    await showDiagnosticOverlay(CURRENT_PAGE, "ERROR", message, CURRENT_TC, CURRENT_STEP);
    try {
      return await takeScreenshot(CURRENT_PAGE, `ERROR_${safeName(message)}`);
    } finally {
      await removeDiagnosticOverlay(CURRENT_PAGE);
    }
  }
  return null;
}

export async function captureTestFailure(page, testInfo) {
  const testcase = CURRENT_TC || testInfo.title;
  const reason = testInfo.error?.message || `Test ended with status: ${testInfo.status}`;
  const entry = {
    time: ts(),
    level: "fail",
    test: testcase,
    flow: CURRENT_FLOW,
    message: reason,
    meta: { step: CURRENT_STEP || "test execution", status: testInfo.status },
  };
  ERRORS.push(entry);
  recordDiagnostic({
    severity: "error",
    message: reason,
    stackTrace: testInfo.error?.stack || "",
    source: "playwright-test",
  });
  console.error(`[FAIL] ${entry.time} ${contextPrefix()} - ${reason}`);
  if (!page || page.isClosed()) return;

  await showDiagnosticOverlay(page, "FAIL", reason, testcase, CURRENT_STEP);
  const screenshot = await takeScreenshot(page, `FAIL_${safeName(reason)}`);
  if (screenshot) {
    await testInfo.attach("failure-diagnostic.png", { path: screenshot }).catch(() => {});
  }
  await testInfo.attach("failure-diagnostics.json", {
    body: Buffer.from(JSON.stringify({ infos: INFOS, warnings: WARNINGS, errors: ERRORS }, null, 2)),
    contentType: "application/json",
  }).catch(() => {});
}

export async function takeScreenshot(page, name) {
  if (!page || page.isClosed()) return null;
  try {
    const file = path.join(
      SCREENSHOT_DIR,
      `${Date.now()}_${safeName(CURRENT_TC)}_${safeName(name)}.png`
    );
    await page.screenshot({ path: file, fullPage: true });
    logInfo(`Screenshot saved: ${path.basename(file)}`);
    return file;
  } catch (e) {
    console.warn(`[SCREENSHOT] failed: ${e.message}`);
    return null;
  }
}

export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function focusPage(page) {
  try {
    await page.bringToFront();
  } catch {
    /* ignore */
  }
  if (page && !page.isClosed()) {
    await page.waitForTimeout(150);
  }
}

// ─── Professional gradient status bar (GeoViewer style) ──────────────────────

/**
 * Inject / refresh the fixed top banner:
 *   [ TEST CASE: … ]  [ current step ]  [ url ]
 */
export async function updateStatusBar(page, { tc, step, url } = {}) {
  if (!page || page.isClosed()) return;

  let state = PAGE_VISUAL_STATE.get(page);
  if (!state) {
    state = { tc: CURRENT_TC, step: "", url: "" };
    PAGE_VISUAL_STATE.set(page, state);
  }
  if (tc !== undefined) state.tc = tc;
  if (step !== undefined) state.step = step;
  try {
    const currentUrl = page.url();
    if (currentUrl && currentUrl !== "about:blank") state.url = currentUrl;
    else if (url) state.url = url;
  } catch {
    if (url) state.url = url;
  }

  try {
    await page.evaluate(
      ({ tcText, stepText, urlText }) => {
        // Spacer so app content is not covered
        let spacer = document.getElementById("pw-layout-spacer");
        if (!spacer) {
          spacer = document.createElement("div");
          spacer.id = "pw-layout-spacer";
          spacer.style.cssText =
            "width:100%;height:52px;pointer-events:none;flex-shrink:0;";
          if (document.body) document.body.prepend(spacer);
        }

        let bar = document.getElementById("pw-banner-container");
        if (!bar) {
          bar = document.createElement("div");
          bar.id = "pw-banner-container";
          Object.assign(bar.style, {
            position: "fixed",
            top: "0",
            left: "0",
            width: "100%",
            zIndex: "2147483647",
            display: "flex",
            alignItems: "center",
            flexWrap: "nowrap",
            gap: "10px",
            padding: "8px 14px",
            boxSizing: "border-box",
            pointerEvents: "none",
            fontFamily: "Segoe UI, system-ui, sans-serif",
            background:
              "linear-gradient(90deg, rgba(20,70,120,.96), rgba(20,130,100,.96))",
            borderBottom: "3px solid #F5A614",
            boxShadow: "0 4px 18px rgba(0,0,0,0.45)",
            minHeight: "48px",
          });

          const testcase = document.createElement("div");
          testcase.id = "pw-testcase-header";
          Object.assign(testcase.style, {
            color: "#fff",
            fontSize: "13px",
            fontWeight: "700",
            lineHeight: "1.25",
            textShadow: "0 1px 2px #000",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "32vw",
            flex: "0 1 auto",
            background: "rgba(0,0,0,0.28)",
            padding: "6px 10px",
            borderRadius: "6px",
            border: "1px solid rgba(255,255,255,0.18)",
          });

          const stepEl = document.createElement("div");
          stepEl.id = "pw-step-banner";
          Object.assign(stepEl.style, {
            color: "#10151c",
            fontSize: "13px",
            fontWeight: "700",
            lineHeight: "1.25",
            background: "rgba(255,255,255,.96)",
            padding: "6px 10px",
            borderRadius: "6px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "42vw",
            flex: "1 1 auto",
          });

          const urlEl = document.createElement("div");
          urlEl.id = "pw-url-banner";
          Object.assign(urlEl.style, {
            color: "#fff",
            fontSize: "11px",
            opacity: "0.88",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "22vw",
            marginLeft: "auto",
            flex: "0 1 auto",
          });

          bar.append(testcase, stepEl, urlEl);
          document.documentElement.appendChild(bar);
        }

        const tcEl = document.getElementById("pw-testcase-header");
        if (tcEl) {
          const clean = String(tcText || "")
            .replace(/^TEST CASE:\s*/i, "")
            .trim();
          tcEl.textContent = clean ? `TEST CASE: ${clean}` : "TEST CASE:";
          tcEl.title = clean;
        }

        const stepEl = document.getElementById("pw-step-banner");
        if (stepEl && stepText) {
          stepEl.textContent = stepText;
          stepEl.title = stepText;
        }

        const urlEl = document.getElementById("pw-url-banner");
        if (urlEl && urlText) urlEl.textContent = urlText;
      },
      {
        tcText: state.tc || CURRENT_TC || "",
        stepText: state.step || "",
        urlText: state.url || "",
      }
    );
  } catch {
    /* page may be navigating */
  }
}

export async function startVisualTest(page, { tcName, firstStep, url } = {}) {
  if (tcName) {
    CURRENT_TC = tcName;
    STEP_COUNTER = 0;
  }
  CURRENT_STEP = firstStep || "Starting";
  setPageRef(page);
  await focusPage(page);
  await updateStatusBar(page, {
    tc: CURRENT_TC,
    step: firstStep || "Starting",
    url: url || "",
  });
  logInfo(`Visual test started: ${CURRENT_TC}`);
}

export async function refreshVisualUrl(page) {
  try {
    await updateStatusBar(page, { url: page.url() });
  } catch {
    /* ignore */
  }
}

// ─── Highlight + focus on active element ─────────────────────────────────────

/**
 * Scroll into view, focus, orange outline + glow. Returns disposer.
 */
export async function highlight(page, locator, ms = VISUAL_STEP_DELAY_MS) {
  if (!locator) return async () => {};
  try {
    await locator.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
    await locator.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
    await locator.focus().catch(() => {});
    await focusPage(page);

    await locator.evaluate((el) => {
      el.__pwPrevOutline = el.style.outline;
      el.__pwPrevShadow = el.style.boxShadow;
      el.__pwPrevZ = el.style.zIndex;
      el.__pwPrevTransition = el.style.transition;
      el.style.transition = "outline 0.15s ease, box-shadow 0.15s ease";
      el.style.outline = "3px solid #FF6B00";
      el.style.boxShadow =
        "0 0 0 4px rgba(255,107,0,0.35), 0 0 16px rgba(255,107,0,0.45)";
      // Do NOT raise z-index on #map — it covers .map-overlay-card (left control box)
      const id = el.id || "";
      const isMap =
        id === "map" ||
        el.classList.contains("leaflet-container") ||
        el.classList.contains("leaflet-map");
      if (!isMap) {
        el.style.zIndex = "2147483646";
      }
    });

    if (ms > 0) await page.waitForTimeout(ms);
  } catch {
    return async () => {};
  }

  return async () => {
    try {
      await locator.evaluate((el) => {
        el.style.outline = el.__pwPrevOutline || "";
        el.style.boxShadow = el.__pwPrevShadow || "";
        el.style.zIndex = el.__pwPrevZ || "";
        el.style.transition = el.__pwPrevTransition || "";
      });
    } catch {
      /* ignore */
    }
  };
}

export async function clearHighlight(locator) {
  if (!locator) return;
  try {
    await locator.evaluate((el) => {
      el.style.outline = el.__pwPrevOutline || "";
      el.style.boxShadow = el.__pwPrevShadow || "";
      el.style.zIndex = el.__pwPrevZ || "";
    });
  } catch {
    /* ignore */
  }
}

// ─── showStep — numbered, logged, status-bar + highlight ─────────────────────

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text  Step description (will be prefixed with Step N if not already)
 * @param {import('@playwright/test').Locator|null} [locator]
 * @param {Function|null} [actionFn]
 */
export async function showStep(page, text, locator, actionFn) {
  setPageRef(page);
  await focusPage(page);

  // Auto-number unless caller already used "Step N:" or "PART"
  let label = text;
  if (!/^(Step\s*\d+|PART\s*\d+)/i.test(text.trim())) {
    STEP_COUNTER += 1;
    label = `Step ${STEP_COUNTER}: ${text}`;
  }
  CURRENT_STEP = label;

  await updateStatusBar(page, {
    tc: CURRENT_TC,
    step: label,
    url: (() => {
      try {
        return page.url();
      } catch {
        return "";
      }
    })(),
  });
  logInfo(label);

  let dispose = async () => {};
  if (locator) {
    dispose = await highlight(page, locator, Math.min(VISUAL_STEP_DELAY_MS, 600));
  } else if (VISUAL_STEP_DELAY_MS > 0 && page && !page.isClosed()) {
    await page.waitForTimeout(Math.min(VISUAL_STEP_DELAY_MS, 250));
  }

  try {
    if (typeof actionFn === "function") {
      return await actionFn();
    }
  } finally {
    await dispose();
  }
}

export async function visualClick(page, locator, stepLabel) {
  return showStep(page, stepLabel || "Click", locator, () => locator.click());
}

export async function visualSetInputFiles(page, locator, files, stepLabel) {
  return showStep(page, stepLabel || "Set input files", locator, () =>
    locator.setInputFiles(files)
  );
}

/**
 * Robust assert: log + screenshot on failure.
 */
export async function softExpect(page, description, fn) {
  try {
    await fn();
    logInfo(`✅ ${description}`);
  } catch (error) {
    await addError(description, { error: error.message });
    await takeScreenshot(page, safeName(description));
    throw error;
  }
}


/**
 * If error is the 30-min processing timeout, skip the test instead of failing.
 * Use in test catch blocks for upload flows.
 */
export function isProcessingTimeoutError(error) {
  const msg = error?.message || String(error || "");
  return /PROCESSING_TIMEOUT_30MIN|timed out after|exceeded \d+ min/i.test(msg);
}

// ─── Global raster highlight (tight geo / content-aware box) ─────────────────
// Product (map.js): each layer is L.imageOverlay + BlobTileLayer with exact
// leafletBounds from mapDataList[].bounds {minLat,maxLat,minLon,maxLon}.
// Prefer geo→screen conversion via Leaflet; fall back to opaque-pixel scan.
// Use anywhere: inspectRasterPixels / drawRasterHighlightBox / highlightRasterRegion

/**
 * Find the live Leaflet Map instance attached to #map (or child pane).
 */
function findLeafletMapInPage() {
  // runs inside page.evaluate via inlined logic below
}

/**
 * Inspect map for uploaded raster footprint.
 * Priority:
 *  1) Leaflet ImageOverlay / TileLayer options.bounds → screen (product truth)
 *  2) Opaque-pixel content bounds on image-overlay / crisp-image tiles
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{rendered:boolean, bounds:object|null, count:number, mode:string, samples?:object[]}>}
 */
export async function inspectRasterPixels(page, filenameFilter = null) {
  // Primary path: Leaflet layers + DOM content (sync evaluate)
  const primary = await page.evaluate((filenameFilter) => {
    const mapEl = document.getElementById("map");
    if (!mapEl) return { rendered: false, bounds: null, count: 0, mode: "none" };
    const nameMatch = (urlOrName) => {
      if (!filenameFilter) return true;
      const f = String(filenameFilter).toLowerCase();
      const stem = f.replace(/\.[^.]+$/, "");
      const s = String(urlOrName || "").toLowerCase();
      return s.includes(encodeURIComponent(filenameFilter).toLowerCase()) ||
        s.includes(f) ||
        s.includes(stem);
    };

    const mapRect = mapEl.getBoundingClientRect();
    const clipToMap = (rect) => {
      const left = Math.max(rect.left, mapRect.left);
      const top = Math.max(rect.top, mapRect.top);
      const right = Math.min(rect.right, mapRect.right);
      const bottom = Math.min(rect.bottom, mapRect.bottom);
      if (right <= left || bottom <= top) return null;
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };

    // ── 1) Leaflet geo bounds → fixed screen coords (authoritative) ─────────
    const isLeafletMap = (v) => {
      try {
        return (
          v &&
          typeof v === "object" &&
          typeof v.latLngToContainerPoint === "function" &&
          typeof v.getSize === "function" &&
          (typeof v.eachLayer === "function" || (v._layers && typeof v._layers === "object"))
        );
      } catch {
        return false;
      }
    };

    const findLeafletMap = () => {
      const nodes = [
        mapEl,
        mapEl.querySelector && mapEl.querySelector(".leaflet-container"),
        document.querySelector(".leaflet-container"),
        document.querySelector(".leaflet-map-pane"),
        document.querySelector(".leaflet-tile-pane"),
        document.querySelector(".leaflet-overlay-pane"),
      ].filter(Boolean);

      const scan = (node) => {
        if (!node) return null;
        const keys = new Set([
          ...Object.keys(node),
          ...Object.getOwnPropertyNames(node),
        ]);
        for (const key of keys) {
          try {
            const v = node[key];
            if (isLeafletMap(v)) return v;
            // Sometimes map is nested one level (e.g. wrapper.obj)
            if (v && typeof v === "object") {
              for (const k2 of Object.keys(v)) {
                try {
                  if (isLeafletMap(v[k2])) return v[k2];
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
        return null;
      };

      for (const node of nodes) {
        const found = scan(node);
        if (found) return found;
        // Walk parents — Leaflet may stash map on an ancestor
        let p = node.parentElement;
        for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
          const f2 = scan(p);
          if (f2) return f2;
        }
      }

      // Last resort: search window for L.Map instances
      try {
        if (window.L && L.Map) {
          for (const key of Object.keys(window)) {
            try {
              if (isLeafletMap(window[key])) return window[key];
            } catch (_) {}
          }
        }
      } catch (_) {}

      return null;
    };

    /** Convert product mapDataList bounds (from chrome.storage) via Leaflet if map found */
    const boundsFromStorageAsyncNotAvailableInSyncEvaluate = null;

    const normalizeLayerBounds = (b) => {
      if (!b) return null;
      try {
        if (typeof b.getSouth === "function") {
          return {
            south: b.getSouth(),
            west: b.getWest(),
            north: b.getNorth(),
            east: b.getEast(),
          };
        }
        if (Array.isArray(b) && b.length >= 2) {
          const a = b[0];
          const c = b[1];
          const s = Array.isArray(a) ? Number(a[0]) : Number(a.lat);
          const w = Array.isArray(a) ? Number(a[1]) : Number(a.lng ?? a.lon);
          const n = Array.isArray(c) ? Number(c[0]) : Number(c.lat);
          const e = Array.isArray(c) ? Number(c[1]) : Number(c.lng ?? c.lon);
          if ([s, w, n, e].every(Number.isFinite)) {
            return { south: s, west: w, north: n, east: e };
          }
        }
        if (typeof b === "object") {
          const south = Number(b.south ?? b.minLat ?? b._southWest?.lat);
          const west = Number(b.west ?? b.minLon ?? b._southWest?.lng);
          const north = Number(b.north ?? b.maxLat ?? b._northEast?.lat);
          const east = Number(b.east ?? b.maxLon ?? b._northEast?.lng);
          if ([south, west, north, east].every(Number.isFinite)) {
            return { south, west, north, east };
          }
        }
      } catch {
        /* ignore */
      }
      return null;
    };

    const leafletMap = findLeafletMap();
    if (leafletMap) {
      const geoCandidates = [];
      try {
        leafletMap.eachLayer((layer) => {
          try {
            const layerUrl =
              layer._url ||
              (layer.options && (layer.options.url || layer.options.file)) ||
              "";
            if (filenameFilter && !nameMatch(layerUrl)) {
              // Still allow ImageOverlay without filter mismatch on empty url
              if (!layerUrl && typeof layer.getBounds === "function") {
                /* keep checking */
              } else {
                return;
              }
            }
            // ImageOverlay: getBounds()
            if (typeof layer.getBounds === "function" && (layer._url || layer._image)) {
              const n = normalizeLayerBounds(layer.getBounds());
              if (n) {
                const latSpan = Math.abs(n.north - n.south);
                const lonSpan = Math.abs(n.east - n.west);
                // Skip world/basemap-sized bounds
                if (latSpan < 80 && lonSpan < 160 && latSpan > 1e-8) {
                  if (!filenameFilter || nameMatch(layerUrl) || nameMatch(layer._url)) {
                    geoCandidates.push({
                      kind: "image-overlay-geo",
                      ...n,
                      area: latSpan * lonSpan,
                    });
                  }
                }
              }
            }
            // TileLayer / BlobTileLayer with options.bounds
            const optB = layer.options && layer.options.bounds;
            if (optB) {
              const n = normalizeLayerBounds(optB);
              if (n) {
                const latSpan = Math.abs(n.north - n.south);
                const lonSpan = Math.abs(n.east - n.west);
                if (latSpan < 80 && lonSpan < 160 && latSpan > 1e-8) {
                  if (!filenameFilter || nameMatch(layerUrl)) {
                    geoCandidates.push({
                      kind: "tile-layer-geo",
                      ...n,
                      area: latSpan * lonSpan,
                    });
                  }
                }
              }
            }
          } catch {
            /* skip layer */
          }
        });
      } catch {
        /* eachLayer failed */
      }

      if (geoCandidates.length) {
        // Prefer the smallest raster footprint (actual file), not union of all if multi
        // For multi-file map, union all for overall highlight; still tight vs basemap
        const south = Math.min(...geoCandidates.map((c) => c.south));
        const west = Math.min(...geoCandidates.map((c) => c.west));
        const north = Math.max(...geoCandidates.map((c) => c.north));
        const east = Math.max(...geoCandidates.map((c) => c.east));

        try {
          const sw = leafletMap.latLngToContainerPoint([south, west]);
          const ne = leafletMap.latLngToContainerPoint([north, east]);
          // container points are relative to map pane origin
          const left = mapRect.left + Math.min(sw.x, ne.x);
          const right = mapRect.left + Math.max(sw.x, ne.x);
          const top = mapRect.top + Math.min(sw.y, ne.y);
          const bottom = mapRect.top + Math.max(sw.y, ne.y);
          const clipped = clipToMap({ left, top, right, bottom });
          if (clipped && clipped.width >= 4 && clipped.height >= 4) {
            return {
              rendered: true,
              bounds: clipped,
              count: geoCandidates.length,
              mode: "leaflet-geo",
              samples: geoCandidates.slice(0, 4).map((c) => ({
                kind: c.kind,
                south: c.south,
                west: c.west,
                north: c.north,
                east: c.east,
              })),
            };
          }
        } catch {
          /* fall through to pixel scan */
        }
      }
    }

    // ── 2) Content-aware opaque-pixel scan (fallback) ───────────────────────
    const intersect = clipToMap;

    const scoreAndContentRect = (image, visibleRect) => {
      try {
        const ir = image.getBoundingClientRect();
        const scaleX = image.naturalWidth / (ir.width || 1);
        const scaleY = image.naturalHeight / (ir.height || 1);
        const sourceX = Math.max(0, (visibleRect.left - ir.left) * scaleX);
        const sourceY = Math.max(0, (visibleRect.top - ir.top) * scaleY);
        const sourceWidth = Math.max(1, visibleRect.width * scaleX);
        const sourceHeight = Math.max(1, visibleRect.height * scaleY);

        const SW = 64;
        const SH = 64;
        const canvas = document.createElement("canvas");
        canvas.width = SW;
        canvas.height = SH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          SW,
          SH
        );
        const pixels = ctx.getImageData(0, 0, SW, SH).data;
        let opaque = 0;
        let minX = SW;
        let minY = SH;
        let maxX = -1;
        let maxY = -1;
        const ALPHA = 24;
        for (let y = 0; y < SH; y++) {
          for (let x = 0; x < SW; x++) {
            const a = pixels[(y * SW + x) * 4 + 3];
            if (a > ALPHA) {
              opaque++;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (opaque < 1 || maxX < minX) {
          return { opaque, contentRect: null };
        }
        const contentRect = {
          left: visibleRect.left + (minX / SW) * visibleRect.width,
          top: visibleRect.top + (minY / SH) * visibleRect.height,
          right: visibleRect.left + ((maxX + 1) / SW) * visibleRect.width,
          bottom: visibleRect.top + ((maxY + 1) / SH) * visibleRect.height,
        };
        contentRect.width = contentRect.right - contentRect.left;
        contentRect.height = contentRect.bottom - contentRect.top;
        return { opaque, contentRect };
      } catch {
        const ok = image.complete && image.naturalWidth > 0;
        return {
          opaque: ok ? 64 : 0,
          contentRect: ok ? visibleRect : null,
        };
      }
    };

    const overlayImgs = [
      ...mapEl.querySelectorAll(
        ".leaflet-overlay-pane img.leaflet-image-layer, img.leaflet-image-layer"
      ),
    ];
    const crispImgs = [
      ...mapEl.querySelectorAll(
        ".leaflet-layer.crisp-image img.leaflet-tile, .leaflet-layer.crisp-image img"
      ),
    ];

    const rendered = [];

    const pushIfRaster = (image, kind, minOpaque) => {
      const style = getComputedStyle(image);
      const visibleRect = intersect(image.getBoundingClientRect());
      let opacity = 1;
      for (let el = image; el && el !== mapEl; el = el.parentElement) {
        opacity *= Number.parseFloat(getComputedStyle(el).opacity || "1");
      }
      const visible =
        Boolean(visibleRect) &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        opacity > 0.05;
      const loaded = image.complete && image.naturalWidth > 0;
      if (!visible || !loaded) return;
      if (visibleRect.width < 8 || visibleRect.height < 8) return;

      const { opaque, contentRect } = scoreAndContentRect(image, visibleRect);
      if (opaque < minOpaque || !contentRect) return;
      if (contentRect.width < 4 || contentRect.height < 4) return;

      rendered.push({
        kind,
        rect: contentRect,
        domRect: visibleRect,
        w: image.naturalWidth,
        h: image.naturalHeight,
        opaque,
      });
    };

    for (const img of overlayImgs) pushIfRaster(img, "image-overlay", 48);
    const overlays = rendered.filter((r) => r.kind === "image-overlay");
    if (overlays.length) {
      const bounds = {
        left: Math.min(...overlays.map((t) => t.rect.left)),
        top: Math.min(...overlays.map((t) => t.rect.top)),
        right: Math.max(...overlays.map((t) => t.rect.right)),
        bottom: Math.max(...overlays.map((t) => t.rect.bottom)),
      };
      return {
        rendered: true,
        bounds,
        count: overlays.length,
        mode: "image-overlay",
        samples: overlays.slice(0, 4),
      };
    }

    for (const img of crispImgs) pushIfRaster(img, "blob-tile", 120);
    if (!rendered.length) {
      for (const img of crispImgs) pushIfRaster(img, "blob-tile", 48);
    }

    if (!rendered.length) {
      return { rendered: false, bounds: null, count: 0, mode: "none" };
    }

    const centers = rendered.map((t) => ({
      t,
      cx: (t.rect.left + t.rect.right) / 2,
      cy: (t.rect.top + t.rect.bottom) / 2,
    }));
    const mid = (arr) => {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const medX = mid(centers.map((c) => c.cx));
    const medY = mid(centers.map((c) => c.cy));
    const dists = centers.map((c) => Math.hypot(c.cx - medX, c.cy - medY));
    const medDist = mid(dists) || 1;
    let tight = centers
      .filter((c, i) => dists[i] <= Math.max(medDist * 2.5, 280))
      .map((c) => c.t);
    if (tight.length < 1) tight = rendered;

    tight.sort((a, b) => b.opaque - a.opaque);
    if (tight.length > 4) {
      tight = tight.slice(0, Math.max(4, Math.ceil(tight.length * 0.75)));
    }

    const bounds = {
      left: Math.min(...tight.map((t) => t.rect.left)),
      top: Math.min(...tight.map((t) => t.rect.top)),
      right: Math.max(...tight.map((t) => t.rect.right)),
      bottom: Math.max(...tight.map((t) => t.rect.bottom)),
    };

    const mapW = mapRect.width || 1;
    const mapH = mapRect.height || 1;
    const bw = bounds.right - bounds.left;
    const bh = bounds.bottom - bounds.top;
    if (bw > mapW * 0.98 && bh > mapH * 0.95) {
      const padX = Math.max(8, bw * 0.02);
      const padY = Math.max(8, bh * 0.02);
      bounds.left += padX;
      bounds.right -= padX;
      bounds.top += padY;
      bounds.bottom -= padY;
    }

    return {
      rendered: true,
      bounds,
      count: tight.length,
      mode: "blob-tiles",
      samples: tight.slice(0, 4),
    };
  }, filenameFilter);

  // Prefer product geo footprint when Leaflet path succeeded
  if (primary?.mode === "leaflet-geo" && primary.bounds) {
    return primary;
  }

  // Product stores exact bounds in chrome.storage.local.mapDataList — convert to screen
  // via Leaflet when map instance is available (fixes oversized tile-union boxes).
  try {
    const fromStorage = await page.evaluate(async (filenameFilter) => {
      const mapEl = document.getElementById("map");
      if (!mapEl) return null;
      const mapRect = mapEl.getBoundingClientRect();

      const isLeafletMap = (v) => {
        try {
          return (
            v &&
            typeof v.latLngToContainerPoint === "function" &&
            typeof v.getSize === "function"
          );
        } catch {
          return false;
        }
      };
      const findMap = () => {
        const nodes = [
          mapEl,
          document.querySelector(".leaflet-container"),
          document.querySelector(".leaflet-map-pane"),
        ].filter(Boolean);
        for (const node of nodes) {
          const keys = [
            ...Object.keys(node),
            ...Object.getOwnPropertyNames(node),
          ];
          for (const key of keys) {
            try {
              if (isLeafletMap(node[key])) return node[key];
            } catch (_) {}
          }
        }
        return null;
      };

      const list = await new Promise((resolve) => {
        try {
          if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve([]);
            return;
          }
          chrome.storage.local.get("mapDataList", (r) => {
            resolve(Array.isArray(r?.mapDataList) ? r.mapDataList : []);
          });
        } catch {
          resolve([]);
        }
      });
      if (!list.length) return null;

      const nameMatch = (name) => {
        if (!filenameFilter) return true;
        const f = String(filenameFilter).toLowerCase();
        const stem = f.replace(/\.[^.]+$/, "");
        const s = String(name || "").toLowerCase();
        return s === f || s.includes(stem);
      };
      const items = list.filter((it) => nameMatch(it.filename || it.name));
      const use = items.length ? items : list;
      const samples = [];
      for (const it of use) {
        const b = it.bounds || {};
        const south = Number(b.minLat ?? b.south);
        const west = Number(b.minLon ?? b.west);
        const north = Number(b.maxLat ?? b.north);
        const east = Number(b.maxLon ?? b.east);
        if (![south, west, north, east].every(Number.isFinite)) continue;
        if (Math.abs(north - south) > 80 || Math.abs(east - west) > 160) continue;
        samples.push({
          kind: "storage-geo",
          south,
          west,
          north,
          east,
          filename: it.filename || it.name,
        });
      }
      if (!samples.length) return null;

      const south = Math.min(...samples.map((s) => s.south));
      const west = Math.min(...samples.map((s) => s.west));
      const north = Math.max(...samples.map((s) => s.north));
      const east = Math.max(...samples.map((s) => s.east));

      const mapInst = findMap();
      if (!mapInst) {
        return { mode: "storage-geo-no-map", samples, count: samples.length };
      }
      const sw = mapInst.latLngToContainerPoint([south, west]);
      const ne = mapInst.latLngToContainerPoint([north, east]);
      const left = mapRect.left + Math.min(sw.x, ne.x);
      const right = mapRect.left + Math.max(sw.x, ne.x);
      const top = mapRect.top + Math.min(sw.y, ne.y);
      const bottom = mapRect.top + Math.max(sw.y, ne.y);
      const bounds = {
        left: Math.max(left, mapRect.left),
        top: Math.max(top, mapRect.top),
        right: Math.min(right, mapRect.right),
        bottom: Math.min(bottom, mapRect.bottom),
      };
      bounds.width = bounds.right - bounds.left;
      bounds.height = bounds.bottom - bounds.top;
      if (bounds.width < 4 || bounds.height < 4) return null;
      return {
        rendered: true,
        bounds,
        count: samples.length,
        mode: "leaflet-geo", // same draw path as layer bounds (map-locked rect)
        samples,
      };
    }, filenameFilter);

    if (fromStorage?.rendered && fromStorage.bounds) {
      return fromStorage;
    }
  } catch {
    /* storage path unavailable */
  }

  return primary;
}

/**
 * Draw a single fixed orange rectangle over raster content bounds.
 * Global — works on any page. Box stays until removed or redrawn.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{bounds?: object, mode?: string, count?: number}|null} pixelState
 * @param {{id?: string, color?: string}|object} [opts]
 */
export async function drawRasterHighlightBox(page, pixelState, opts = {}) {
  const id = opts.id || "pw-raster-highlight-box";
  const color = opts.color || "#FF6B00";
  // Install / refresh a geo-locked Leaflet rectangle that survives pan, zoom, and
  // layout changes (e.g. FILE METADATA panel open). Falls back to a map-relative
  // fixed div that auto-redraws on resize/move.
  return page.evaluate(
    async ({ state, boxId, borderColor, filenameFilter }) => {
      document.getElementById(boxId)?.remove();

      const mapEl = document.getElementById("map");
      if (mapEl && mapEl.__pwRasterRects) {
        const keep = [];
        for (const entry of mapEl.__pwRasterRects) {
          if (entry.id === boxId || boxId === "pw-raster-highlight-box") {
            try { entry.layer.remove(); } catch (_) {}
          } else keep.push(entry);
        }
        mapEl.__pwRasterRects = keep;
      }

      const isLeafletMap = (v) => {
        try {
          return (
            v &&
            typeof v.latLngToContainerPoint === "function" &&
            typeof v.getSize === "function" &&
            (typeof v.eachLayer === "function" || v._layers)
          );
        } catch { return false; }
      };

      const findMap = () => {
        const nodes = [
          mapEl,
          document.querySelector(".leaflet-container"),
          document.querySelector(".leaflet-map-pane"),
          document.querySelector(".leaflet-tile-pane"),
        ].filter(Boolean);
        for (const node of nodes) {
          const keys = [...Object.keys(node), ...Object.getOwnPropertyNames(node)];
          for (const key of keys) {
            try {
              if (isLeafletMap(node[key])) return node[key];
            } catch (_) {}
          }
          let p = node && node.parentElement;
          for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
            const keys2 = [...Object.keys(p), ...Object.getOwnPropertyNames(p)];
            for (const key of keys2) {
              try {
                if (isLeafletMap(p[key])) return p[key];
              } catch (_) {}
            }
          }
        }
        return null;
      };

      const normalizeGeo = (b) => {
        if (!b) return null;
        try {
          if (typeof b.getSouth === "function") {
            return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
          }
          if (Array.isArray(b) && b.length >= 2) {
            const a = b[0], c = b[1];
            const s = Array.isArray(a) ? Number(a[0]) : Number(a.lat);
            const w = Array.isArray(a) ? Number(a[1]) : Number(a.lng ?? a.lon);
            const n = Array.isArray(c) ? Number(c[0]) : Number(c.lat);
            const e = Array.isArray(c) ? Number(c[1]) : Number(c.lng ?? c.lon);
            if ([s, w, n, e].every(Number.isFinite)) return { south: s, west: w, north: n, east: e };
          }
          if (typeof b === "object") {
            const south = Number(b.south ?? b.minLat ?? b._southWest?.lat);
            const west = Number(b.west ?? b.minLon ?? b._southWest?.lng);
            const north = Number(b.north ?? b.maxLat ?? b._northEast?.lat);
            const east = Number(b.east ?? b.maxLon ?? b._northEast?.lng);
            if ([south, west, north, east].every(Number.isFinite)) return { south, west, north, east };
          }
        } catch (_) {}
        return null;
      };

      // Resolve geo samples: prefer state.samples, else layer bounds, else storage
      let samples = (state && state.samples && state.samples.length)
        ? state.samples.filter((s) => Number.isFinite(s.south))
        : [];

      const mapInst = findMap();
      if (!samples.length && mapInst) {
        try {
          mapInst.eachLayer((layer) => {
            try {
              const url = layer._url || "";
              if (filenameFilter) {
                const f = String(filenameFilter).toLowerCase();
                const stem = f.replace(/\.[^.]+$/, "");
                if (url && !url.toLowerCase().includes(stem) && !url.toLowerCase().includes(f)) return;
              }
              let n = null;
              if (typeof layer.getBounds === "function" && (layer._url || layer._image)) {
                n = normalizeGeo(layer.getBounds());
              }
              if (!n && layer.options && layer.options.bounds) {
                n = normalizeGeo(layer.options.bounds);
              }
              if (!n) return;
              const latSpan = Math.abs(n.north - n.south);
              const lonSpan = Math.abs(n.east - n.west);
              if (latSpan > 80 || lonSpan > 160 || latSpan < 1e-8) return;
              samples.push({ kind: "layer-geo", ...n });
            } catch (_) {}
          });
        } catch (_) {}
      }

      if (!samples.length) {
        try {
          const list = await new Promise((resolve) => {
            try {
              chrome.storage.local.get("mapDataList", (r) =>
                resolve(Array.isArray(r?.mapDataList) ? r.mapDataList : [])
              );
            } catch { resolve([]); }
          });
          for (const it of list) {
            const name = it.filename || it.name || "";
            if (filenameFilter) {
              const f = String(filenameFilter).toLowerCase();
              const stem = f.replace(/\.[^.]+$/, "");
              if (!name.toLowerCase().includes(stem)) continue;
            }
            const n = normalizeGeo(it.bounds);
            if (!n) continue;
            const latSpan = Math.abs(n.north - n.south);
            const lonSpan = Math.abs(n.east - n.west);
            if (latSpan > 80 || lonSpan > 160) continue;
            samples.push({ kind: "storage-geo", ...n, filename: name });
          }
        } catch (_) {}
      }

      // Prefer tightest single-layer sample when filtering by filename
      if (samples.length && filenameFilter && samples.length > 1) {
        samples.sort(
          (a, b) =>
            Math.abs(a.north - a.south) * Math.abs(a.east - a.west) -
            Math.abs(b.north - b.south) * Math.abs(b.east - b.west)
        );
        samples = [samples[0]];
      }

      let geo = null;
      if (samples.length) {
        geo = {
          south: Math.min(...samples.map((s) => s.south)),
          west: Math.min(...samples.map((s) => s.west)),
          north: Math.max(...samples.map((s) => s.north)),
          east: Math.max(...samples.map((s) => s.east)),
        };
      }

      // ── Geo-locked Leaflet rectangle (moves with pan/zoom, survives resize) ──
      if (geo && mapInst && typeof L !== "undefined" && L.rectangle) {
        const rect = L.rectangle(
          [
            [geo.south, geo.west],
            [geo.north, geo.east],
          ],
          {
            color: borderColor,
            weight: 3,
            fill: false,
            opacity: 1,
            interactive: false,
            className: "pw-raster-highlight-rect",
            pane: "overlayPane",
          }
        );
        rect.addTo(mapInst);
        if (mapEl) {
          if (!mapEl.__pwRasterRects) mapEl.__pwRasterRects = [];
          mapEl.__pwRasterRects.push({ id: boxId, layer: rect, geo });
        }

        // Also keep a screen-div in sync for visual thickness on some themes
        const syncDiv = () => {
          try {
            const mapRect = mapEl.getBoundingClientRect();
            const sw = mapInst.latLngToContainerPoint([geo.south, geo.west]);
            const ne = mapInst.latLngToContainerPoint([geo.north, geo.east]);
            const left = mapRect.left + Math.min(sw.x, ne.x);
            const right = mapRect.left + Math.max(sw.x, ne.x);
            const top = mapRect.top + Math.min(sw.y, ne.y);
            const bottom = mapRect.top + Math.max(sw.y, ne.y);
            let div = document.getElementById(boxId);
            if (!div) {
              div = document.createElement("div");
              div.id = boxId;
              document.body.appendChild(div);
            }
            Object.assign(div.style, {
              position: "fixed",
              left: `${left}px`,
              top: `${top}px`,
              width: `${Math.max(0, right - left)}px`,
              height: `${Math.max(0, bottom - top)}px`,
              boxSizing: "border-box",
              border: `3px solid ${borderColor}`,
              boxShadow:
                "inset 0 0 0 1px rgba(255,255,255,0.95), 0 0 18px rgba(255,107,0,0.55)",
              zIndex: "2147483646",
              pointerEvents: "none",
              borderRadius: "2px",
            });
          } catch (_) {}
        };
        syncDiv();
        // Re-sync when map moves or window/layout changes (metadata panel open)
        if (!mapEl.__pwHighlightHooked) {
          mapEl.__pwHighlightHooked = true;
          const resyncAll = () => {
            try {
              for (const entry of mapEl.__pwRasterRects || []) {
                if (!entry.geo) continue;
                const g = entry.geo;
                const mapRect = mapEl.getBoundingClientRect();
                const sw = mapInst.latLngToContainerPoint([g.south, g.west]);
                const ne = mapInst.latLngToContainerPoint([g.north, g.east]);
                const left = mapRect.left + Math.min(sw.x, ne.x);
                const right = mapRect.left + Math.max(sw.x, ne.x);
                const top = mapRect.top + Math.min(sw.y, ne.y);
                const bottom = mapRect.top + Math.max(sw.y, ne.y);
                const div = document.getElementById(entry.id);
                if (!div) continue;
                Object.assign(div.style, {
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${Math.max(0, right - left)}px`,
                  height: `${Math.max(0, bottom - top)}px`,
                });
              }
            } catch (_) {}
          };
          mapInst.on("move zoom moveend zoomend viewreset resize", resyncAll);
          window.addEventListener("resize", resyncAll);
          // Metadata panel toggles change layout without window resize
          const meta = document.getElementById("metaPanel");
          if (meta && typeof MutationObserver !== "undefined") {
            new MutationObserver(resyncAll).observe(meta, {
              attributes: true,
              attributeFilter: ["class", "style"],
            });
          }
          mapEl.__pwResyncHighlight = resyncAll;
        } else if (mapEl.__pwResyncHighlight) {
          mapEl.__pwResyncHighlight();
        }

        const layerName = document.querySelector("#layerList .layer-item-name");
        if (layerName) {
          layerName.style.outline = `2px solid ${borderColor}`;
          layerName.style.boxShadow = "0 0 8px rgba(255,107,0,0.5)";
        }
        return {
          boxDrawn: true,
          mode: "leaflet-geo-rect",
          count: samples.length,
          bounds: state?.bounds || null,
          geo,
          layerText: layerName ? (layerName.textContent || "").trim() : null,
        };
      }

      // ── Fallback: fixed div from pixel bounds + resize hook ──
      if (!state || !state.bounds) {
        return { boxDrawn: false, mode: state?.mode || "none", count: 0 };
      }
      const { left, top, right, bottom } = state.bounds;
      const width = right - left;
      const height = bottom - top;
      if (width < 4 || height < 4) {
        return { boxDrawn: false, mode: state.mode, count: state.count, reason: "bounds-too-small" };
      }
      const marker = document.createElement("div");
      marker.id = boxId;
      Object.assign(marker.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        boxSizing: "border-box",
        border: `3px solid ${borderColor}`,
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.95), 0 0 18px rgba(255,107,0,0.55)",
        zIndex: "2147483646",
        pointerEvents: "none",
        borderRadius: "2px",
      });
      document.body.appendChild(marker);
      const layerName = document.querySelector("#layerList .layer-item-name");
      if (layerName) {
        layerName.style.outline = `2px solid ${borderColor}`;
        layerName.style.boxShadow = "0 0 8px rgba(255,107,0,0.5)";
      }
      return {
        boxDrawn: true,
        mode: state.mode || "fixed-div",
        count: state.count,
        bounds: state.bounds,
        layerText: layerName ? (layerName.textContent || "").trim() : null,
      };
    },
    {
      state: pixelState,
      boxId: id,
      borderColor: color,
      filenameFilter: opts.filename || null,
    }
  );
}

/**
 * Global one-shot: inspect raster + draw map-locked highlight.
 */
export async function highlightRasterRegion(page, opts = {}) {
  const holdMs = opts.holdMs ?? 1500;
  const pixelState = await inspectRasterPixels(page, opts.filename || null);
  const drawn = await drawRasterHighlightBox(page, pixelState, opts);
  // Force a layout-sync after metadata/control chrome may have shifted the map
  await page.evaluate(() => {
    const mapEl = document.getElementById("map");
    if (mapEl && typeof mapEl.__pwResyncHighlight === "function") {
      mapEl.__pwResyncHighlight();
    }
  }).catch(() => {});
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  return { ...drawn, pixelState };
}

export async function clearRasterHighlight(page, id = "pw-raster-highlight-box") {
  await page.evaluate((boxId) => {
    document.getElementById(boxId)?.remove();
    const mapEl = document.getElementById("map");
    if (mapEl && mapEl.__pwRasterRects) {
      const keep = [];
      for (const entry of mapEl.__pwRasterRects) {
        if (entry.id === boxId || boxId === "pw-raster-highlight-box") {
          try {
            entry.layer.remove();
          } catch (_) {}
        } else {
          keep.push(entry);
        }
      }
      mapEl.__pwRasterRects = keep;
    }
  }, id);
}
