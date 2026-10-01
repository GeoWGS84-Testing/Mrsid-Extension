import { expect } from "@playwright/test";
import {
  showStep,
  highlight,
  logInfo,
  addError,
  addWarning,
  takeScreenshot,
  setPageRef,
  setContext,
  startVisualTest,
  refreshVisualUrl,
  focusPage,
  inspectRasterPixels,
  drawRasterHighlightBox,
  highlightRasterRegion,
  clearRasterHighlight,
} from "../utils/helpers.js";

/**
 * Page Object — map.html
 *
 * Product rendering sequence:
 *  1. L.imageOverlay (preview) is added
 *  2. BlobTileLayer HD tiles load (class "crisp-image")
 *  3. When activeTiles > 2 → preview ImageOverlay is REMOVED
 *  4. HUD shows "STATUS: HD ACTIVE"
 *
 * So after HD is active we must detect crisp-image tiles / layer list /
 * HD status — not leaflet-image-layer (often already gone).
 */
export class MapPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page, extensionId) {
    if (!extensionId) throw new Error("extensionId is required");
    this.page = page;
    this.extensionId = extensionId;

    this.mapContainer = page.locator("#map");
    this.layerList = page.locator("#layerList");
    this.zoomLevel = page.locator("#zoomLevel");
    this.opacityRange = page.locator("#opacityRange");
    this.mapUploadBtn = page.locator("#mapUploadBtn");
    this.mapFileInput = page.locator("#mapFileInput");
    this.metaToggleBtn = page.locator("#metaToggleBtn");
    this.metaPanel = page.locator("#metaPanel");
    this.metaPanelBody = page.locator("#metaPanelBody");
    this.metaCloseBtn = page.locator("#metaCloseBtn");
    this.hdStatus = page.locator("#hdStatus");
    this.mapOverlayCard = page.locator(".map-overlay-card");
    this.layerName = page.locator("#layerList .layer-item-name");
    this.layerItems = page.locator("#layerList .layer-item, #layerList .layer-item-name");
  }

  async waitForMapReady(timeout = 60_000) {
    setPageRef(this.page);
    setContext({ flow: "Map" });
    await focusPage(this.page);
    // Preserve TC name already set via setContext in the test
    await startVisualTest(this.page, {
      tcName: undefined, // helpers use active context testcase
      firstStep: "Initialize map page",
      url: this.page.url(),
    });
    await expect(this.page.locator("#pw-testcase-header")).toContainText(/GV-TC-/);
    await expect(this.page.locator("#pw-step-banner")).toContainText(
      "Initialize map page"
    );

    await showStep(
      this.page,
      "Wait for #map and Leaflet container",
      this.mapContainer
    );
    try {
      await expect(this.mapContainer).toBeVisible({ timeout });
      await expect(this.page.locator(".leaflet-container")).toBeVisible({
        timeout: 15_000,
      });
      await highlight(this.page, this.mapContainer, 300);
      await refreshVisualUrl(this.page);
      logInfo("✅ Map surface ready");
    } catch (error) {
      await addError("Map not ready", { error: error.message });
      await takeScreenshot(this.page, "map-not-ready");
      throw error;
    }
  }

  /**
   * Wait until the uploaded raster is visible on the map.
   * Accepts either:
   *  - preview ImageOverlay still present, OR
   *  - HD tile layer active (STATUS: HD ACTIVE + crisp-image tiles / layer list)
   * Then highlights the raster region (overlay img or crisp-image tiles).
   */
  async waitForRasterRendered(timeout = 120_000) {
    await showStep(
      this.page,
      "Wait for uploaded raster fully rendered on map",
      this.mapContainer
    );

    const deadline = Date.now() + timeout;
    let lastDiag = null;
    let pixelState = null;

    // Poll until we have real raster pixels (image-overlay, blob tiles, or leaflet-geo)
    while (Date.now() < deadline) {
      lastDiag = await this.getRenderDiagnostics();
      pixelState = await this._inspectRasterPixels();

      if (pixelState.rendered && pixelState.bounds) {
        break;
      }
      await this.page.waitForTimeout(400);
    }

    // Settle: product removes preview ImageOverlay once HD tiles load.
    // Prefer leaflet-geo / HD footprint so the box matches the true georef extent.
    const settleUntil = Date.now() + 8_000;
    while (Date.now() < settleUntil && Date.now() < deadline) {
      lastDiag = await this.getRenderDiagnostics();
      pixelState = await this._inspectRasterPixels();
      if (
        pixelState?.mode === "leaflet-geo" ||
        pixelState?.mode === "storage-geo" ||
        lastDiag?.hdActive
      ) {
        break;
      }
      await this.page.waitForTimeout(400);
    }

    lastDiag = await this.getRenderDiagnostics();
    pixelState = await this._inspectRasterPixels();

    const present =
      (pixelState && pixelState.rendered) ||
      lastDiag.hdActive ||
      lastDiag.layerItemCount > 0 ||
      lastDiag.overlayCount > 0;

    if (!present) {
      await addError("Uploaded raster not detected on map", { lastDiag, pixelState });
      await takeScreenshot(this.page, "map-overlay-missing");
      throw new Error(
        `Uploaded raster not on map. Diagnostics: ${JSON.stringify({ lastDiag, pixelState })}`
      );
    }

    // Draw ONE tight box (leaflet-geo-rect when possible so it tracks pan/zoom)
    const highlighted = await this._drawRasterHighlightBox(pixelState);
    if (!highlighted.boxDrawn) {
      await addError("Raster is rendered but its highlight could not be drawn", {
        highlighted,
        lastDiag,
        pixelState,
      });
      await takeScreenshot(this.page, "raster-highlight-missing");
      throw new Error(
        `Raster rendered but highlight could not be drawn: ${JSON.stringify({ highlighted, lastDiag, pixelState })}`
      );
    }

    // Keep left control card above map
    await this.page.evaluate(() => {
      const card = document.querySelector(".map-overlay-card");
      if (card) card.style.zIndex = "2000";
      const map = document.getElementById("map");
      if (map && map.style.zIndex && Number(map.style.zIndex) > 1000) {
        map.style.zIndex = "";
      }
    });

    // Hold so the box is clearly visible (do not remove — stays for rest of test)
    await this.page.waitForTimeout(2000);

    logInfo("✅ Uploaded raster rendered & highlighted on map", {
      highlighted,
      diag: lastDiag,
      pixelState,
    });

    return highlighted;
  }

  /**
   * Inspect map for uploaded raster pixels (ImageOverlay or blob: HD tiles).
   * Delegates to global inspectRasterPixels() — content-aware (opaque) bounds
   * so the highlight box matches the raster area, not full 256px tile DOM rects.
   */
  async _inspectRasterPixels() {
    return inspectRasterPixels(this.page);
  }

  /**
   * Single fixed orange rectangle over raster content bounds (global helper).
   * Box stays on screen (not auto-removed) so later steps still show it.
   */
  async _drawRasterHighlightBox(pixelState) {
    return drawRasterHighlightBox(this.page, pixelState);
  }

  /**
   * Re-highlight raster region anytime (global helper). Use after pan/zoom/meta open.
   */
  async highlightRaster(opts = {}) {
    return highlightRasterRegion(this.page, opts);
  }

  /**
   * Layer names currently listed in the left control card.
   * @returns {Promise<string[]>}
   */
  async getLayerNames() {
    return this.page.evaluate(() => {
      const nodes = document.querySelectorAll("#layerList .layer-item-name");
      return Array.from(nodes)
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean);
    });
  }

  /**
   * Assert each expected filename (basename) appears in the map layer list.
   * Soft-matches: full name or stem without extension.
   * @param {string[]} expectedFiles absolute or relative paths or basenames
   */
  async assertLayersPresent(expectedFiles) {
    await showStep(this.page, "Verify map layer list contains uploaded files", this.layerList);
    const names = await this.getLayerNames();
    const norm = (s) =>
      String(s || "")
        .split(/[/\\]/)
        .pop()
        .trim()
        .toLowerCase();
    const stems = names.map((n) => norm(n).replace(/\.[^.]+$/, ""));
    const missing = [];
    for (const f of expectedFiles) {
      const base = norm(f);
      const stem = base.replace(/\.[^.]+$/, "");
      const found =
        names.some((n) => norm(n) === base || norm(n).includes(stem)) ||
        stems.some((s) => s === stem || s.includes(stem));
      if (!found) missing.push(base);
    }
    logInfo("Map layer names", { names, expected: expectedFiles.map(norm), missing });
    if (missing.length) {
      await addError("Missing layers on map after multi-file upload", { missing, names });
      await takeScreenshot(this.page, "map-layers-missing");
    }
    if (missing.length) {
      throw new Error(
        `Map layer list missing: ${missing.join(", ")}. Present: ${names.join(" | ")}`
      );
    }
    logInfo("✅ All expected layers present on map", { names });
    return names;
  }

  /**
   * Multi-file: Zoom to each layer (product fitBounds) and draw a distinct
   * color highlight using geo bounds when available (moves with map until next redraw).
   * @param {string[]} [expectedFiles]
   */
  async highlightEachLayer(expectedFiles) {
    const colors = [
      "#FF6B00",
      "#00C2FF",
      "#A3E635",
      "#F472B6",
      "#FACC15",
      "#A78BFA",
    ];
    const results = [];
    const zoomBtns = this.page
      .locator("#layerList .layer-item .zoom-to-btn")
      .filter({ hasText: "Zoom" });
    const nameSpans = this.page.locator("#layerList .layer-item-name");
    const count = await nameSpans.count();

    for (let i = 0; i < count; i++) {
      const name = ((await nameSpans.nth(i).textContent()) || "").trim();
      const color = colors[i % colors.length];
      const id = `pw-raster-highlight-layer-${i}`;

      await showStep(
        this.page,
        `Zoom + highlight layer ${i + 1}/${count}: ${name}`,
        nameSpans.nth(i)
      );
      await highlight(this.page, nameSpans.nth(i), 200);

      if ((await zoomBtns.count()) > i) {
        await zoomBtns.nth(i).click({ force: true });
        await this.page.waitForTimeout(900);
      }

      // Product fitBounds → highlight only this layer's geo footprint
      const pixelState = await inspectRasterPixels(this.page, name);
      const drawn = await drawRasterHighlightBox(this.page, pixelState, {
        id,
        color,
      });
      await nameSpans.nth(i).evaluate(
        (el, c) => {
          el.style.outline = `2px solid ${c}`;
          el.style.boxShadow = `0 0 8px ${c}88`;
        },
        color
      );

      results.push({ name, color, highlight: drawn });
      logInfo(`✅ Layer highlighted: ${name}`, {
        color,
        mode: drawn.mode,
        boxDrawn: drawn.boxDrawn,
      });
      await this.page.waitForTimeout(500);
    }

    if (expectedFiles && expectedFiles.length) {
      await this.assertLayersPresent(expectedFiles);
    }
    return results;
  }

  /**
   * Read Leaflet map center / bounds from the live map instance on #map.
   * Falls back to FILE METADATA panel center rows if map instance is not found.
   */
  async getMapGeoState() {
    const fromLeaflet = await this.page.evaluate(() => {
      const el = document.getElementById("map") || document.querySelector(".leaflet-container");
      if (!el) return null;
      // Leaflet sometimes parks the Map on the container under a private key
      for (const key of Object.keys(el)) {
        try {
          const v = el[key];
          if (v && typeof v.getCenter === "function" && typeof v.getZoom === "function") {
            const c = v.getCenter();
            const b = typeof v.getBounds === "function" ? v.getBounds() : null;
            return {
              source: "leaflet",
              lat: c.lat,
              lng: c.lng,
              zoom: v.getZoom(),
              bounds: b
                ? {
                    south: b.getSouth(),
                    west: b.getWest(),
                    north: b.getNorth(),
                    east: b.getEast(),
                  }
                : null,
            };
          }
        } catch {
          /* continue */
        }
      }
      // Walk parent in case container is nested
      const container = document.querySelector(".leaflet-container");
      if (container && container !== el) {
        for (const key of Object.keys(container)) {
          try {
            const v = container[key];
            if (v && typeof v.getCenter === "function") {
              const c = v.getCenter();
              return { source: "leaflet-container", lat: c.lat, lng: c.lng, zoom: v.getZoom() };
            }
          } catch {
            /* continue */
          }
        }
      }
      return null;
    });

    if (fromLeaflet && Number.isFinite(fromLeaflet.lat) && Number.isFinite(fromLeaflet.lng)) {
      return fromLeaflet;
    }

    // Fallback: FILE METADATA panel — prefer Center section, then WGS84 bounds midpoint
    const panelText = await this.getMetadataPanelText().catch(() => "");
    // Avoid matching "Min Latitude" / "Max Latitude" — Center rows are plain "Latitude" / "Longitude"
    const centerLat =
      panelText.match(/(?:^|\n)\s*Latitude\s*\n?\s*([+-]?\d+\.?\d*)/i) ||
      panelText.match(/\bLatitude\s+([+-]?\d+\.\d{4,})/i);
    const centerLng =
      panelText.match(/(?:^|\n)\s*Longitude\s*\n?\s*([+-]?\d+\.?\d*)/i) ||
      panelText.match(/\bLongitude\s+([+-]?\d+\.\d{4,})/i);
    // Panel HTML is label/value on separate lines in meta-row — also try after "Center"
    const afterCenter = panelText.split(/Center/i)[1] || "";
    const cLat2 = afterCenter.match(/Latitude\s*([+-]?\d+\.?\d*)/i);
    const cLng2 = afterCenter.match(/Longitude\s*([+-]?\d+\.?\d*)/i);
    const latVal = cLat2 ? parseFloat(cLat2[1]) : centerLat ? parseFloat(centerLat[1]) : null;
    const lngVal = cLng2 ? parseFloat(cLng2[1]) : centerLng ? parseFloat(centerLng[1]) : null;
    if (Number.isFinite(latVal) && Number.isFinite(lngVal)) {
      // Reject SW-corner false positives when Min Lat was parsed as center
      const bounds = MapPage.parseBoundsFromPanelText(panelText);
      if (bounds) {
        const midLat = (bounds.minLat + bounds.maxLat) / 2;
        const midLng = (bounds.minLon + bounds.maxLon) / 2;
        // If parsed "center" is essentially the SW corner, use midpoint instead
        const nearSw =
          Math.abs(latVal - bounds.minLat) < 1e-5 &&
          Math.abs(lngVal - bounds.minLon) < 1e-5;
        if (nearSw) {
          return {
            source: "metadata-panel-bounds-mid",
            lat: midLat,
            lng: midLng,
            zoom: null,
            bounds: {
              south: bounds.minLat,
              west: bounds.minLon,
              north: bounds.maxLat,
              east: bounds.maxLon,
            },
            panelPreview: panelText.slice(0, 300),
          };
        }
      }
      return {
        source: "metadata-panel-center",
        lat: latVal,
        lng: lngVal,
        zoom: null,
        bounds: bounds
          ? {
              south: bounds.minLat,
              west: bounds.minLon,
              north: bounds.maxLat,
              east: bounds.maxLon,
            }
          : null,
        panelPreview: panelText.slice(0, 300),
      };
    }
    const boundsOnly = MapPage.parseBoundsFromPanelText(panelText);
    if (boundsOnly) {
      return {
        source: "metadata-panel-bounds-mid",
        lat: (boundsOnly.minLat + boundsOnly.maxLat) / 2,
        lng: (boundsOnly.minLon + boundsOnly.maxLon) / 2,
        zoom: null,
        bounds: {
          south: boundsOnly.minLat,
          west: boundsOnly.minLon,
          north: boundsOnly.maxLat,
          east: boundsOnly.maxLon,
        },
        panelPreview: panelText.slice(0, 300),
      };
    }
    return null;
  }

  /**
   * Assert the map is centered (or metadata center sits) near the expected
   * georeferenced location from popup metadata (e.g. Dewas lat/lon).
   *
   * @param {number} expectedLat
   * @param {number} expectedLng
   * @param {{ toleranceDeg?: number, openPanel?: boolean }} [opts]
   *   toleranceDeg default 1.0° (~110km) — tight enough to catch wrong continent,
   *   loose enough for map fitBounds padding / zoom framing.
   */
  async assertGeolocationNear(expectedLat, expectedLng, opts = {}) {
    const tolerance = opts.toleranceDeg ?? 1.0;
    await showStep(
      this.page,
      `Validate map geolocation near ${expectedLat}, ${expectedLng}`,
      this.mapContainer
    );

    if (opts.openPanel !== false) {
      await this.openMetadataPanel().catch(() => {});
    }

    const geo = await this.getMapGeoState();
    if (!geo) {
      await addError("Could not read map geolocation (Leaflet + panel)", {
        expectedLat,
        expectedLng,
      });
      await takeScreenshot(this.page, "geo-location-missing");
      throw new Error(
        `Map geolocation unavailable; expected ~(${expectedLat}, ${expectedLng})`
      );
    }

    const dLat = Math.abs(geo.lat - expectedLat);
    const dLng = Math.abs(geo.lng - expectedLng);
    logInfo("Map geolocation check", {
      expected: { lat: expectedLat, lng: expectedLng },
      actual: { lat: geo.lat, lng: geo.lng, source: geo.source, zoom: geo.zoom },
      delta: { dLat, dLng },
      toleranceDeg: tolerance,
    });

    if (dLat > tolerance || dLng > tolerance) {
      await addError("Raster not near expected geographic location", {
        expected: { lat: expectedLat, lng: expectedLng },
        actual: geo,
        dLat,
        dLng,
        tolerance,
      });
      await takeScreenshot(this.page, "geo-location-mismatch");
      throw new Error(
        `Map location off: expected (~${expectedLat}, ~${expectedLng}), ` +
          `got (${geo.lat}, ${geo.lng}) via ${geo.source} ` +
          `[Δlat=${dLat.toFixed(4)}, Δlng=${dLng.toFixed(4)}, tol=${tolerance}°]`
      );
    }

    await highlight(this.page, this.mapContainer, 400);
    logInfo(
      `✅ Map geolocation matches expected area (±${tolerance}°) via ${geo.source}`
    );
    return geo;
  }

  /**
   * Parse "lat, lng" from popup metadata Location field (e.g. "38.9063, -82.1563").
   */
  static parseLatLng(locationStr) {
    if (!locationStr) return null;
    const m = String(locationStr).match(/([+-]?\d+\.?\d*)\s*,\s*([+-]?\d+\.?\d*)/);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }

  /**
   * Parse WGS84 bounds from map FILE METADATA panel text
   * (Min/Max Latitude / Longitude rows produced by map.js buildMetaPanel).
   */
  static parseBoundsFromPanelText(panelText) {
    if (!panelText) return null;
    const t = String(panelText);
    const num = (re) => {
      const m = t.match(re);
      return m ? parseFloat(m[1]) : null;
    };
    const minLat = num(/Min\s*Latitude\s*([+-]?\d+\.?\d*)/i);
    const maxLat = num(/Max\s*Latitude\s*([+-]?\d+\.?\d*)/i);
    const minLon = num(/Min\s*Longitude\s*([+-]?\d+\.?\d*)/i);
    const maxLon = num(/Max\s*Longitude\s*([+-]?\d+\.?\d*)/i);
    if (
      [minLat, maxLat, minLon, maxLon].every((v) => Number.isFinite(v))
    ) {
      return { minLat, maxLat, minLon, maxLon };
    }
    return null;
  }

  /**
   * Read the live Leaflet ImageOverlay / TileLayer bounds for the uploaded raster.
   * Product places L.imageOverlay + BlobTileLayer using the backend georef bounds.
   *
   * Handles: LatLngBounds objects, raw [[s,w],[n,e]] arrays, map._layers, and
   * cases where HD tiles remain after the preview ImageOverlay is removed.
   */
  /**
   * Live Leaflet ImageOverlay / TileLayer bounds for the uploaded raster.
   * Product stores exact bounds on mapDataList in chrome.storage — prefer that
   * when the Map instance is not exposed on the DOM (common in packaged builds).
   */
  async getLeafletRasterBounds() {
    return this.page.evaluate(async () => {
      const normalizeBounds = (b) => {
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
            const s = Array.isArray(a) ? a[0] : a.lat ?? a.Latitude;
            const w = Array.isArray(a) ? a[1] : a.lng ?? a.lon ?? a.Longitude;
            const n = Array.isArray(c) ? c[0] : c.lat ?? c.Latitude;
            const e = Array.isArray(c) ? c[1] : c.lng ?? c.lon ?? c.Longitude;
            if ([s, w, n, e].every((v) => Number.isFinite(Number(v)))) {
              return {
                south: Number(s),
                west: Number(w),
                north: Number(n),
                east: Number(e),
              };
            }
          }
          if (typeof b === "object") {
            const south = b.south ?? b.minLat ?? b._southWest?.lat;
            const west = b.west ?? b.minLon ?? b._southWest?.lng;
            const north = b.north ?? b.maxLat ?? b._northEast?.lat;
            const east = b.east ?? b.maxLon ?? b._northEast?.lng;
            if ([south, west, north, east].every((v) => Number.isFinite(Number(v)))) {
              return {
                south: Number(south),
                west: Number(west),
                north: Number(north),
                east: Number(east),
              };
            }
          }
        } catch {
          /* ignore */
        }
        return null;
      };

      const toCandidate = (n, kind) => {
        if (!n) return null;
        const latSpan = Math.abs(n.north - n.south);
        const lonSpan = Math.abs(n.east - n.west);
        if (latSpan > 80 || lonSpan > 160) return null;
        if (latSpan < 1e-8 && lonSpan < 1e-8) return null;
        return {
          ...n,
          latSpan,
          lonSpan,
          centerLat: (n.south + n.north) / 2,
          centerLng: (n.west + n.east) / 2,
          kind,
        };
      };

      const candidates = [];

      // 1) Product truth: chrome.storage.local.mapDataList (always available on map.html)
      try {
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
        for (const it of list) {
          const n = normalizeBounds(it.bounds);
          const c = toCandidate(n, "mapDataList");
          if (c) {
            c.filename = it.filename || it.name || null;
            candidates.push(c);
          }
        }
      } catch {
        /* storage unavailable */
      }

      // 2) Live Leaflet layers when Map instance is discoverable
      const isLeafletMap = (v) => {
        try {
          return (
            v &&
            typeof v.getCenter === "function" &&
            typeof v.latLngToContainerPoint === "function" &&
            (typeof v.eachLayer === "function" || v._layers)
          );
        } catch {
          return false;
        }
      };
      const findMap = () => {
        const nodes = [
          document.getElementById("map"),
          document.querySelector(".leaflet-container"),
          document.querySelector(".leaflet-map-pane"),
          document.querySelector(".leaflet-tile-pane"),
        ].filter(Boolean);
        for (const node of nodes) {
          const keys = [
            ...Object.keys(node),
            ...Object.getOwnPropertyNames(node),
          ];
          for (const key of keys) {
            try {
              if (isLeafletMap(node[key])) return node[key];
            } catch {
              /* continue */
            }
          }
          let p = node.parentElement;
          for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
            for (const key of [
              ...Object.keys(p),
              ...Object.getOwnPropertyNames(p),
            ]) {
              try {
                if (isLeafletMap(p[key])) return p[key];
              } catch {
                /* continue */
              }
            }
          }
        }
        return null;
      };

      const mapInst = findMap();
      if (mapInst) {
        const layers = [];
        if (typeof mapInst.eachLayer === "function") {
          mapInst.eachLayer((layer) => layers.push(layer));
        } else if (mapInst._layers) {
          for (const id of Object.keys(mapInst._layers)) {
            layers.push(mapInst._layers[id]);
          }
        }
        for (const layer of layers) {
          try {
            if (typeof layer.getBounds === "function") {
              const c = toCandidate(normalizeBounds(layer.getBounds()), "getBounds");
              if (c) candidates.push(c);
            }
            if (layer.options && layer.options.bounds) {
              const c = toCandidate(
                normalizeBounds(layer.options.bounds),
                "options.bounds"
              );
              if (c) candidates.push(c);
            }
            if (layer._bounds) {
              const c = toCandidate(normalizeBounds(layer._bounds), "_bounds");
              if (c) candidates.push(c);
            }
          } catch {
            /* skip */
          }
        }
      }

      if (!candidates.length) {
        return null;
      }

      // Prefer smallest non-basemap footprint (actual raster)
      candidates.sort((a, b) => a.latSpan * a.lonSpan - b.latSpan * b.lonSpan);
      const best = candidates[0];
      return {
        south: best.south,
        west: best.west,
        north: best.north,
        east: best.east,
        centerLat: best.centerLat,
        centerLng: best.centerLng,
        kind: best.kind,
        filename: best.filename || null,
        _debug: {
          mapFound: Boolean(mapInst),
          candidateCount: candidates.length,
          kinds: candidates.map((c) => c.kind),
        },
      };
    });
  }

  async getFullGeoSnapshot(opts = {}) {
    if (opts.openPanel !== false) {
      await this.openMetadataPanel().catch(() => {});
    }
    const mapGeo = await this.getMapGeoState();
    const panelText = await this.getMetadataPanelText().catch(() => "");
    const panelBounds = MapPage.parseBoundsFromPanelText(panelText);
    let layerBounds = await this.getLeafletRasterBounds();
    // Only keep real geo extents (storage or Leaflet), not debug-only objects
    if (
      !layerBounds ||
      !Number.isFinite(layerBounds.centerLat) ||
      !Number.isFinite(layerBounds.south)
    ) {
      layerBounds = null;
    }

    let center = null;
    if (layerBounds) {
      center = {
        lat: layerBounds.centerLat,
        lng: layerBounds.centerLng,
        source: layerBounds.kind === "mapDataList" ? "mapDataList" : "leaflet-layer",
      };
    } else if (mapGeo && Number.isFinite(mapGeo.lat)) {
      center = { lat: mapGeo.lat, lng: mapGeo.lng, source: mapGeo.source };
    } else if (panelBounds) {
      center = {
        lat: (panelBounds.minLat + panelBounds.maxLat) / 2,
        lng: (panelBounds.minLon + panelBounds.maxLon) / 2,
        source: "panel-bounds-mid",
      };
    }

    return {
      center,
      mapGeo,
      panelBounds,
      layerBounds,
      panelPreview: (panelText || "").slice(0, 400),
    };
  }

  /**
   * Strong validation: uploaded raster is mapped to the correct geographic location.
   *
   * Checks (when data is available):
   *  1. Map center / metadata center near expected lat/lng
   *  2. Live Leaflet layer bounds center near expected
   *  3. Optional expected bounds (min/max lat/lon) vs panel + layer bounds
   *
   * @param {{ lat: number, lng: number }} expectedCenter
   * @param {{ minLat?: number, maxLat?: number, minLon?: number, maxLon?: number } | null} [expectedBounds]
   * @param {{ toleranceDeg?: number, boundsToleranceDeg?: number, openPanel?: boolean }} [opts]
   */
  async assertRasterMappedCorrectly(expectedCenter, expectedBounds = null, opts = {}) {
    const tol = opts.toleranceDeg ?? 1.0;
    const bTol = opts.boundsToleranceDeg ?? 0.5;

    await showStep(
      this.page,
      `Validate raster mapped at (${expectedCenter.lat}, ${expectedCenter.lng})`,
      this.mapContainer
    );

    const snap = await this.getFullGeoSnapshot({ openPanel: opts.openPanel !== false });
    logInfo("Full geo snapshot", {
      expectedCenter,
      expectedBounds,
      snap: {
        center: snap.center,
        panelBounds: snap.panelBounds,
        layerBounds: snap.layerBounds
          ? {
              south: snap.layerBounds.south,
              west: snap.layerBounds.west,
              north: snap.layerBounds.north,
              east: snap.layerBounds.east,
              kind: snap.layerBounds.kind,
            }
          : null,
      },
    });

    if (!snap.center) {
      await addError("Could not obtain any geo center (map / panel / layer)", {
        expectedCenter,
      });
      await takeScreenshot(this.page, "geo-snapshot-missing");
      throw new Error(
        `Raster mapping check failed: no geo center readable; expected (~${expectedCenter.lat}, ~${expectedCenter.lng})`
      );
    }

    const dLat = Math.abs(snap.center.lat - expectedCenter.lat);
    const dLng = Math.abs(snap.center.lng - expectedCenter.lng);
    if (dLat > tol || dLng > tol) {
      await addError("Raster center not near expected geographic location", {
        expectedCenter,
        actual: snap.center,
        dLat,
        dLng,
        tol,
      });
      await takeScreenshot(this.page, "geo-center-mismatch");
      throw new Error(
        `Raster mapped off-location: expected (~${expectedCenter.lat}, ~${expectedCenter.lng}), ` +
          `got (${snap.center.lat}, ${snap.center.lng}) via ${snap.center.source} ` +
          `[Δlat=${dLat.toFixed(4)}, Δlng=${dLng.toFixed(4)}, tol=${tol}°]`
      );
    }

    // Expected center must fall inside (or very near) the georef WGS84 bounds from panel
    if (snap.panelBounds) {
      const pb = snap.panelBounds;
      const pad = opts.boundsContainPadDeg ?? 0.05;
      const inside =
        expectedCenter.lat >= pb.minLat - pad &&
        expectedCenter.lat <= pb.maxLat + pad &&
        expectedCenter.lng >= pb.minLon - pad &&
        expectedCenter.lng <= pb.maxLon + pad;
      if (!inside) {
        await addError("Expected location is outside panel WGS84 bounds — wrong mapping", {
          expectedCenter,
          panelBounds: pb,
          pad,
        });
        await takeScreenshot(this.page, "geo-outside-panel-bounds");
        throw new Error(
          `Expected (${expectedCenter.lat}, ${expectedCenter.lng}) is outside map WGS84 bounds ` +
            `[${pb.minLat}..${pb.maxLat}, ${pb.minLon}..${pb.maxLon}]`
        );
      }
      const midLat = (pb.minLat + pb.maxLat) / 2;
      const midLng = (pb.minLon + pb.maxLon) / 2;
      logInfo("✅ Expected location lies inside panel WGS84 bounds", {
        panelBounds: pb,
        boundsMid: { lat: midLat, lng: midLng },
      });
    }

    // Layer bounds center must also sit near expected (proves overlay placement)
    if (snap.layerBounds) {
      const lb = snap.layerBounds;
      const ldLat = Math.abs(lb.centerLat - expectedCenter.lat);
      const ldLng = Math.abs(lb.centerLng - expectedCenter.lng);
      if (ldLat > tol || ldLng > tol) {
        await addError("Leaflet layer bounds center off expected location", {
          expectedCenter,
          layerCenter: { lat: lb.centerLat, lng: lb.centerLng },
          ldLat,
          ldLng,
        });
        await takeScreenshot(this.page, "geo-layer-bounds-mismatch");
        throw new Error(
          `Leaflet raster layer not at expected location: layer center (${lb.centerLat}, ${lb.centerLng}) ` +
            `vs expected (${expectedCenter.lat}, ${expectedCenter.lng})`
        );
      }
      logInfo("✅ Leaflet layer bounds center matches expected area", {
        layerKind: lb.kind,
        center: { lat: lb.centerLat, lng: lb.centerLng },
      });
    } else if (snap.panelBounds) {
      // Soft info only — panel WGS84 bounds are product truth when storage/Leaflet
      // map instance is not exposed (still validates placement via panel center).
      logInfo(
        "Layer geo from FILE METADATA panel (mapDataList/Leaflet instance not required)",
        { expectedCenter, panelBounds: snap.panelBounds, center: snap.center }
      );
    } else {
      await addWarning("No layer bounds and no panel WGS84 bounds available", {
        expectedCenter,
      });
    }

    if (expectedBounds && snap.panelBounds) {
      const pb = snap.panelBounds;
      const checks = [
        ["minLat", pb.minLat, expectedBounds.minLat],
        ["maxLat", pb.maxLat, expectedBounds.maxLat],
        ["minLon", pb.minLon, expectedBounds.minLon],
        ["maxLon", pb.maxLon, expectedBounds.maxLon],
      ];
      for (const [name, actual, expected] of checks) {
        if (!Number.isFinite(expected) || !Number.isFinite(actual)) continue;
        const d = Math.abs(actual - expected);
        if (d > bTol) {
          await addError(`Panel bounds ${name} mismatch`, { actual, expected, d, bTol });
          throw new Error(
            `Panel bounds ${name} off: expected ${expected}, got ${actual} (Δ=${d.toFixed(5)}, tol=${bTol}°)`
          );
        }
      }
      logInfo("✅ Metadata panel bounds match expected", { panelBounds: pb, expectedBounds });
    }

    if (expectedBounds && snap.layerBounds) {
      const lb = snap.layerBounds;
      const pairs = [
        ["south/minLat", lb.south, expectedBounds.minLat],
        ["north/maxLat", lb.north, expectedBounds.maxLat],
        ["west/minLon", lb.west, expectedBounds.minLon],
        ["east/maxLon", lb.east, expectedBounds.maxLon],
      ];
      for (const [name, actual, expected] of pairs) {
        if (!Number.isFinite(expected) || !Number.isFinite(actual)) continue;
        const d = Math.abs(actual - expected);
        if (d > bTol) {
          await addError(`Leaflet layer bounds ${name} mismatch`, { actual, expected, d, bTol });
          throw new Error(
            `Leaflet layer bounds ${name} off: expected ${expected}, got ${actual} (Δ=${d.toFixed(5)}, tol=${bTol}°)`
          );
        }
      }
      logInfo("✅ Leaflet layer bounds match expected georef bounds", {
        layer: { south: lb.south, west: lb.west, north: lb.north, east: lb.east },
        expectedBounds,
      });
    }

    await highlight(this.page, this.mapContainer, 400);
    logInfo(
      `✅ Raster correctly mapped on map (±${tol}° center` +
        (expectedBounds ? `, ±${bTol}° bounds` : "") +
        `)`
    );
    return snap;
  }

  /**
   * Compare two geo snapshots: deltas used by rotation / shift tests.
   */
  static compareGeoSnapshots(baseline, current) {
    const out = {
      centerDeltaLat: null,
      centerDeltaLng: null,
      centerDistanceDeg: null,
      boundsShifted: false,
      boundsDelta: null,
      layerAspectBaseline: null,
      layerAspectCurrent: null,
      aspectRatioChanged: false,
    };
    if (baseline?.center && current?.center) {
      out.centerDeltaLat = current.center.lat - baseline.center.lat;
      out.centerDeltaLng = current.center.lng - baseline.center.lng;
      out.centerDistanceDeg = Math.hypot(out.centerDeltaLat, out.centerDeltaLng);
    }
    const bb = baseline?.layerBounds || baseline?.panelBounds;
    const cb = current?.layerBounds || current?.panelBounds;
    if (bb && cb) {
      const bMinLat = bb.minLat ?? bb.south;
      const bMaxLat = bb.maxLat ?? bb.north;
      const bMinLon = bb.minLon ?? bb.west;
      const bMaxLon = bb.maxLon ?? bb.east;
      const cMinLat = cb.minLat ?? cb.south;
      const cMaxLat = cb.maxLat ?? cb.north;
      const cMinLon = cb.minLon ?? cb.west;
      const cMaxLon = cb.maxLon ?? cb.east;
      out.boundsDelta = {
        minLat: cMinLat - bMinLat,
        maxLat: cMaxLat - bMaxLat,
        minLon: cMinLon - bMinLon,
        maxLon: cMaxLon - bMaxLon,
      };
      out.boundsShifted = Object.values(out.boundsDelta).some((d) => Math.abs(d) > 1e-5);

      const bLatSpan = Math.abs(bMaxLat - bMinLat) || 1e-9;
      const bLonSpan = Math.abs(bMaxLon - bMinLon) || 1e-9;
      const cLatSpan = Math.abs(cMaxLat - cMinLat) || 1e-9;
      const cLonSpan = Math.abs(cMaxLon - cMinLon) || 1e-9;
      out.layerAspectBaseline = bLonSpan / bLatSpan;
      out.layerAspectCurrent = cLonSpan / cLatSpan;
      out.aspectRatioChanged =
        Math.abs(out.layerAspectCurrent - out.layerAspectBaseline) /
          out.layerAspectBaseline >
        0.02;
    }
    return out;
  }

  async ensureControlCardVisible() {
    await showStep(
      this.page,
      "Ensure left control card is visible",
      this.mapOverlayCard
    );
    // Undo any accidental map z-index / opacity that could cover the card
    await this.page.evaluate(() => {
      const map = document.getElementById("map");
      if (map) {
        map.style.zIndex = "";
        map.style.outline = map.__pwPrevOutline || "";
        map.style.boxShadow = map.__pwPrevShadow || "";
      }
      const card = document.querySelector(".map-overlay-card");
      if (card) {
        card.style.display = "";
        card.style.visibility = "visible";
        card.style.opacity = "1";
        card.style.zIndex = "2000";
      }
    });
    await expect(this.mapOverlayCard).toBeVisible({ timeout: 10_000 });
    await highlight(this.page, this.mapOverlayCard, 400);
    logInfo("✅ Left control card (.map-overlay-card) visible");
  }

  async openMetadataPanel() {
    await this.ensureControlCardVisible();

    await showStep(
      this.page,
      "Open map FILE METADATA (SHOW METADATA / layer name)",
      this.metaToggleBtn
    );

    // Product builds panel content on layer name click; toggle removes .hidden
    const layerName = this.layerName.first();
    if (await layerName.count()) {
      await highlight(this.page, layerName, 250);
      await layerName.click({ force: true });
      logInfo("Clicked layer filename to open metadata");
    }

    // Always also use SHOW METADATA if panel still hidden
    const stillHidden = await this.metaPanel.evaluate(
      (el) => el.classList.contains("hidden")
    );
    if (stillHidden) {
      await highlight(this.page, this.metaToggleBtn, 250);
      await this.metaToggleBtn.click({ force: true });
      // Direct class toggle fallback if click was swallowed
      await this.page.evaluate(() => {
        const panel = document.getElementById("metaPanel");
        const btn = document.getElementById("metaToggleBtn");
        if (panel && panel.classList.contains("hidden")) {
          panel.classList.remove("hidden");
          if (btn) btn.textContent = "Hide Metadata";
        }
      });
      logInfo("SHOW METADATA force-open applied");
    }

    await expect(this.metaPanel).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => {
        const cls = (await this.metaPanel.getAttribute("class")) || "";
        return !/\bhidden\b/.test(cls);
      }, { timeout: 10_000 })
      .toBeTruthy();

    await highlight(this.page, this.metaPanel, 500);
    logInfo("✅ FILE METADATA panel open");

    // Layout shift: metadata panel resizes the map — resync or redraw geo highlight
    await this.page.waitForTimeout(300);
    await this.refreshRasterHighlight();
  }

  /**
   * Recompute / resync the orange raster box after pan, zoom, or layout changes
   * (FILE METADATA open/close). Prefers geo-locked Leaflet rectangle.
   */
  async refreshRasterHighlight(filename = null) {
    await this.page
      .evaluate(() => {
        const mapEl = document.getElementById("map");
        if (mapEl && typeof mapEl.__pwResyncHighlight === "function") {
          mapEl.__pwResyncHighlight();
          return true;
        }
        return false;
      })
      .catch(() => false);

    // Always redraw from current inspect so mode stays leaflet-geo-rect when possible
    const pixels = await this._inspectRasterPixels();
    let highlighted = null;
    if (pixels && pixels.rendered) {
      highlighted = await this._drawRasterHighlightBox(pixels);
    } else if (filename) {
      highlighted = await highlightRasterRegion(this.page, { filename, holdMs: 0 });
    }
    if (highlighted && !highlighted.boxDrawn) {
      const diagnostics = await this.getRenderDiagnostics().catch(() => ({}));
      await addError("Raster highlight redraw failed", { filename, highlighted, diagnostics });
      await takeScreenshot(this.page, "raster-highlight-redraw-failed");
      throw new Error(`Raster highlight redraw failed: ${JSON.stringify({ filename, highlighted, diagnostics })}`);
    }
    return highlighted;
  }

  async closeMetadataPanel() {
    await showStep(this.page, "Close FILE METADATA panel", this.metaCloseBtn);
    if (await this.metaCloseBtn.isVisible().catch(() => false)) {
      await this.metaCloseBtn.click({ force: true });
    } else {
      const text = ((await this.metaToggleBtn.textContent()) || "").trim();
      if (/hide metadata/i.test(text)) await this.metaToggleBtn.click({ force: true });
    }
    await expect(this.metaPanel)
      .toHaveClass(/hidden/, { timeout: 5_000 })
      .catch(async () => {
        await expect(this.metaPanel).toBeHidden();
      });
    // Map expands again — resync highlight to raster
    await this.page.waitForTimeout(300);
    await this.refreshRasterHighlight();
  }

  async getMetadataPanelText() {
    await this.openMetadataPanel();
    return (await this.metaPanelBody.innerText()).trim();
  }

  async assertMapMetadata(options = {}) {
    const requiredFragments = options.requiredFragments || [
      "FILE NAME",
      "FORMAT",
    ];
    await this.openMetadataPanel();
    await highlight(this.page, this.metaPanelBody, 500);

    const text = ((await this.metaPanelBody.innerText()) || "").trim();
    logInfo("Map FILE METADATA body", { preview: text.slice(0, 400) });

    if (!text || /no metadata available/i.test(text)) {
      await addError("Map metadata panel empty");
      await takeScreenshot(this.page, "map-metadata-empty");
      throw new Error("Map FILE METADATA panel is empty");
    }

    for (const frag of requiredFragments) {
      expect(
        text.toUpperCase().includes(frag.toUpperCase()),
        `Expected map metadata to include "${frag}". Got:\n${text.slice(0, 500)}`
      ).toBeTruthy();
    }

    const soft = [
      "EPSG",
      "IMAGE SIZE",
      "WGS84",
      "BOUNDS",
      "LATITUDE",
      "LONGITUDE",
    ];
    const foundSoft = soft.filter((s) => text.toUpperCase().includes(s));
    logInfo("✅ Map metadata validated", {
      requiredOk: requiredFragments,
      softFound: foundSoft,
    });
    return text;
  }

  async setOverlayOpacity(percent) {
    await showStep(
      this.page,
      `Set overlay opacity to ${percent}%`,
      this.opacityRange,
      () => this.opacityRange.fill(String(percent))
    );
  }

  async getRenderDiagnostics() {
    return this.page.evaluate(() => {
      const mapEl = document.getElementById("map");
      const leaflet = document.querySelector(".leaflet-container");

      const overlays = Array.from(
        document.querySelectorAll(
          "img.leaflet-image-layer, .leaflet-overlay-pane img"
        )
      ).filter(
        (i) =>
          i.complete &&
          i.naturalWidth > 32 &&
          i.naturalHeight > 32 &&
          !i.classList.contains("leaflet-tile")
      );

      // HD georef tiles — /tile/ backend, crisp-image, or non-basemap blobs
      const hdTiles = Array.from(
        document.querySelectorAll(
          ".leaflet-tile-pane img, .leaflet-layer img, img.leaflet-tile, img.crisp-image"
        )
      ).filter((i) => {
        if (!i.complete || i.naturalWidth < 1) return false;
        const src = i.currentSrc || i.src || "";
        const cls = i.className || "";
        return (
          /\/tile\//i.test(src) ||
          /preview_image/i.test(src) ||
          /crisp-image/i.test(cls) ||
          (/^(blob:|chrome-extension:|http:\/\/127\.0\.0\.1|http:\/\/localhost)/i.test(
            src
          ) &&
            !/basemaps|cartocdn|openstreetmap/i.test(src))
        );
      });

      const basemapTiles = Array.from(
        document.querySelectorAll("img.leaflet-tile:not(.crisp-image)")
      ).filter((i) => i.complete && i.naturalWidth > 0);

      const layerItems = document.querySelectorAll(
        "#layerList .layer-item, #layerList .layer-item-name"
      );

      const hdText =
        document.querySelector("#hdStatus")?.textContent || "";

      return {
        mapPresent: !!mapEl,
        leafletPresent: !!leaflet,
        overlayCount: overlays.length,
        overlaySizes: overlays.slice(0, 5).map((i) => ({
          w: i.naturalWidth,
          h: i.naturalHeight,
        })),
        hdTileCount: hdTiles.length,
        tileCount: basemapTiles.length,
        layerItemCount: layerItems.length,
        layerNames: Array.from(layerItems)
          .slice(0, 5)
          .map((el) => (el.textContent || "").trim()),
        hdActive: /HD\s*ACTIVE/i.test(hdText),
        hdStatus: hdText || null,
        loadedImageCount: overlays.length + hdTiles.length,
        url: location.href,
      };
    });
  }
}
