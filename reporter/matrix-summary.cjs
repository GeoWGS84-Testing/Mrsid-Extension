const fs = require("node:fs");
const path = require("node:path");

const totalShards = Number(process.env.TOTAL_SHARDS || 8);
const root = "shard-results";
const rows = [];
const missingArtifacts = [];

for (let shard = 1; shard <= totalShards; shard++) {
  const folder = path.join(root, `playwright-results-shard-${shard}`);
  const metricsFile = path.join(folder, "shard-metrics.json");
  if (!fs.existsSync(folder)) {
    missingArtifacts.push(`playwright-results-shard-${shard}`);
    rows.push({ shard, status: "DATA MISSING", reason: "Missing shard test artifact" });
    continue;
  }

  try {
    rows.push(JSON.parse(fs.readFileSync(metricsFile, "utf8")));
  } catch {
    missingArtifacts.push(`playwright-results-shard-${shard}`);
    rows.push({ shard, status: "DATA MISSING", reason: "Missing shard test artifact or metrics" });
  }
}

const columns = [
  ["total", "Tests"], ["executed", "Executed"], ["passed", "Passed"], ["failed", "Failed"],
  ["skipped", "Skipped"], ["flaky", "Flaky"], ["retries", "Retries"],
  ["durationMs", "Duration (s)"], ["warnings", "DIAG warnings"], ["errors", "DIAG errors"],
  ["exitCode", "Exit code"],
];
const display = (row, key) => {
  const value = row[key];
  if (value === null || value === undefined) return "UNKNOWN";
  if (key === "durationMs") return (value / 1000).toFixed(1);
  return String(value);
};
const totals = Object.fromEntries(columns.map(([key]) => [key,
  rows.every((row) => Number.isFinite(row[key]))
    ? rows.reduce((sum, row) => sum + (key === "exitCode" ? 0 : row[key]), 0)
    : null,
]));

const failed = rows.some((row) => ["FAIL", "DATA COLLECTION FAILURE", "DATA MISSING"].includes(row.status));
const output = [
  `# ${failed ? "❌" : "✅"} Playwright shard matrix · ${failed ? "FAILURE / INCOMPLETE DATA" : "COMPLETE"}`,
  "",
  "## Overall",
  "",
  "| Metric | Count |",
  "|---|---:|",
  ...columns.filter(([key]) => key !== "exitCode").map(([key, label]) =>
    `| ${label} | ${totals[key] === null ? "UNKNOWN" : key === "durationMs" ? (totals[key] / 1000).toFixed(1) : totals[key]} |`
  ),
  "",
  `| Shard | Status | Browser | Workers | ${columns.map(([, label]) => label).join(" | ")} |`,
  `|---|---|---|---:|${columns.map(() => "---:").join("|")} |`,
  ...rows.map((row) => `| ${String(row.shard).padStart(2, "0")}/${String(totalShards).padStart(2, "0")} | ${row.status} | ${row.browser || "UNKNOWN"} | ${row.workers ?? "UNKNOWN"} | ${columns.map(([key]) => display(row, key)).join(" | ")} |`),
  "",
];

if (missingArtifacts.length) {
  output.push("## Missing artifacts", "", ...missingArtifacts.map((name) => `- Missing shard test artifact: ${name}`), "");
}
for (const row of rows.filter((item) => item.reason || item.missing?.length)) {
  output.push(`Shard ${String(row.shard).padStart(2, "0")} detail: ${row.reason || row.missing.join("; ")}`, "");
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) fs.appendFileSync(summaryPath, output.join("\n"));
fs.writeFileSync("run-matrix.json", JSON.stringify({ totalShards, missingArtifacts, failed, rows, totals }, null, 2));

if (failed || process.env.TEST_RESULT !== "success") process.exitCode = 1;