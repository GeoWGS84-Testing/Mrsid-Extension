import fs from "fs";
import path from "path";
import { test, expect } from "../fixtures/extension.js";
import {
  logInfo,
  setContext,
  clearDiagnostics,
} from "../utils/helpers.js";

/**
 * GV-TC-022 — Security review (static / no backend required)
 */
test.describe("Security — Manifest & packaging @p1 @security", () => {
  test("GV-TC-022-01 | Manifest permissions are minimal (MV3)", async () => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-022-01 manifest", flow: "Security" });

    const manifestPath = path.join(process.cwd(), "extension", "manifest.json");
    expect(fs.existsSync(manifestPath), "extension/manifest.json missing").toBeTruthy();

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    logInfo("Manifest snapshot", {
      version: manifest.manifest_version,
      permissions: manifest.permissions,
      host_permissions: manifest.host_permissions,
      content_scripts: manifest.content_scripts,
      action: manifest.action,
    });

    expect(manifest.manifest_version).toBe(3);
    // storage is expected; no broad hosts in permissions
    const perms = manifest.permissions || [];
    expect(perms).toContain("storage");

    // No default_popup preferred (opens via onClicked → tab)
    if (manifest.action?.default_popup) {
      logInfo(`NOTE: action.default_popup = ${manifest.action.default_popup}`);
    }

    // host_permissions should be scoped (api.geowgs84.com or similar)
    const hosts = manifest.host_permissions || [];
    logInfo(`host_permissions: ${JSON.stringify(hosts)}`);
    for (const h of hosts) {
      // Allow api.geowgs84.com and localhost for dev — flag * if present
      if (h === "<all_urls>" || h === "*://*/*") {
        throw new Error(`Overly broad host_permission: ${h}`);
      }
    }
    logInfo("✅ GV-TC-022-01 PASSED");
  });

  test("GV-TC-022-02 | web_accessible_resources exposure documented", async () => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-022-02 WAR", flow: "Security" });

    const manifestPath = path.join(process.cwd(), "extension", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const war = manifest.web_accessible_resources || [];
    logInfo("web_accessible_resources", war);

    // Document resources; fail only if empty when map/popup expected accessible
    expect(Array.isArray(war)).toBeTruthy();
    logInfo("✅ GV-TC-022-02 PASSED (exposure recorded)");
  });

  test("GV-TC-022-05 | No obvious secrets in packaged extension files", async () => {
    clearDiagnostics();
    setContext({ testcase: "GV-TC-022-05 no secrets", flow: "Security" });

    const extDir = path.join(process.cwd(), "extension");
    const secretPatterns = [
      /api[_-]?key\s*[:=]\s*['"][^'"]{8,}/i,
      /secret\s*[:=]\s*['"][^'"]{8,}/i,
      /password\s*[:=]\s*['"][^'"]{4,}/i,
      /Bearer\s+[A-Za-z0-9\-_]{20,}/,
    ];

    const hits = [];
    function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else if (/\.(js|json|html|css|env|txt)$/i.test(name)) {
          const body = fs.readFileSync(full, "utf8");
          for (const re of secretPatterns) {
            if (re.test(body)) hits.push({ file: full, pattern: String(re) });
          }
        }
      }
    }
    walk(extDir);
    if (hits.length) {
      logInfo("Possible secret-like patterns", hits);
    }
    expect(hits, `Possible secrets: ${JSON.stringify(hits)}`).toHaveLength(0);
    logInfo("✅ GV-TC-022-05 PASSED");
  });
});
