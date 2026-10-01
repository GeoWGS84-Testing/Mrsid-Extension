require("dotenv/config");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const LOGO_PATH = path.join(__dirname, "..", "test-data", "Datastore_Logo.png");
const LOGO_CID = "datastore_logo_cid";

const TARGET_URL = process.env.TARGET_URL || "https://datastore.geowgs84.com/";
const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || "Asia/Kolkata";

const DIAG_DIR = path.join(process.cwd(), "diagnostics");
const VIDEO_DIR = path.join(process.cwd(), "test-results");

// ============================================================
// BRAND PALETTE — professional QA theme
// ============================================================

const BRAND = {
  navy: "#0B1E36",
  navyDark: "#081527",
  navySoft: "#132B4A",
  accent: "#2563EB",
  accentSoft: "#DBEAFE",
  teal: "#0E9488",
  ink: "#0F172A",
  bodyText: "#334155",
  muted: "#64748B",
  faint: "#94A3B8",
  line: "#E2E8F0",
  bg: "#EEF2F6",
  card: "#FFFFFF",
  success: "#059669",
  successBg: "#ECFDF5",
  successLine: "#A7F3D0",
  danger: "#DC2626",
  dangerBg: "#FEF2F2",
  dangerLine: "#FECACA",
  warning: "#B45309",
  warningBg: "#FFFBEB",
  warningLine: "#FDE68A",
  skip: "#6D28D9",
  skipBg: "#F5F3FF",
  skipLine: "#DDD6FE",
  neutral: "#64748B",
  neutralBg: "#F1F5F9",
  neutralLine: "#E2E8F0",
};

// ============================================================
// ANSI STRIPPING
// ============================================================

function stripAnsi(str) {
  if (!str) return "";
  return String(str)
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)m/g, "")
    .trim();
}

// ============================================================
// TERMINAL OUTPUT EXTRACTOR
// ============================================================

function extractTerminalOutput(result) {
  const parts = [];
  if (result.output) {
    const raw = Buffer.isBuffer(result.output)
      ? result.output.toString("utf-8")
      : String(result.output || "");
    const cleaned = stripAnsi(raw);
    if (cleaned) parts.push(cleaned);
  }
  if (result.stdout) {
    const raw = Buffer.isBuffer(result.stdout)
      ? result.stdout.toString("utf-8")
      : String(result.stdout || "");
    const cleaned = stripAnsi(raw);
    if (cleaned) parts.push(cleaned);
  }
  if (result.stderr) {
    const raw = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf-8")
      : String(result.stderr || "");
    const cleaned = stripAnsi(raw);
    if (cleaned) parts.push(cleaned);
  }
  return parts.join("\n");
}

// ============================================================
// TEXT TRUNCATION
// ============================================================

function truncateText(text, maxLines = 250) {
  if (!text) return text;
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  const kept = lines.slice(0, maxLines);
  const truncated = lines.length - maxLines;
  return kept.join("\n") + `\n\n... (${truncated} more lines truncated)`;
}

// ============================================================
// TIME HELPERS
// ============================================================

function formatCompletionTime(date) {
  const local = new Intl.DateTimeFormat("en-IN", {
    timeZone: REPORT_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);

  const utc =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date) + " UTC";

  return { local, utc };
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "—";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// ============================================================
// LOG EXTRACTORS
// ============================================================

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractTestLogs(logs) {
  const text = logs || "";
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.includes("--- Test Started:"));
  const endIdx = lines.findIndex((l) => l.includes("--- Test Finished:"));
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx)
    return lines.slice(startIdx, endIdx + 1).join("\n");
  return text;
}

function extractErrorDetails(logs) {
  const text = logs || "";
  const lines = text.split("\n");
  const failIdx = lines.findIndex((l) => l.includes("[FAILURE]"));
  if (failIdx !== -1)
    return lines
      .slice(failIdx, Math.min(lines.length, failIdx + 40))
      .join("\n");
  const errIdx = lines.findIndex((l) => l.includes("[ERROR]"));
  if (errIdx !== -1)
    return lines.slice(errIdx, Math.min(lines.length, errIdx + 20)).join("\n");
  const errLine = lines.findIndex(
    (l) => l.includes("Error:") || l.includes("TEST FAILED"),
  );
  if (errLine !== -1)
    return lines
      .slice(Math.max(0, errLine - 2), Math.min(lines.length, errLine + 15))
      .join("\n");
  return null;
}

function extractAllWarnings(logs, testTitle = null) {
  const text = logs || "";
  const lines = text.split("\n");
  const warnings = new Set();
  for (const line of lines) {
    if (testTitle && line.includes("(") && line.includes(")")) {
      if (!line.includes(`(${testTitle})`)) {
        continue;
      }
    }
    if (
      line.includes("[DIAG-DEBUG]") &&
      testTitle &&
      !line.includes(testTitle)
    ) {
      continue;
    }

    let msg = null;
    if (line.includes("[WARNING]")) {
      const parts = line.split(" - ");
      msg = parts.length > 1 ? parts.slice(1).join(" - ").trim() : line.trim();
    } else if (/^\s*Warning:\s/i.test(line)) {
      msg = line.replace(/^\s*Warning:\s*/i, "").trim();
    }
    if (msg && msg.length > 0) warnings.add(msg);
  }
  return [...warnings];
}

// ============================================================
// TERMINAL LOG FILTER — isolates logs for a specific test
// ============================================================

function filterTerminalLogsForTest(terminalOutput, testTitle) {
  if (!terminalOutput || !testTitle) return terminalOutput || "";

  const lines = terminalOutput.split("\n");
  const filtered = [];

  let testStartIdx = -1;
  let testEndIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].includes("--- Test Started:") &&
      lines[i].includes(testTitle)
    ) {
      testStartIdx = i;
      break;
    }
  }
  if (testStartIdx !== -1) {
    for (let i = testStartIdx + 1; i < lines.length; i++) {
      if (lines[i].includes("--- Test Finished:")) {
        testEndIdx = i;
        break;
      }
    }
  }

  if (testStartIdx !== -1 && testEndIdx !== -1) {
    return lines.slice(testStartIdx, testEndIdx + 1).join("\n");
  }

  const escapedTitle = testTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const testPattern = new RegExp(`\\(${escapedTitle}\\)`);

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.includes("[DIAG-DEBUG]") && !trimmed.includes(testTitle)) {
      continue;
    }

    if (!trimmed) continue;

    if (testPattern.test(line)) {
      filtered.push(line);
      continue;
    }

    if (!trimmed.match(/\[P\d+\].*—/) && !trimmed.match(/\([^\)]*—[^\)]*\)/)) {
      const otherTestMatch = trimmed.match(/\((\[P\d+\][^)]+)\)/);
      if (!otherTestMatch) {
        filtered.push(line);
      }
    }
  }

  return filtered.join("\n");
}

// ============================================================
// VIDEO FINDER (fallback search)
// ============================================================

function findVideoForTest(testTitle) {
  if (!fs.existsSync(VIDEO_DIR)) return null;

  const safeName = String(testTitle)
    .replace(/[:/\\<>?"|*]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 80);

  try {
    const files = fs.readdirSync(VIDEO_DIR);
    const videoFiles = files.filter(
      (f) =>
        /\.(webm|mp4|mkv)$/i.test(f) && f.includes(safeName.substring(0, 40)),
    );
    if (videoFiles.length > 0) {
      const sorted = videoFiles
        .map((f) => ({
          file: f,
          mtime: fs.statSync(path.join(VIDEO_DIR, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);
      return path.join(VIDEO_DIR, sorted[0].file);
    }
  } catch (e) {}

  return null;
}

// ============================================================
// TEST ORDERING
// ============================================================

function sortTestsByDefinitionOrder(allTests) {
  function extractSortKey(title) {
    const match = title.match(/\[(?:P\d+)\]\s+([\d.]+):/);
    if (!match) return [999];
    return match[1].split(".").map((n) => parseInt(n, 10) || 0);
  }

  return [...allTests].sort((a, b) => {
    const keyA = extractSortKey(a.test.title);
    const keyB = extractSortKey(b.test.title);
    for (let i = 0; i < Math.max(keyA.length, keyB.length); i++) {
      const numA = keyA[i] || 0;
      const numB = keyB[i] || 0;
      if (numA !== numB) return numA - numB;
    }
    return 0;
  });
}

// ============================================================
// DIAGNOSTICS — with fallback lookup
// ============================================================

function readDiagnostics(testId, testTitle) {
  if (testId) {
    const safeId = String(testId)
      .replace(/[:/\\<>?"|*]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .substring(0, 150);
    const filePath = path.join(DIAG_DIR, `${safeId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        console.log(
          `[REPORTER] Diagnostics found by testId: ${safeId} (warnings=${data.warnings?.length || 0}, skipped=${data.skippedSteps?.length || 0})`,
        );
        return data;
      } catch (e) {
        console.warn(
          `[REPORTER] Failed to parse diagnostics file: ${filePath}`,
          e.message,
        );
      }
    }
  }

  if (testTitle) {
    const safeTitle = String(testTitle)
      .replace(/[:/\\<>?"|*]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .substring(0, 150);
    const filePath = path.join(DIAG_DIR, `${safeTitle}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        console.log(
          `[REPORTER] Diagnostics found by title: ${safeTitle} (warnings=${data.warnings?.length || 0}, skipped=${data.skippedSteps?.length || 0})`,
        );
        return data;
      } catch (e) {}
    }
  }

  if (testTitle && fs.existsSync(DIAG_DIR)) {
    try {
      const files = fs.readdirSync(DIAG_DIR).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const data = JSON.parse(
            fs.readFileSync(path.join(DIAG_DIR, file), "utf-8"),
          );
          if (data.testcase === testTitle) {
            console.log(
              `[REPORTER] Diagnostics found by search: ${file} (warnings=${data.warnings?.length || 0}, skipped=${data.skippedSteps?.length || 0})`,
            );
            return data;
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  console.warn(
    `[REPORTER] No diagnostics found for testId="${testId}" title="${testTitle}"`,
  );
  return null;
}

function formatInfosAsLogs(infos, testTitle = null) {
  if (!infos || infos.length === 0) return "";
  return infos
    .filter((info) => {
      if (!testTitle || !info.test) return true;
      return info.test === testTitle;
    })
    .map((info) => {
      const meta =
        info.meta && Object.keys(info.meta).length > 0
          ? " " + JSON.stringify(info.meta)
          : "";
      const testPart = info.test ? `(${info.test})` : "";
      const flowPart = info.flow ? `[${info.flow}]` : "";
      return `[INFO] ${info.time} ${testPart} ${flowPart} - ${info.message}${meta}`;
    })
    .join("\n");
}

// ============================================================
// DIAGNOSTICS FOLDER MANAGEMENT
// ============================================================

function clearDiagnosticsFolder() {
  if (!fs.existsSync(DIAG_DIR)) {
    fs.mkdirSync(DIAG_DIR, { recursive: true });
    return;
  }
  try {
    const files = fs.readdirSync(DIAG_DIR);
    let removed = 0;
    for (const file of files) {
      const filePath = path.join(DIAG_DIR, file);
      try {
        if (fs.lstatSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
        removed++;
      } catch (e) {
        console.warn(`  ⚠️ Could not remove ${file}: ${e.message}`);
      }
    }
    if (removed > 0) {
      console.log(
        `🧹 Diagnostics cleared: ${removed} stale file${removed !== 1 ? "s" : ""} from previous run`,
      );
    }
  } catch (err) {
    console.warn("⚠️ Failed to clear diagnostics folder:", err.message);
  }
}

// ============================================================
// CSS — clean, professional, email-client-safe
// ============================================================

function getReportStyles() {
  return `
    <style type="text/css">
        body, table, td, div, p, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
        img { -ms-interpolation-mode: bicubic; }

        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        .anim-row { animation: fadeInUp 0.35s ease-out both; }

        details summary::-webkit-details-marker { display: none; }
        details summary { list-style: none; }

        .log-container { width: 100% !important; max-width: 100% !important; overflow: visible; }
        .log-container pre.log-pre {
            white-space: pre !important;
            overflow-x: auto !important;
            overflow-y: auto !important;
            word-break: break-all;
            -webkit-overflow-scrolling: touch;
            min-width: 0;
            width: 100%;
            tab-size: 4;
        }

        @media only screen and (max-width: 520px) {
            .resp-hide { display: none !important; width: 0 !important; padding: 0 !important; font-size: 0 !important; line-height: 0 !important; max-height: 0 !important; overflow: hidden !important; }
            .resp-show { display: block !important; width: 100% !important; max-width: 100% !important; overflow: visible !important; }
            .resp-stack { display: block !important; width: 100% !important; float: left !important; }
            .resp-full { width: 100% !important; max-width: 100% !important; display: block !important; }
            .resp-center { text-align: center !important; }
            .resp-pad { padding-left: 14px !important; padding-right: 14px !important; }
            .resp-pad-sm { padding-left: 10px !important; padding-right: 10px !important; }
            .r-header-pad { padding-top: 22px !important; padding-bottom: 18px !important; }
            .r-title { font-size: 16px !important; letter-spacing: 1px !important; }
            .r-sub { font-size: 9px !important; letter-spacing: 0.5px !important; }
            .r-url { font-size: 9px !important; }
            .r-time-val { font-size: 13px !important; }
            .r-time-lbl { font-size: 8px !important; }
            .r-meta { font-size: 8px !important; }
            .r-metric-val { font-size: 14px !important; }
            .r-metric-lbl { font-size: 7px !important; }
            .r-metric-sub { font-size: 7px !important; }
            .r-card-pad { padding: 10px 8px !important; }
            .r-stat-num { font-size: 20px !important; }
            .r-stat-emoji { font-size: 15px !important; }
            .r-stat-lbl { font-size: 8px !important; letter-spacing: 0.5px !important; }
            .r-stat-pct { font-size: 10px !important; }
            .r-stat-pad { padding-top: 10px !important; padding-bottom: 10px !important; }
            .r-section { font-size: 11px !important; padding-left: 14px !important; padding-right: 14px !important; }
            .r-th { font-size: 7px !important; padding: 8px 10px !important; }
            .r-td { padding: 8px 10px !important; }
            .r-test-name { font-size: 10px !important; }
            .r-file-chip { font-size: 7px !important; }
            .r-pre { font-size: 7px !important; padding: 8px !important; }
            .r-detail-pad { padding: 8px !important; }
            .r-legend { font-size: 7px !important; }
            .r-footer { font-size: 7px !important; letter-spacing: 0.3px !important; }
            .log-container details { margin-left: 0 !important; margin-right: 0 !important; padding-left: 0 !important; padding-right: 0 !important; }
            .log-container details summary { padding-left: 6px !important; padding-right: 6px !important; font-size: 7px !important; }
            .log-container details[open] pre { max-height: 300px !important; font-size: 6.5px !important; padding: 6px !important; }
        }
    </style>`;
}

// ============================================================
// HTML BUILDERS
// ============================================================

function buildHeader(logoCid) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.navy};">
        <tr>
            <td align="center" style="padding:30px 20px 0 20px;" class="r-header-pad">
                <img src="cid:${logoCid}" alt="Datastore" width="56" style="width:56px; height:auto; border:0; border-radius:10px; display:block;" />
            </td>
        </tr>
        <tr>
            <td align="center" style="padding:16px 20px 0 20px;">
                <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:10px; font-weight:700; color:#7DD3C0; letter-spacing:3px; text-transform:uppercase;">QA Automation Report</div>
            </td>
        </tr>
        <tr>
            <td align="center" style="padding:6px 20px 0 20px;">
                <h1 class="r-title" style="margin:0; font-family:'Segoe UI',Arial,sans-serif; font-size:20px; font-weight:700; color:#FFFFFF; letter-spacing:0.2px;">
                    GeoWGS84 Datastore
                </h1>
            </td>
        </tr>
        <tr>
            <td align="center" style="padding:6px 20px 0 20px;">
                <a href="${TARGET_URL}" class="r-url" style="font-family:'Segoe UI',Arial,sans-serif; font-size:11px; color:#93C5FD; text-decoration:none;">${TARGET_URL.replace(/^https?:\/\//, "")}</a>
            </td>
        </tr>
        <tr>
            <td align="center" style="padding:16px 20px 0 20px;">
                <p class="anim-row r-sub" style="margin:0; font-family:'Segoe UI',Arial,sans-serif; font-size:10px; color:#9FB2C8; letter-spacing:1.5px;">
                    END-TO-END VALIDATION &nbsp;·&nbsp; PLAYWRIGHT &nbsp;·&nbsp; NODE.JS
                </p>
            </td>
        </tr>
        <tr>
            <td align="center" style="padding:16px 20px 0 20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                    <td style="width:48px; height:3px; background:${BRAND.teal}; border-radius:3px;"></td>
                </tr></table>
            </td>
        </tr>
        <tr><td style="height:24px; line-height:24px; font-size:1px;">&nbsp;</td></tr>
    </table>`;
}

function buildTimeBar(time, wallClock, totalDuration, totalTests, workers) {
  const savings =
    wallClock !== "—" && totalDuration !== "—"
      ? (() => {
          const wcMatch = wallClock.match(/(\d+)m\s*(\d+)s/);
          const tdMatch = totalDuration.match(/(\d+)m\s*(\d+)s/);
          if (wcMatch && tdMatch) {
            const wcSec = parseInt(wcMatch[1]) * 60 + parseInt(wcMatch[2]);
            const tdSec = parseInt(tdMatch[1]) * 60 + parseInt(tdMatch[2]);
            const diff = tdSec - wcSec;
            return diff > 0 ? formatDuration(diff * 1000) : null;
          }
          return null;
        })()
      : null;

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.card}; border-bottom:1px solid ${BRAND.line};">
        <tr>
            <td style="padding:20px 24px;" class="resp-pad">
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td width="50%" valign="top" class="resp-stack">
                            <table cellpadding="0" cellspacing="0" width="100%">
                                <tr><td style="font-family:'Segoe UI',Arial,sans-serif; font-size:10px; color:${BRAND.faint}; text-transform:uppercase; letter-spacing:1.5px; padding-bottom:6px;" class="r-time-lbl">Run Completed</td></tr>
                                <tr><td style="font-family:'Segoe UI',Arial,sans-serif; font-size:16px; color:${BRAND.ink}; font-weight:700;" class="r-time-val">${time.local}</td></tr>
                                <tr><td style="font-family:'Segoe UI',Arial,sans-serif; font-size:10px; color:${BRAND.faint}; padding-top:3px;" class="r-meta">${time.utc}</td></tr>
                            </table>
                        </td>
                        <td width="50%" valign="top" align="right" class="resp-stack resp-center">
                            <table cellpadding="0" cellspacing="0" width="100%">
                                <tr><td style="font-family:'Segoe UI',Arial,sans-serif; font-size:10px; color:${BRAND.faint}; text-transform:uppercase; letter-spacing:1.5px; padding-bottom:6px;" class="r-time-lbl">Duration</td></tr>
                                <tr><td style="font-family:'Segoe UI',Arial,sans-serif; font-size:16px; color:${BRAND.ink}; font-weight:700;" class="r-time-val">${wallClock}</td></tr>
                                <tr><td style="font-family:'Segoe UI',Arial,sans-serif; font-size:10px; color:${BRAND.faint}; padding-top:3px;" class="r-meta">
                                    ${totalTests} test${totalTests !== 1 ? "s" : ""} &nbsp;·&nbsp; ${workers} worker${workers !== 1 ? "s" : ""}
                                    ${savings ? ` &nbsp;·&nbsp; <span style="color:${BRAND.success}; font-weight:600;">saved ${savings}</span>` : ""}
                                </td></tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        ${
          totalDuration !== "—"
            ? `
        <tr>
            <td style="padding:0 24px 18px 24px;" class="resp-pad">
                <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.neutralBg}; border-radius:10px; border:1px solid ${BRAND.line}; overflow:hidden;">
                    <tr>
                        <td width="33%" valign="middle" style="padding:12px 14px;" class="r-card-pad">
                            <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:9px; color:${BRAND.faint}; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:3px;" class="r-metric-lbl">Wall-Clock</div>
                            <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:15px; color:${BRAND.ink}; font-weight:700;" class="r-metric-val">${wallClock}</div>
                            <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:8px; color:${BRAND.faint}; margin-top:2px;" class="r-metric-sub">Actual elapsed</div>
                        </td>
                        <td width="34%" valign="middle" style="padding:12px 14px; border-left:1px solid ${BRAND.line}; border-right:1px solid ${BRAND.line};" align="center" class="r-card-pad">
                            <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:9px; color:${BRAND.faint}; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:3px;" class="r-metric-lbl">Cumulative</div>
                            <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:15px; color:${BRAND.accent}; font-weight:700;" class="r-metric-val">${totalDuration}</div>
                            <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:8px; color:${BRAND.faint}; margin-top:2px;" class="r-metric-sub">Sum of all tests</div>
                        </td>
                        <td width="33%" valign="middle" style="padding:12px 14px;" align="right" class="r-card-pad">
                            <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:9px; color:${BRAND.faint}; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:3px;" class="r-metric-lbl">Parallelism</div>
                            <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:15px; color:${BRAND.ink}; font-weight:700;" class="r-metric-val">${workers}x</div>
                            <div style="font-family:'Segoe UI',Arial,sans-serif; font-size:8px; color:${BRAND.faint}; margin-top:2px;" class="r-metric-sub">Concurrent workers</div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>`
            : ""
        }
    </table>`;
}

function buildStatsBar(stats, totalTests) {
  const pPct =
    totalTests > 0 ? Math.round((stats.passed / totalTests) * 100) : 0;
  const fPct =
    totalTests > 0 ? Math.round((stats.failed / totalTests) * 100) : 0;
  const wPct =
    totalTests > 0 ? Math.round((stats.warning_tests / totalTests) * 100) : 0;
  const sPct =
    totalTests > 0 ? Math.round((stats.skipped / totalTests) * 100) : 0;

  function statCard(dot, num, label, pct, color, bgColor, borderColor, active) {
    const dc = BRAND.faint;
    const dbg = BRAND.neutralBg;
    const dbc = BRAND.line;
    const c = active ? color : dc;
    const bg = active ? bgColor : dbg;
    const bc = active ? borderColor : dbc;
    return `
        <td width="25%" align="center" valign="top" style="padding:0 3px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:${bg}; border:1px solid ${bc}; border-radius:10px; overflow:hidden;">
                <tr><td align="center" style="padding-top:14px; padding-bottom:4px;"><div style="width:8px; height:8px; border-radius:50%; background:${c}; margin:0 auto; display:inline-block;" class="r-stat-emoji"></div></td></tr>
                <tr><td align="center" style="padding-bottom:1px;"><div class="r-stat-num" style="display:inline-block; font-family:'Segoe UI',Arial,sans-serif; font-size:24px; font-weight:800; color:${c}; line-height:1.2;">${num}</div></td></tr>
                <tr><td align="center" style="padding-bottom:1px;"><span style="font-family:'Segoe UI',Arial,sans-serif; font-size:9px; color:${c}; text-transform:uppercase; letter-spacing:1.2px; font-weight:700;" class="r-stat-lbl">${label}</span></td></tr>
                <tr><td align="center" style="padding-bottom:12px;" class="r-stat-pad"><span style="font-family:'Segoe UI',Arial,sans-serif; font-size:11px; color:${c}; font-weight:600;" class="r-stat-pct">${pct}%</span></td></tr>
            </table>
        </td>`;
  }

  const bars = [];
  if (pPct > 0)
    bars.push(`<div style="height:100%; width:${pPct}%; background:${BRAND.success}; float:left;"></div>`);
  if (fPct > 0)
    bars.push(`<div style="height:100%; width:${fPct}%; background:${BRAND.danger}; float:left;"></div>`);
  if (wPct > 0)
    bars.push(`<div style="height:100%; width:${wPct}%; background:${BRAND.warning}; float:left;"></div>`);
  if (sPct > 0)
    bars.push(`<div style="height:100%; width:${sPct}%; background:${BRAND.neutral}; float:left;"></div>`);

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.card}; border-bottom:1px solid ${BRAND.line};">
        <tr><td style="padding:18px 16px 8px 16px;" class="resp-pad-sm">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
                ${statCard(1, stats.passed, "Passed", pPct, BRAND.success, BRAND.successBg, BRAND.successLine, stats.passed > 0)}
                ${statCard(1, stats.failed, "Failed", fPct, BRAND.danger, BRAND.dangerBg, BRAND.dangerLine, stats.failed > 0)}
                ${statCard(1, stats.warning_tests, "Warnings", wPct, BRAND.warning, BRAND.warningBg, BRAND.warningLine, stats.warning_tests > 0)}
                ${statCard(1, stats.skipped, "Skipped", sPct, BRAND.neutral, BRAND.neutralBg, BRAND.neutralLine, stats.skipped > 0)}
            </tr></table>
        </td></tr>
        <tr><td style="padding:4px 20px 18px 20px;" class="resp-pad-sm">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.neutralBg}; border-radius:6px; overflow:hidden; height:8px;">
                <tr><td style="padding:0; border:none;"><div style="height:8px; width:100%; position:relative; overflow:hidden; border-radius:6px;">${bars.join("")}</div></td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
                <tr>
                    <td style="font-family:'Segoe UI',Arial,sans-serif; font-size:8px; color:${BRAND.faint};" class="r-legend">
                        <span style="color:${BRAND.success};">■</span> Pass &nbsp; <span style="color:${BRAND.danger};">■</span> Fail &nbsp; <span style="color:${BRAND.warning};">■</span> Warn &nbsp; <span style="color:${BRAND.neutral};">■</span> Skip
                    </td>
                    <td align="right" style="font-family:'Segoe UI',Arial,sans-serif; font-size:8px; color:${BRAND.faint};" class="r-legend">${totalTests} total</td>
                </tr>
            </table>
        </td></tr>
    </table>`;
}

function buildSectionTitle(title) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:20px 24px 10px 24px; font-family:'Segoe UI',Arial,sans-serif; font-size:11px; font-weight:800; color:${BRAND.ink}; text-transform:uppercase; letter-spacing:1.5px; border-bottom:2px solid ${BRAND.navy}; " class="r-section">${title}</td></tr>
    </table>`;
}

function buildFooter() {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.navy};">
        <tr><td style="height:1px; line-height:1px; font-size:1px; background:${BRAND.teal};">&nbsp;</td></tr>
        <tr><td align="center" style="padding:18px 20px 4px 20px; font-family:'Segoe UI',Arial,sans-serif; font-size:11px; color:#E2E8F0; font-weight:600;">GeoWGS84 Datastore QA</td></tr>
        <tr><td align="center" style="padding:0 20px 2px 20px;"><a href="${TARGET_URL}" style="font-family:'Segoe UI',Arial,sans-serif; font-size:9px; color:#93C5FD; text-decoration:none;">${TARGET_URL}</a></td></tr>
        <tr><td align="center" style="padding:6px 20px 4px 20px; font-family:'Segoe UI',Arial,sans-serif; font-size:9px; color:#8CA0B8; letter-spacing:1px;" class="r-footer">AUTOMATED E2E &nbsp;·&nbsp; PLAYWRIGHT &nbsp;·&nbsp; NODE.JS</td></tr>
        <tr><td align="center" style="padding:4px 20px 18px 20px; font-family:'Segoe UI',Arial,sans-serif; font-size:8px; color:#5E7391;" class="r-footer">This is an automated message — please do not reply.</td></tr>
    </table>`;
}

function wrapBody(inner) {
  return `
    <!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">${getReportStyles()}</head>
    <body style="margin:0; padding:0; background-color:${BRAND.bg}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
        <div style="background:${BRAND.bg}; padding:16px 6px; font-family:'Segoe UI',Arial,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" align="center">
                <tr><td align="center">
                    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:820px; background:${BRAND.card}; border-radius:12px; overflow:hidden; border:1px solid ${BRAND.line}; box-shadow:0 2px 14px rgba(15,23,42,0.06);">
                        ${inner}
                    </table>
                </td></tr>
            </table>
        </div>
    </body></html>`;
}

// ============================================================
// TEST ROW
// ============================================================

function buildTestRow(item, addAttachment, index) {
  const {
    test,
    logs,
    logLineCount,
    errorDetails,
    allWarnings,
    allSkippedSteps,
    videos,
    images,
    hasWarning,
    hasSkippedLogic,
    isFailure,
    isPassed,
    duration,
  } = item;

  let bgCard, borderColor, color, label;
  if (isFailure) {
    bgCard = BRAND.dangerBg;
    borderColor = BRAND.dangerLine;
    color = BRAND.danger;
    label = "FAILED";
  } else if (hasWarning) {
    bgCard = BRAND.warningBg;
    borderColor = BRAND.warningLine;
    color = BRAND.warning;
    label = "WARNING";
  } else if (hasSkippedLogic) {
    bgCard = BRAND.skipBg;
    borderColor = BRAND.skipLine;
    color = BRAND.skip;
    label = "SKIPPED";
  } else {
    bgCard = BRAND.successBg;
    borderColor = BRAND.successLine;
    color = BRAND.success;
    label = "PASSED";
  }

  const rowBg = isFailure
    ? "#FFFBFB"
    : hasWarning
      ? "#FFFDF7"
      : hasSkippedLogic
        ? "#FBFAFF"
        : "#FFFFFF";

  const attHtml = [];
  if (isPassed && !hasSkippedLogic) {
    attHtml.push(
      `<span style="color:${BRAND.faint}; font-size:10px;">— none —</span>`,
    );
  } else {
    images.forEach((img) => {
      if (addAttachment(img)) {
        const n =
          img.name.length > 18 ? img.name.substring(0, 16) + ".." : img.name;
        attHtml.push(
          `<span style="display:inline-block; background:${BRAND.accentSoft}; color:${BRAND.accent}; padding:2px 6px; border-radius:4px; font-size:7px; margin:1px; font-family:monospace; border:1px solid #BFDBFE;">IMG ${escapeHtml(n)}</span>`,
        );
      }
    });
    videos.forEach((vid) => {
      if (addAttachment(vid)) {
        const sz = (fs.statSync(vid.path).size / (1024 * 1024)).toFixed(1);
        attHtml.push(
          `<span style="display:inline-block; background:${BRAND.skipBg}; color:${BRAND.skip}; padding:2px 6px; border-radius:4px; font-size:7px; margin:1px; font-family:monospace; border:1px solid ${BRAND.skipLine};">VIDEO ${sz}MB</span>`,
        );
      } else {
        attHtml.push(
          `<span style="display:inline-block; background:${BRAND.dangerBg}; color:${BRAND.danger}; padding:2px 6px; border-radius:4px; font-size:7px; margin:1px; border:1px solid ${BRAND.dangerLine};">missing</span>`,
        );
      }
    });
    if (attHtml.length === 0)
      attHtml.push(`<span style="color:${BRAND.faint}; font-size:10px;">—</span>`);
  }

  let detailHtml = "";

  if (isFailure && errorDetails) {
    detailHtml += `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px; border-collapse:collapse;">
            <tr><td style="background:${BRAND.dangerBg}; border-left:3px solid ${BRAND.danger}; padding:8px 10px; border-radius:0 6px 6px 0; font-family:'Segoe UI',Arial,sans-serif;" class="r-detail-pad">
                <div style="font-size:8px; font-weight:800; color:${BRAND.danger}; margin-bottom:3px; letter-spacing:1px; text-transform:uppercase;">Error</div>
                <pre class="log-pre" style="margin:0; font-size:8px; white-space:pre; overflow:auto; word-break:break-all; color:${BRAND.bodyText}; max-height:130px; font-family:'Courier New',monospace; background:#fff; padding:6px 8px; border-radius:4px; border:1px solid ${BRAND.dangerLine}; line-height:1.4;">${escapeHtml(errorDetails)}</pre>
            </td></tr>
        </table>`;
  }

  if (hasWarning && allWarnings.length > 0) {
    const items = allWarnings
      .map(
        (w) =>
          `<div style="font-size:8px; color:${BRAND.warning}; padding:2px 0 2px 10px; border-left:2px solid ${BRAND.warningLine}; margin-top:3px; line-height:1.4; overflow-x:auto; word-break:break-all;">${escapeHtml(w)}</div>`,
      )
      .join("");
    detailHtml += `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px; border-collapse:collapse;">
            <tr><td style="background:${BRAND.warningBg}; border-left:3px solid ${BRAND.warning}; padding:8px 10px; border-radius:0 6px 6px 0; font-family:'Segoe UI',Arial,sans-serif;" class="r-detail-pad">
                <div style="font-size:8px; font-weight:800; color:${BRAND.warning}; margin-bottom:2px; letter-spacing:1px; text-transform:uppercase;">Warnings (${allWarnings.length})</div>
                ${items}
            </td></tr>
        </table>`;
  }

  if (hasSkippedLogic && allSkippedSteps.length > 0) {
    const items = allSkippedSteps
      .map(
        (s) =>
          `<div style="font-size:8px; color:${BRAND.skip}; padding:2px 0 2px 10px; border-left:2px solid ${BRAND.skipLine}; margin-top:3px; line-height:1.4; overflow-x:auto; word-break:break-all;">${escapeHtml(s.reason || s)}${s.flow ? ` <span style="color:${BRAND.skip}; font-size:7px; opacity:0.7;">[${s.flow}]</span>` : ""}</div>`,
      )
      .join("");
    detailHtml += `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px; border-collapse:collapse;">
            <tr><td style="background:${BRAND.skipBg}; border-left:3px solid ${BRAND.skip}; padding:8px 10px; border-radius:0 6px 6px 0; font-family:'Segoe UI',Arial,sans-serif;" class="r-detail-pad">
                <div style="font-size:8px; font-weight:800; color:${BRAND.skip}; margin-bottom:2px; letter-spacing:1px; text-transform:uppercase;">Skipped Steps (${allSkippedSteps.length})</div>
                ${items}
            </td></tr>
        </table>`;
  }

  let logsHtml = "";
  if (logs && logLineCount > 0) {
    logsHtml = `
        <div class="log-container" style="margin-top:6px;">
            <details style="border:1px solid ${BRAND.navySoft}; border-radius:6px; overflow:hidden;">
                <summary style="cursor:pointer; font-size:8px; color:#93C5FD; font-family:'Segoe UI',Arial,sans-serif; letter-spacing:1px; padding:5px 8px; background:${BRAND.navy}; text-transform:uppercase; font-weight:600;">
                    Logs (${logLineCount})
                </summary>
                <pre class="log-pre" style="background:${BRAND.navyDark}; color:#B7C4D6; padding:10px; max-height:220px; font-size:7px; font-family:'Courier New',monospace; margin:0; line-height:1.5; border-top:1px solid ${BRAND.navySoft};">${escapeHtml(logs)}</pre>
            </details>
        </div>`;
  } else {
    logsHtml = `<div style="margin-top:4px;"><span style="font-size:8px; color:${BRAND.faint}; font-style:italic;">No logs captured</span></div>`;
  }

  const fileName = test.location?.file
    ? path.basename(test.location.file)
    : "—";
  const prioMatch = test.title.match(/\[(P\d+)\]/);
  const prioColors = {
    P0: { bg: BRAND.dangerBg, c: BRAND.danger, b: BRAND.dangerLine },
    P1: { bg: BRAND.warningBg, c: BRAND.warning, b: BRAND.warningLine },
  };
  const pc = prioMatch
    ? prioColors[prioMatch[1]] || { bg: BRAND.accentSoft, c: BRAND.accent, b: "#BFDBFE" }
    : null;
  const prioBadge = prioMatch
    ? `<span style="display:inline-block; background:${pc.bg}; color:${pc.c}; padding:1px 5px; border-radius:3px; font-size:7px; font-weight:800; letter-spacing:0.5px; margin-left:3px; vertical-align:middle; border:1px solid ${pc.b};">${prioMatch[1]}</span>`
    : "";

  const cleanTitle = test.title.replace(/\[(P\d+)\]\s*/, "");

  const mobileMetaHtml = `
    <div class="resp-show" style="display:none; margin-bottom:4px;">
        <span style="font-size:7px; color:${BRAND.muted}; font-family:'Courier New',monospace; background:${BRAND.neutralBg}; padding:2px 5px; border-radius:3px; border:1px solid ${BRAND.line};" class="r-file-chip">${escapeHtml(fileName)}</span>
        <span style="font-size:7px; color:${BRAND.faint}; margin-left:4px;">${formatDuration(duration)}</span>
    </div>`;

  return `
    <tr><td colspan="4" style="padding:3px 12px 1px 12px; background:transparent;"></td></tr>
    <tr style="background:${rowBg};">
        <td class="resp-hide" style="padding:10px 10px; vertical-align:top; border-bottom:1px solid ${BRAND.line}; width:95px; font-family:'Segoe UI',Arial,sans-serif;">
            <div style="font-size:8px; color:${BRAND.muted}; font-family:'Courier New',monospace; background:${BRAND.neutralBg}; padding:3px 5px; border-radius:3px; border:1px solid ${BRAND.line}; word-break:break-all;">${escapeHtml(fileName)}</div>
            <div style="color:${BRAND.faint}; margin-top:5px; font-size:8px; font-weight:600;">${formatDuration(duration)}</div>
        </td>
        <td style="padding:10px 12px; vertical-align:top; border-bottom:1px solid ${BRAND.line}; font-family:'Segoe UI',Arial,sans-serif;" class="resp-full r-td">
            ${mobileMetaHtml}
            <div style="font-size:11px; font-weight:700; color:${BRAND.ink}; line-height:1.4;" class="r-test-name">${escapeHtml(cleanTitle)}${prioBadge}</div>
            ${detailHtml}
            ${logsHtml}
        </td>
        <td style="padding:10px 6px; vertical-align:middle; text-align:center; border-bottom:1px solid ${BRAND.line}; width:80px;" class="resp-center r-td">
            <div style="display:inline-block; padding:4px 8px; border-radius:14px; background:${bgCard}; color:${color}; font-weight:800; font-size:8px; letter-spacing:0.3px; font-family:'Segoe UI',Arial,sans-serif; border:1px solid ${borderColor};">
                ${label}
            </div>
        </td>
        <td class="resp-hide" style="padding:10px 10px; vertical-align:top; border-bottom:1px solid ${BRAND.line}; width:115px;">
            ${attHtml.join("")}
        </td>
    </tr>`;
}

// ============================================================
// REPORTER
// ============================================================

class EmailReporter {
  constructor() {
    this.testRuns = new Map();
    this.stats = {
      passed: 0,
      failed: 0,
      skipped: 0,
      warning_tests: 0,
      skipped_logic_tests: 0,
    };
    this.workers = 1;
  }

  onBegin(config, suite) {
    this.workers = config.workers || 1;
    if (!process.env.CI) clearDiagnosticsFolder();
  }

  onTestEnd(test, result) {
    this.testRuns.set(test.id, { test, result });
  }

  async onEnd() {
    const allTests = [];
    for (const { test, result } of this.testRuns.values()) {
      const diag = readDiagnostics(test.testId, test.title);

      let rawLogs = "";

      if (diag && diag.infos && diag.infos.length > 0) {
        rawLogs = stripAnsi(formatInfosAsLogs(diag.infos, test.title));
      } else {
        const terminalOut = extractTerminalOutput(result);
        if (terminalOut) {
          rawLogs = filterTerminalLogsForTest(terminalOut, test.title);
        }
      }

      if (
        diag &&
        diag.browserConsole &&
        diag.browserConsole.length > 0 &&
        (diag.errors?.length > 0 || diag.warnings?.length > 0)
      ) {
        const browserLogs = stripAnsi(diag.browserConsole.join("\n"));
        if (browserLogs) {
          rawLogs = rawLogs
            ? rawLogs + "\n\n[BROWSER CONSOLE]\n" + browserLogs
            : "[BROWSER CONSOLE]\n" + browserLogs;
        }
      }

      const logs = truncateText(stripAnsi(rawLogs), 300);
      const logLineCount = logs
        ? logs.split("\n").filter((l) => l.trim()).length
        : 0;

      let errorDetails = null;
      if (result.error) {
        errorDetails = "Error: " + result.error.message;
        if (result.error.stack) errorDetails += "\n\n" + result.error.stack;
      } else if (diag && diag.errors && diag.errors.length > 0) {
        errorDetails = diag.errors
          .map((e) => {
            const meta = e.meta ? " " + JSON.stringify(e.meta) : "";
            return `[ERROR] ${e.time} - ${e.message}${meta}`;
          })
          .join("\n");
      }
      if (errorDetails) errorDetails = stripAnsi(errorDetails);

      let allWarnings = diag
        ? [...new Set(diag.warnings.map((w) => w.message))]
        : [];
      if (allWarnings.length === 0) {
        const terminalOut = extractTerminalOutput(result);
        if (terminalOut) {
          const terminalWarnings = extractAllWarnings(terminalOut, test.title);
          if (terminalWarnings.length > 0) {
            allWarnings = terminalWarnings;
            console.log(
              `[REPORTER] Using ${terminalWarnings.length} warnings from terminal fallback for: ${test.title}`,
            );
          }
        }
      }

      let allSkippedSteps = diag && diag.skippedSteps ? diag.skippedSteps : [];
      if (allSkippedSteps.length === 0) {
        const terminalOut = extractTerminalOutput(result);
        if (terminalOut) {
          const lines = terminalOut.split("\n");
          const skippedFromTerminal = [];
          for (const line of lines) {
            if (
              test.title &&
              line.includes("(") &&
              !line.includes(`(${test.title})`)
            ) {
              continue;
            }
            const m = line.match(/\[SKIPPED\].*?-\s*(.+)/);
            if (m)
              skippedFromTerminal.push({ reason: m[1].trim(), flow: null });
          }
          if (skippedFromTerminal.length > 0) {
            allSkippedSteps = skippedFromTerminal;
            console.log(
              `[REPORTER] Using ${skippedFromTerminal.length} skipped steps from terminal fallback for: ${test.title}`,
            );
          }
        }
      }

      const isFailure =
        result.status === "failed" || result.status === "timedOut";
      const isTestSkipped = result.status === "skipped";
      const hasWarning = allWarnings.length > 0;
      const hasSkippedLogic = allSkippedSteps.length > 0;

      console.log(
        `[REPORTER] ${test.title}: failure=${isFailure} hasWarning=${hasWarning}(${allWarnings.length}) hasSkippedLogic=${hasSkippedLogic}(${allSkippedSteps.length}) diag=${diag ? "found" : "NULL"}`,
      );

      if (isFailure) this.stats.failed++;
      else if (isTestSkipped) this.stats.skipped++;
      else if (hasWarning) this.stats.warning_tests++;
      else if (hasSkippedLogic) this.stats.skipped_logic_tests++;
      else if (result.status === "passed") this.stats.passed++;
      else this.stats.skipped++;

      const rawAttachments = result.attachments || [];
      const shouldAttach =
        isFailure || hasWarning || hasSkippedLogic || isTestSkipped;
      let videos = [],
        images = [];
      if (shouldAttach) {
        images = rawAttachments.filter(
          (a) => a.path && /\.(png|jpg|jpeg|gif|webp)$/i.test(a.path),
        );
        videos = rawAttachments.filter(
          (a) => a.path && /\.(webm|mp4|mkv)$/i.test(a.path),
        );
      }

      if (
        shouldAttach &&
        videos.length === 0 &&
        diag &&
        diag.videoPath &&
        fs.existsSync(diag.videoPath)
      ) {
        videos.push({
          name: path.basename(diag.videoPath),
          path: diag.videoPath,
          contentType: "video/webm",
        });
      }

      if (shouldAttach && videos.length === 0) {
        const foundVideo = findVideoForTest(test.title);
        if (foundVideo && fs.existsSync(foundVideo)) {
          videos.push({
            name: path.basename(foundVideo),
            path: foundVideo,
            contentType: "video/webm",
          });
        }
      }

      allTests.push({
        test,
        result,
        logs,
        logLineCount,
        errorDetails,
        allWarnings,
        allSkippedSteps,
        videos,
        images,
        hasWarning,
        hasSkippedLogic,
        isFailure,
        isTestSkipped,
        isPassed: !isFailure && !hasWarning && !hasSkippedLogic,
        duration: result.duration || 0,
      });
    }

    // ============================================================
    // TIME CALCULATIONS
    // ============================================================
    const completionDate = new Date();
    const time = formatCompletionTime(completionDate);
    const totalTests =
      this.stats.passed +
      this.stats.failed +
      this.stats.warning_tests +
      this.stats.skipped_logic_tests +
      this.stats.skipped;

    let earliestStart = Infinity;
    let latestEnd = 0;
    let totalMs = 0;
    for (const item of allTests) {
      totalMs += item.duration;
      const start = item.result.startTime
        ? new Date(item.result.startTime).getTime()
        : 0;
      const end = start + item.duration;
      if (start > 0 && start < earliestStart) earliestStart = start;
      if (end > latestEnd) latestEnd = end;
    }
    const wallClockMs =
      earliestStart < Infinity && latestEnd > 0
        ? latestEnd - earliestStart
        : totalMs;
    const wallClock = formatDuration(wallClockMs);
    const totalDuration = formatDuration(totalMs);
    const workers = this.workers;

    // ============================================================
    // EMAIL 1: Daily Summary
    // ============================================================
    if (process.env.DAILY_REPORT_EMAILS?.trim()) {
      let summaryLabel, summaryColor, summaryBg, summaryLine;
      if (this.stats.failed > 0) {
        summaryLabel = "Failures Detected";
        summaryColor = BRAND.danger;
        summaryBg = BRAND.dangerBg;
        summaryLine = BRAND.dangerLine;
      } else if (this.stats.warning_tests > 0) {
        summaryLabel = "Warnings Found";
        summaryColor = BRAND.warning;
        summaryBg = BRAND.warningBg;
        summaryLine = BRAND.warningLine;
      } else if (this.stats.skipped_logic_tests > 0 || this.stats.skipped > 0) {
        summaryLabel = "Skipped Steps Found";
        summaryColor = BRAND.skip;
        summaryBg = BRAND.skipBg;
        summaryLine = BRAND.skipLine;
      } else {
        summaryLabel = "All Tests Passed";
        summaryColor = BRAND.success;
        summaryBg = BRAND.successBg;
        summaryLine = BRAND.successLine;
      }

      const subject =
        this.stats.failed > 0
          ? `[Datastore QA] ${this.stats.failed} Failed · ${this.stats.warning_tests} Warnings · ${this.stats.skipped_logic_tests} Skipped`
          : this.stats.warning_tests > 0
            ? `[Datastore QA] ${this.stats.warning_tests} Warnings · ${this.stats.skipped_logic_tests} Skipped`
            : this.stats.skipped_logic_tests > 0 || this.stats.skipped > 0
              ? `[Datastore QA] ${this.stats.skipped_logic_tests} Skipped Steps`
              : `[Datastore QA] All ${this.stats.passed} Tests Passed`;

      const html = wrapBody(`
                ${buildHeader(LOGO_CID)}
                ${buildTimeBar(time, wallClock, totalDuration, totalTests, workers)}
                ${buildStatsBar(this.stats, totalTests)}
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr><td style="padding:14px 20px 22px 20px;" class="resp-pad">
                        <table width="100%" cellpadding="0" cellspacing="0" style="background:${summaryBg}; border:1px solid ${summaryLine}; border-radius:10px; overflow:hidden;">
                            <tr><td align="center" style="padding:16px 16px; font-family:'Segoe UI',Arial,sans-serif;">
                                <div style="font-size:12px; font-weight:800; color:${summaryColor}; letter-spacing:1.5px; text-transform:uppercase;">${summaryLabel}</div>
                                <div style="font-size:9px; color:${BRAND.muted}; margin-top:6px;">
                                    ${this.stats.passed} passed &nbsp;·&nbsp; ${this.stats.failed} failed &nbsp;·&nbsp; ${this.stats.warning_tests} warnings &nbsp;·&nbsp; ${this.stats.skipped_logic_tests} skipped logic &nbsp;·&nbsp; ${this.stats.skipped} skipped
                                </div>
                            </td></tr>
                        </table>
                    </td></tr>
                </table>
                ${buildFooter()}
            `);

      try {
        await this._sendMail(
          process.env.DAILY_REPORT_EMAILS,
          subject,
          "",
          html,
          [],
        );
        console.log(`📧 Daily summary sent`);
      } catch (err) {
        console.error("❌ Failed daily summary:", err);
      }
    }

    // ============================================================
    // EMAIL 2: Detailed Report with attachments
    // ============================================================
    if (process.env.FAILURE_ALERT_EMAILS?.trim()) {
      const finalAttachments = [];
      let totalSize = 0;
      const MAX_SIZE = 20 * 1024 * 1024;

      const addAttachment = (att) => {
        if (!att.path || !fs.existsSync(att.path)) return false;
        const fstats = fs.statSync(att.path);
        if (totalSize + fstats.size > MAX_SIZE) return false;
        totalSize += fstats.size;
        finalAttachments.push({
          filename: att.name || path.basename(att.path),
          path: att.path,
          contentType: att.contentType || "application/octet-stream",
        });
        return true;
      };

      const sortedTests = sortTestsByDefinitionOrder(allTests);

      const tableHeader = `
            <tr style="background:${BRAND.neutralBg};">
                <th class="resp-hide r-th" style="padding:10px 10px; text-align:left; font-size:8px; color:${BRAND.muted}; text-transform:uppercase; letter-spacing:1.2px; font-weight:700; border-bottom:2px solid ${BRAND.line}; width:95px;">File</th>
                <th class="r-th" style="padding:10px 12px; text-align:left; font-size:8px; color:${BRAND.muted}; text-transform:uppercase; letter-spacing:1.2px; font-weight:700; border-bottom:2px solid ${BRAND.line};">Test Case</th>
                <th class="r-th resp-center" style="padding:10px 6px; text-align:center; font-size:8px; color:${BRAND.muted}; text-transform:uppercase; letter-spacing:1.2px; font-weight:700; border-bottom:2px solid ${BRAND.line}; width:80px;">Status</th>
                <th class="resp-hide r-th" style="padding:10px 10px; text-align:left; font-size:8px; color:${BRAND.muted}; text-transform:uppercase; letter-spacing:1.2px; font-weight:700; border-bottom:2px solid ${BRAND.line}; width:115px;">Artifacts</th>
            </tr>`;

      const tableRows = sortedTests
        .map((item, idx) => buildTestRow(item, addAttachment, idx))
        .join("");

      const subject = `[Datastore QA] Detailed Report — ${this.stats.passed} Passed, ${this.stats.failed} Failed, ${this.stats.warning_tests} Warnings, ${this.stats.skipped_logic_tests} Skipped`;

      const html = wrapBody(`
                ${buildHeader(LOGO_CID)}
                ${buildTimeBar(time, wallClock, totalDuration, totalTests, workers)}
                ${buildStatsBar(this.stats, totalTests)}
                ${buildSectionTitle("Test Results")}
                <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 12px 8px 12px; border:1px solid ${BRAND.line}; border-radius:10px; overflow:hidden;">
                    ${tableHeader}
                    ${tableRows}
                </table>
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr><td align="center" style="padding:2px 20px 6px 20px; font-family:'Segoe UI',Arial,sans-serif; font-size:8px; color:${BRAND.faint};" class="r-footer">
                        ${(totalSize / (1024 * 1024)).toFixed(2)} MB attached &nbsp;·&nbsp; Passed rows have no artifacts &nbsp;·&nbsp; Failed / Warning / Skipped rows include screenshots and video where available
                    </td></tr>
                </table>
                ${buildFooter()}
            `);

      try {
        await this._sendMail(
          process.env.FAILURE_ALERT_EMAILS,
          subject,
          "",
          html,
          finalAttachments,
        );
        console.log(
          `📧 Detailed report sent to: ${process.env.FAILURE_ALERT_EMAILS}`,
        );
        console.log(
          `📊 Attachments: ${finalAttachments.length} files, ${(totalSize / (1024 * 1024)).toFixed(2)} MB`,
        );
      } catch (err) {
        console.error("❌ Failed detailed report:", err);
      }
    }
  }

  async _sendMail(to, subject, text, html, attachments = []) {
    if (!to?.trim()) throw new Error("No email recipients configured");
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS are required");
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true" || false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const finalAttachments = [...attachments];

    if (fs.existsSync(LOGO_PATH)) {
      finalAttachments.push({
        filename: "Datastore_Logo.png",
        path: LOGO_PATH,
        cid: LOGO_CID,
        contentDisposition: "inline",
      });
    } else {
      console.warn(`⚠️ Logo not found at ${LOGO_PATH}`);
    }

    return transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
      attachments: finalAttachments,
    });
  }
}

module.exports = EmailReporter;
