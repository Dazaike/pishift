// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { checkOmpUpdate, isNewerVersion, isValidSemver, parseOmpUpdateCheckOutput } from "../src/main/omp-updater";
import { StateStore } from "../src/main/state-store";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("parseOmpUpdateCheckOutput", () => {
  it("parses standard omp update --check output with new version", () => {
    const output = `
Current version: 18.1.11
New version available: 18.1.13
`;
    const res = parseOmpUpdateCheckOutput(output);
    expect(res.updateAvailable).toBe(true);
    expect(res.currentVersion).toBe("18.1.11");
    expect(res.latestVersion).toBe("18.1.13");
  });

  it("parses startup terminal notice format", () => {
    const output = `
Update Available
New version 18.1.13 is available
Run omp update to update
`;
    const res = parseOmpUpdateCheckOutput(output);
    expect(res.updateAvailable).toBe(true);
    expect(res.latestVersion).toBe("18.1.13");
  });

  it("returns updateAvailable: false when already up to date", () => {
    const output = `
Current version: 18.1.13
Already up to date
`;
    const res = parseOmpUpdateCheckOutput(output);
    expect(res.updateAvailable).toBe(false);
    expect(res.currentVersion).toBe("18.1.13");
    expect(res.latestVersion).toBeUndefined();
  });

  it("returns updateAvailable: false when current and latest version are identical", () => {
    const output = `
Current version: 18.1.13
New version available: 18.1.13
`;
    const res = parseOmpUpdateCheckOutput(output);
    expect(res.updateAvailable).toBe(false);
    expect(res.currentVersion).toBe("18.1.13");
    expect(res.latestVersion).toBe("18.1.13");
  });

  it("handles empty or garbage output gracefully", () => {
    const res = parseOmpUpdateCheckOutput("");
    expect(res.updateAvailable).toBe(false);
    expect(res.currentVersion).toBeUndefined();
    expect(res.latestVersion).toBeUndefined();
  });
  it("rejects non-semver tokens like regex expressions or symbols", () => {
    const output = `
Current version: 18.1.14
New version available: \\s*([^\\s\\r\\n]+)
`;
    const res = parseOmpUpdateCheckOutput(output);
    expect(res.updateAvailable).toBe(false);
    expect(res.latestVersion).toBeUndefined();
  });

  it("returns updateAvailable: false when latest version is older than current version", () => {
    const output = `
Current version: 18.1.14
New version available: 18.1.11
`;
    const res = parseOmpUpdateCheckOutput(output);
    expect(res.updateAvailable).toBe(false);
  });
});

describe("semver helpers", () => {
  it("validates semantic version strings", () => {
    expect(isValidSemver("18.1.14")).toBe(true);
    expect(isValidSemver("v1.9.17")).toBe(true);
    expect(isValidSemver("1.0.0-alpha.1")).toBe(true);
    expect(isValidSemver("\\s*([^\\s\\r\\n]+)")).toBe(false);
    expect(isValidSemver("-")).toBe(false);
    expect(isValidSemver("")).toBe(false);
    expect(isValidSemver(null)).toBe(false);
    expect(isValidSemver(undefined)).toBe(false);
  });

  it("accurately compares version numbers", () => {
    expect(isNewerVersion("18.1.14", "18.1.11")).toBe(true);
    expect(isNewerVersion("18.2.0", "18.1.14")).toBe(true);
    expect(isNewerVersion("19.0.0", "18.9.9")).toBe(true);
    expect(isNewerVersion("18.1.14", "18.1.14")).toBe(false);
    expect(isNewerVersion("18.1.11", "18.1.14")).toBe(false);
  });
});

describe("checkOmpUpdate", () => {
  it("returns graceful error object when binary cannot be resolved without throwing", async () => {
    const origPath = process.env.PATH;
    const origLocal = process.env.LOCALAPPDATA;
    try {
      process.env.PATH = "";
      delete process.env.LOCALAPPDATA;
      const res = await checkOmpUpdate("C:\\non_existent_omp_binary_path_xyz_123.exe");
      expect(res.updateAvailable).toBe(false);
      expect(typeof res.error).toBe("string");
      expect(res.error).toContain("not found");
    } finally {
      process.env.PATH = origPath;
      if (origLocal !== undefined) process.env.LOCALAPPDATA = origLocal;
    }
  });

  it("runs check against system omp binary if available", async () => {
    const res = await checkOmpUpdate();
    // On this system, omp is installed and returns version info
    expect(typeof res.updateAvailable).toBe("boolean");
    if (res.updateAvailable) {
      expect(typeof res.latestVersion).toBe("string");
    }
  });
});

describe("StateStore autoUpdateOmpOnOpen persistence", () => {
  it("whitelists autoUpdateOmpOnOpen when reading persisted state", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pishift-test-"));
    const filePath = join(tempDir, "state.json");
    try {
      writeFileSync(
        filePath,
        JSON.stringify({
          autoUpdateOmpOnOpen: true,
          tabs: [],
          activeIndex: 0,
        }),
        "utf8",
      );
      const store = new StateStore(tempDir, tempDir);
      expect(store.get().autoUpdateOmpOnOpen).toBe(true);

      store.patch({ autoUpdateOmpOnOpen: false });
      expect(store.get().autoUpdateOmpOnOpen).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("index.html OMP update button structure", () => {
  it("places #btn-omp-update directly before #usage-tracker-anchor in .chrome-actions-row", () => {
    const htmlPath = join(__dirname, "../src/renderer/index.html");
    const html = readFileSync(htmlPath, "utf8");
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const updateBtn = doc.getElementById("btn-omp-update");
    expect(updateBtn).not.toBeNull();
    expect(updateBtn?.hasAttribute("hidden")).toBe(true);
    expect(updateBtn?.classList.contains("btn-omp-update")).toBe(true);

    const nextSibling = updateBtn?.nextElementSibling;
    expect(nextSibling?.id).toBe("usage-tracker-anchor");

    const label = updateBtn?.querySelector(".btn-omp-update-label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("Update OMP");

    const ver = updateBtn?.querySelector(".btn-omp-update-version");
    expect(ver).not.toBeNull();
  });

  it("places #header-version in the top far left of #chrome", () => {
    const htmlPath = join(__dirname, "../src/renderer/index.html");
    const html = readFileSync(htmlPath, "utf8");
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const chrome = doc.getElementById("chrome");
    expect(chrome).not.toBeNull();
    const firstChild = chrome?.firstElementChild;
    expect(firstChild?.id).toBe("header-version");
    expect(firstChild?.classList.contains("header-version")).toBe(true);

    const versionText = firstChild?.querySelector("#header-version-text");
    expect(versionText).not.toBeNull();
    expect(versionText?.textContent?.trim()).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it("styles.css enforces display: none !important for #btn-omp-update[hidden]", () => {
    const cssPath = join(__dirname, "../src/renderer/styles.css");
    const css = readFileSync(cssPath, "utf8");
    expect(css).toMatch(/#btn-omp-update\[hidden\][\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/body\.top-bar-as-menu\s+#btn-omp-update/);
  });
});
