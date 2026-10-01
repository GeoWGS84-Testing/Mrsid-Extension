# Playwright CI Engineering Report

## Executive Summary

The all-zero shard summary was caused by the workflow deriving test counts from a custom `[DIAG-DEBUG]` console record that the suite never emitted. Empty parsed records were summed to zero and treated as a pass. Separately, artifact uploads ignored missing files, and the report aggregation substituted numeric zeroes for missing shard data.

The workflow now uses Playwright JSON/JUnit results, emits per-shard HTML/blob reports, packages all shard outputs under `playwright-results-shard-N`, verifies all eight artifacts, and fails empty or all-skipped shards. Processing and upload failures are reported as failures rather than delayed skips. Structured diagnostics include browser, network, application, extension, and memory events.

## Root Cause Table

| Issue | Root Cause / Evidence | File / Function | Fix | Priority |
|---|---|---|---|---|
| Shard counts were all zero | Workflow regex expected `[DIAG-DEBUG]`; no producer existed. Empty records became zero counts and `passed`. | `.github/workflows/playwright.yml`, old Generate shard metrics step | Derive counts from `results.json`; fail when executed test count is zero. | P0 |
| Missing reports looked successful | Upload steps used `if-no-files-found: ignore`; aggregator filled missing rows with zeroes. | `.github/workflows/playwright.yml`, shard uploads/dashboard | Mandatory per-shard bundle; enumerate shards 1-8 and report `Missing shard test artifact`; fail the dashboard. | P0 |
| No JSON/JUnit source of truth | Config emitted list/HTML and CI blob only. | `playwright.config.js` | Enable JSON and JUnit on every run; HTML per shard; blob in CI. | P0 |
| Large GeoTIFF became a skip | `Chunk 0 failed after 3 retries` was treated as ongoing processing; after 30 minutes the helper skipped the test. | `pages/PopupPage.js`, processing wait; `extension/popup.js`, chunk retry | Detect terminal chunk errors immediately, preserve HTTP status/body, and fail real timeouts. | P0 |
| Multi-file run waited 30 minutes | Chunk failure was not terminal to the test helper; extension continued later files after a failed upload. | `pages/PopupPage.js`, `waitForMultiFileComplete`; `extension/popup.js`, `processFiles` | Detect failed chunks, stop the file loop at the first failed file, and use bounded condition polling. | P1 |
| Georeferencing assertion was flaky | First run received a chunk transport failure instead of the expected georeferencing response; retry returned the expected product error. | `pages/PopupPage.js`, `waitForErrorStatus` | Wait for expected text or a terminal contradictory error, then fail immediately with both values. | P1 |
| Large-file preview intermittently empty | 1 GB MrSID analysis completed, but first attempt's preview had `naturalWidth=0`; retry produced a 1024x763 preview. | `extension/popup.js`, preview request | Validate HTTP response and non-empty preview body; surface preview generation as an error. | P1 |
| Map highlight failures could be swallowed | GIS flow ignored `refreshRasterHighlight` errors and the page object discarded its draw result. | `tests/06-gis.edge.spec.js`; `pages/MapPage.js` | Return draw result; fail with screenshot and render/coordinate diagnostics if a rendered raster cannot be outlined. | P1 |
| Diagnostics reported false zeroes | No page/extension console, pageerror, failed request, HTTP error, or app diagnostic stream fed the summary. | `fixtures/extension.js`; `utils/helpers.js` | Persist timestamped per-shard diagnostic records and count warning/error severities from those files. | P1 |
| Extension config generated noisy errors | Popup/map fetched `chrome-extension://.../.env`, which did not exist in the extension directory; it fell back to a default. | `extension/.env`; popup/map initialization | Add the expected non-secret default backend URL resource. | P2 |

## Result Data Flow

```text
Playwright tests
  -> JSON + JUnit + HTML + CI blob reporters
  -> test-results/, playwright-report/, blob-report/, diagnostics/shard-NN.json
  -> mandatory playwright-results-shard-N artifact
  -> dashboard downloads playwright-results-shard-* (no merge collisions)
  -> validates all eight shard metrics and required reports
  -> merges blob reports into the consolidated HTML report
  -> writes per-shard and overall GitHub summaries
```

The exact point where counts were lost was the old `Generate shard metrics` workflow step: it parsed only `[DIAG-DEBUG]` lines rather than Playwright's result output. The log did contain normal Playwright lines such as `6 passed`, `1 skipped`, and retry results, but those were not used by the counter.

## Log-Based Failure Analysis

The supplied log lists 55 tests over eight shards: 50 final passes, 4 flaky tests that passed on retry, 1 skipped test, and no final unrecovered failures. This is not equivalent to the old summary's all-zero result.

- Large rasters: the 1 GB MrSID test initially failed because the preview image was empty after processing, then passed on retry. The 1.3 GB MrSID and 1.69 GB GeoTIFF cases completed in that run. A GeoTIFF upload separately reported `Chunk 0 failed after 3 retries`; the old helper waited 30 minutes and marked it skipped.
- Multi-file: files were processed sequentially. A chunk failure on the third file left the completion status unset, so the helper timed out after 30 minutes. Retry runs processed all three files and rendered three map layers.
- Georeferencing: the first non-georeferenced TIFF attempt surfaced a chunk failure, not a georeferencing error; retry returned the expected `does not contain georeferencing metadata` message.
- Map/CRS: the supplied west/east antimeridian and multi-file map runs drew highlights and passed center/bounds checks. No CRS conversion defect is demonstrated by these logs. The local antimeridian flow also passes with the new mandatory highlight assertion.
- Memory: the supplied log contains no browser memory, worker-crash, or process-heap telemetry, so it cannot establish memory pressure as the root cause. New Chromium JS heap and page-crash diagnostics will provide that evidence on subsequent runs.

## Files Changed

- `.github/workflows/playwright.yml`: shard bundle uploads/downloads, missing-artifact validation, summary generation, report merge, and email artifact input.
- `playwright.config.js`: JSON, JUnit, HTML, blob, retry/video settings.
- `reporter/shard-metrics.cjs`: Playwright-result-based per-shard metrics and empty-run failure.
- `reporter/matrix-summary.cjs`: eight-shard validation, unknown values, overall totals, and failure status.
- `reporter/email-reporter.cjs`: reads the structured shard diagnostic format.
- `fixtures/extension.js`, `utils/helpers.js`: console, page, request, response, service-worker, app, crash, and memory diagnostics; failure traces and videos.
- `pages/PopupPage.js`: fail-fast processing/georeferencing waits and retry-aware terminal handling.
- `pages/MapPage.js`, `tests/06-gis.edge.spec.js`: enforce and report highlight draw failures.
- `extension/popup.js`, `extension/.env`: chunk/preview error handling, stop multi-file processing on first failure, backend error details, default config.
- `README.md`: corrected shard count and report/artifact behavior.

## CI Summary Contract

Every shard row now includes shard, status, browser, workers, total tests, executed tests, passed, failed, skipped, flaky, retries, duration, diagnostic warnings/errors, and exit code. Missing values render as `UNKNOWN`; a missing artifact renders `DATA MISSING` and `Missing shard test artifact`. A zero-execution shard with exit code zero renders:

```text
STATUS: DATA COLLECTION FAILURE
Reason: No Playwright test result data was collected.
```

The dashboard exits non-zero for missing shards, zero executed tests, unrecovered test failures, or a failed test matrix. Per-test diagnostics are retained in `diagnostics/shard-01.json` through `diagnostics/shard-08.json` inside each shard artifact.

Example shape (diagnostic values are intentionally unknown for the attached, pre-fix run):

```text
# Playwright shard matrix

| Metric | Count |
|---|---:|
| Tests | 55 |
| Executed | 54 |
| Passed | 50 |
| Failed | 0 |
| Skipped | 1 |
| Flaky | 4 |
| Retries | 4 |
| DIAG warnings | UNKNOWN |
| DIAG errors | UNKNOWN |

| Shard | Status | Browser | Workers | Tests | Executed | Passed | Failed | Skipped | Flaky | Retries | Duration (s) | DIAG warnings | DIAG errors | Exit code |
| 01/08 | PASS | chromium-extension | 1 | 7 | 6 | 6 | 0 | 1 | 0 | 0 | <from results.json> | UNKNOWN | UNKNOWN | 0 |
| 03/08 | PASS | chromium-extension | 1 | 7 | 7 | 6 | 0 | 0 | 1 | 1 | <from results.json> | UNKNOWN | UNKNOWN | 0 |
```

## Verification and Limits

- Playwright discovery: 55 tests in 14 files.
- Runtime checks passed: 3 security tests, 2 extension startup runs, one antimeridian GIS flow, and one non-georeferenced TIFF flow.
- Synthetic reporting checks passed for empty results, all-skipped results, pass/flaky/skip/retry counting, and missing shard artifacts.
- JavaScript syntax checks and VS Code diagnostics found no errors in changed source/workflow files.
- The complete 55-test suite was not rerun locally; several CI scenarios depend on external large fixtures and the backend. The attached CI log predates the new diagnostics, so its warning/error counts are `UNKNOWN`, not zero.
- No standalone YAML linter is installed in this environment; the workflow has no VS Code diagnostics, but a hosted Actions run remains the final validation of action expression/runtime behavior.

## Resumed Local Replay

The direct local replay verified one real valid-SID processing test end to end: upload, completion detection, preview, metadata, and download control all passed in about 1.6 minutes. Its JSON/JUnit/HTML/blob outputs were collected, shard metrics reported `1 executed / 1 passed`, and blob merge completed.

The replay also exposed and fixed a compatibility defect: Playwright 1.63 stores tests under `suites[].specs[].tests`, while the initial metrics walker only visited `suite.tests`. The walker now counts both forms. A later eight-shard aggregation over the single real artifact exited non-zero and marked shards 2-8 `DATA MISSING`, as required.

A full shard retry was not safe to complete on this machine. The host had approximately 0.79 GB free RAM; Chromium launch timed out at 180 seconds, and a bounded 30-second launch check produced an accurate failed attempt instead of hanging or passing. One shard's TIFF upload separately surfaced `Chunk 1 failed after 3 retries: Failed to fetch`; the run then stalled in teardown, motivating bounded trace/video/context cleanup and persistence of browser-launch failures. After those fixture changes, syntax and discovery passed, and the three-test security slice again completed with a passing metrics row and successful HTML merge.

The eight-shard CI workflow itself has not been run on GitHub from this workspace. Hosted Linux/Xvfb, artifact-service behavior, and full-matrix results remain to be validated in GitHub Actions with adequate runner memory.