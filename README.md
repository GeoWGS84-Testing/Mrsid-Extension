# MrSID Viewer — Playwright POM Automation (V1.8)

Page-Object-Model suite aligned with **GeoViewer_Test_Cases_visual.xlsx** and your
on-disk `test-data/` layout.

## Quick start

```bash
cd mrsid-viewer-tests
npm install
npx playwright install chromium

# Smoke (needs backend + any small valid raster)
npm run test:smoke

# Client-side rejection only (no backend)
npx playwright test tests/03-popup.upload.invalid.spec.js

# GIS edge cases
npx playwright test tests/06-gis.edge.spec.js

# Large 1–1.5 GB (opt-in, 30 min timeout)
npx playwright test --grep @large-file
```

## Layout

```
pages/PopupPage.js          popup.html POM
pages/MapPage.js            map.html POM
fixtures/extension.js       Chromium + extension load
fixtures/testData.js        TD-xx paths (matches your Explorer names)
tests/
  01-popup.ready.spec.js           GV-TC-001-*
  02-popup.upload.valid.spec.js    GV-TC-003-*, 002-01, 010-01
  03-popup.upload.invalid.spec.js  GV-TC-004-*, 005-04, 009-*
  04-map.render.spec.js            GV-TC-002-01 map, 011, 012, 013
  05-popup.ui.controls.spec.js     GV-TC-010-02, 008-07
  06-gis.edge.spec.js              GV-TC-006-03..07
  07-boundary.names.spec.js        GV-TC-008-05/06
  08-large.file.spec.js            GV-TC-006-08, 014-02  (@large-file)
test-data/
  valid/    invalid/  corrupt/  boundary/  gis/  negative/
```

## Test data mapping (Excel TD-ID → your files)

| TD-ID | Path used by automation |
|-------|-------------------------|
| TD-01 | `valid/01_NAIP_2014_WGS84.sid` (fallback: `NAIP_2014_WGS84_EPSG4326.sid`) |
| TD-03 | `valid/02_NAIP_2014_WGS84.tif` / `Valid_GeoTIF.tif` / osgeo samples |
| TD-04 | `valid/Valid_GeoTIFF.tiff` |
| TD-05 | `valid/large_1GB_MrSID.sid` or `large_1.3GB_MrSID_alaska_eox_007of016.sid` |
| TD-06 | `invalid/non_georeferenced.tif` / `.tiff` |
| TD-07 | `invalid/non_georeferenced.sid` |
| TD-08 | `corrupt/corrupt.sid` + `corrupt.tif` |
| TD-09 | `boundary/empty.tif` |
| TD-10 | `boundary/tiny.sid` |
| TD-11 | `negative/fake.{gif,jpg,png,pdf,txt,zip}` |
| TD-11b | `negative/rasterfile` |
| TD-12 | `boundary/VALID_UPPER_MrSID_Extension.SID` / `.TIF` |
| TD-13 | `negative/image.sid.txt`, `image.tif.exe`, `image.txt.tif` |
| TD-14 | unicode names under `boundary/` (auto-discovered) |
| TD-15 | `boundary/file with spaces.tif`, `file_with_spaces_hash_amp_pct_plus.tif` |
| TD-16 | `boundary/folder_a/shared_name.tif` + `folder_b/shared_name.tif` |
| TD-17 | `gis/antimeridian_pacific.tif` / `antimeridian_west.tif` |
| TD-18 | `gis/sw_hemisphere_satellite.tif` |
| TD-19 | `gis/tiny_metres_raster.tif` |
| TD-20 | `gis/rotated_naip_satellite.tif` |
| TD-21 | `valid/01_multi_file_set_{0_0.tif,1_1.sid,2_0.tif}` |

Missing files → dependent tests **skip** (not fail).

## Implemented vs Excel

| Excel ID | Status |
|----------|--------|
| GV-TC-001-01/03/04 | Automated |
| GV-TC-002-01 (map empty + full flow) | Automated |
| GV-TC-003-01/02/03/05 | Automated |
| GV-TC-004-01/02/03 | Automated |
| GV-TC-005-04 | Automated |
| GV-TC-006-03..08 | Automated (08 = @large-file) |
| GV-TC-008-05/06/07 | Automated |
| GV-TC-009-01..04 | Automated |
| GV-TC-010-01/02 | Automated |
| GV-TC-011/012/013 | Automated |
| GV-TC-014-02 | Automated (@large-file) |
| Settings / API / a11y / security / perf | Planned — say which to add next |

## Backend

Default host permission: `https://api.geowgs84.com`.  
Happy-path upload/map tests need a reachable GeoViewer backend.  
Client-side rejection tests (03-*) do **not**.

## GitHub Actions

The workflow at `.github/workflows/playwright.yml` runs the
`chromium-extension` project in eight shards. It downloads the provided
GeoTIFF fixtures from Google Drive; the three large fixtures are downloaded
only when `run_large_file_tests` is enabled. Large raster files are not
committed to Git.

These MrSID fixtures have no Drive IDs yet, so their dependent tests skip in a
clean CI checkout until IDs are added:

- `valid/01_NAIP_2014_WGS84.sid`
- `valid/NAIP_2014_WGS84_EPSG4326.sid`
- `valid/01_multi_file_set_1_1.sid`
- `invalid/non_georeferenced.sid`
- `corrupt/corrupt.sid`
- `boundary/tiny.sid`
- `boundary/VALID_UPPER_MrSID_Extension.SID`

Add available IDs as a JSON object in the repository variable
`GEOVIEWER_EXTRA_FIXTURE_IDS`, keyed by paths relative to `test-data/`, for
example `{"valid/01_NAIP_2014_WGS84.sid":"DRIVE_FILE_ID"}`.

## Primary flow steps (POM)

```
popupPage.open()
popupPage.assertIdleState()
popupPage.uploadFiles(path)
popupPage.waitForExtractingPhase()      // optional race
popupPage.waitForProcessingComplete()
popupPage.assertPreviewVisible()
popupPage.assertMetadataPresent([...])
mapTab = await popupPage.clickViewOnMap()
mapPage = new MapPage(mapTab, extensionId)
mapPage.waitForMapReady()
mapPage.waitForRasterRendered()
```

## Notes

- Extension opens as a **full tab** (`chrome.action.onClicked` → `popup.html`).
- Workers = 1 (extension-safe).
- Large files only 1–1.5 GB; not downloaded in normal CI.
- Visual status-bar helpers from the Excel "Visual Automation Spec" are optional;
  current suite is functional-first POM. Ask if you want the orange highlight
  + status bar layer added on top.

## Troubleshooting: service worker timeout

```
TimeoutError: browserContext.waitForEvent: Timeout ... "serviceworker"
```

**Cause:** Chromium did not start the MV3 extension service worker.

**Fix (Windows):**

1. Always run **headed** (default now):
   ```bash
   npm run test:smoke
   # equivalent to: set HEADLESS=false && npx playwright test --grep @smoke
   ```
2. Confirm `./extension/manifest.json` exists next to `package.json`.
3. Optional — use installed Google Chrome:
   ```bash
   set USE_SYSTEM_CHROME=true
   npm run test:smoke
   ```
4. Reinstall Chromium for Playwright:
   ```bash
   npx playwright install chromium
   ```

Do **not** use `HEADLESS=true` for extension tests on Windows unless you have verified SW starts.
