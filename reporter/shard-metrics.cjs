const fs = require("node:fs");
const path = require("node:path");

const shard = Number(process.env.SHARD);
const root = process.cwd();
const testResultsDir = path.resolve(process.env.PW_TEST_RESULTS_DIR || "test-results");
const htmlReportDir = path.resolve(process.env.PW_HTML_REPORT_DIR || "playwright-report");
const blobReportDir = path.resolve(process.env.PW_BLOB_REPORT_DIR || "blob-report");
const diagnosticsDir = path.resolve(process.env.PW_DIAGNOSTICS_DIR || "diagnostics");
const resultPath = path.join(testResultsDir, "results.json");
const diagnosticsPath = path.join(
  diagnosticsDir,
  `shard-${String(shard).padStart(2, "0")}.json`
);
const exitPath = `shard-${shard}-exit-code.txt`;
const diagnostics = fs.existsSync(diagnosticsPath)
  ? JSON.parse(fs.readFileSync(diagnosticsPath, "utf8"))
  : null;
const exitText = fs.existsSync(exitPath)
  ? fs.readFileSync(exitPath, "utf8").trim()
  : "";
const exitCode = /^\d+$/.test(exitText) ? Number(exitText) : null;
const missing = [];

function walkSuites(suites, tests = []) {
  for (const suite of suites || []) {
    tests.push(...(suite.tests || []));
    for (const spec of suite.specs || []) {
      tests.push(...(spec.tests || []));
      walkSuites(spec.suites, tests);
    }
    walkSuites(suite.suites, tests);
  }
  return tests;
}

function exists(filePath, label) {
  if (!fs.existsSync(filePath)) missing.push(label);
}

exists(resultPath, "test-results/results.json");
exists(path.join(testResultsDir, "junit.xml"), "test-results/junit.xml");
exists(path.join(htmlReportDir, "index.html"), "playwright-report/index.html");
if (!fs.existsSync(blobReportDir) || !fs.readdirSync(blobReportDir).some((name) => name.endsWith(".zip"))) {
  missing.push("blob-report/*.zip");
}
if (diagnostics === null || !Array.isArray(diagnostics)) {
  missing.push(`diagnostics/shard-${String(shard).padStart(2, "0")}.json`);
}

let tests = [];
let counts = null;
let retries = null;
let durationMs = null;
let browser = null;

if (fs.existsSync(resultPath)) {
  try {
    const report = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    tests = walkSuites(report.suites);
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let flaky = 0;
    let executed = 0;
    let attempts = 0;
    let missingAttempts = 0;
    retries = 0;
    durationMs = 0;

    for (const test of tests) {
      const results = test.results || [];
      if (results.some((result) => result.status !== "skipped")) executed++;
      attempts += results.length;
      retries += Math.max(0, results.length - 1);
      durationMs += results.reduce((sum, result) => sum + Number(result.duration || 0), 0);
      browser ||= test.projectName || null;
      const finalResult = results.at(-1);

      if (test.expectedStatus === "skipped" || finalResult?.status === "skipped") {
        skipped++;
      } else if (!finalResult) {
        missingAttempts++;
      } else if (finalResult.status === "passed") {
        const hadFailure = results.slice(0, -1).some((result) =>
          ["failed", "timedOut", "interrupted"].includes(result.status)
        );
        if (hadFailure || test.outcome === "flaky") flaky++;
        else passed++;
      } else {
        failed++;
      }
    }

    counts = missingAttempts === 0 && attempts > 0
      ? { total: tests.length, executed, passed, failed, skipped, flaky, attempts }
      : null;
    if (attempts === 0) missing.push("Playwright test attempts in results.json");
    if (missingAttempts > 0) missing.push(`Results missing for ${missingAttempts} scheduled tests`);
  } catch (error) {
    missing.push(`valid test-results/results.json (${error.message})`);
  }
}

const diagWarnings = diagnostics?.filter((item) => item.severity === "warning").length ?? null;
const diagErrors = diagnostics?.filter((item) => item.severity === "error").length ?? null;
const noTestData = !counts || counts.total === 0 || counts.attempts === 0 || counts.executed === 0;
if (noTestData && exitCode === 0) {
  missing.push("No Playwright test result data was collected.");
}
if (exitCode === null) missing.push("shard exit code");

let status = "PASS";
if (noTestData || missing.length) status = "DATA COLLECTION FAILURE";
else if (exitCode !== 0 || counts.failed > 0) status = "FAIL";
else if (diagErrors > 0) status = "PASS WITH DIAG ERRORS";
else if (diagWarnings > 0) status = "PASS WITH DIAG WARNINGS";

const metrics = {
  shard,
  totalShards: Number(process.env.TOTAL_SHARDS || 8),
  browser: browser || process.env.PLAYWRIGHT_PROJECT || "UNKNOWN",
  workers: Number(process.env.PW_WORKERS || 1),
  status,
  reason: noTestData && exitCode === 0
    ? "No Playwright test result data was collected."
    : missing.length ? missing.join("; ") : null,
  total: counts?.total ?? null,
  executed: counts?.executed ?? null,
  passed: counts?.passed ?? null,
  failed: counts?.failed ?? null,
  skipped: counts?.skipped ?? null,
  flaky: counts?.flaky ?? null,
  retries,
  durationMs,
  warnings: diagWarnings,
  errors: diagErrors,
  exitCode,
  missing,
};

fs.writeFileSync("shard-metrics.json", JSON.stringify(metrics, null, 2));
const value = (item) => item === null ? "UNKNOWN" : String(item);
const summary = [
  `# ${status === "PASS" ? "PASS" : "❌ " + status} · Shard ${String(shard).padStart(2, "0")}/${String(metrics.totalShards).padStart(2, "0")}`,
  "",
  `**Browser:** ${metrics.browser} · **Workers:** ${metrics.workers}`,
  "",
  "| Metric | Count |",
  "|---|---:|",
  `| Tests | ${value(metrics.total)} |`,
  `| Executed | ${value(metrics.executed)} |`,
  `| Passed | ${value(metrics.passed)} |`,
  `| Failed | ${value(metrics.failed)} |`,
  `| Skipped | ${value(metrics.skipped)} |`,
  `| Flaky | ${value(metrics.flaky)} |`,
  `| Retries | ${value(metrics.retries)} |`,
  `| Duration (s) | ${metrics.durationMs === null ? "UNKNOWN" : (metrics.durationMs / 1000).toFixed(1)} |`,
  `| DIAG warnings | ${value(metrics.warnings)} |`,
  `| DIAG errors | ${value(metrics.errors)} |`,
  `| Exit code | ${value(metrics.exitCode)} |`,
  "",
];
if (metrics.reason) summary.push(`**Reason:** ${metrics.reason}`, "");
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n"));
}

if (["DATA COLLECTION FAILURE", "FAIL"].includes(status)) process.exitCode = 1;