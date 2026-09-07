import { execFile } from "node:child_process";
import type { OmpUpdateCheckResult, OmpUpdateResult } from "../shared/ipc";
import { resolveOmpPath } from "./omp-locate";

/**
 * Parse a semver string into [major, minor, patch].
 */
export function parseSemver(v: string): [number, number, number] | null {
  const clean = v.trim().replace(/^v/i, "");
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(clean);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Check if a string is a valid semver version.
 */
export function isValidSemver(v: string | undefined | null): boolean {
  if (!v || typeof v !== "string") return false;
  return parseSemver(v) !== null;
}

/**
 * Compare two semver strings: returns true if latest is strictly newer than current.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const l = parseSemver(latest);
  const c = parseSemver(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true;
    if (l[i] < c[i]) return false;
  }
  return false;
}

/**
 * Parse version output from `omp update --check`.
 */
export function parseOmpUpdateCheckOutput(output: string): {
  updateAvailable: boolean;
  currentVersion?: string;
  latestVersion?: string;
} {
  const isUpToDate = /Already up to date/i.test(output);

  const currentMatch = /Current version:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i.exec(output);
  const latestMatch =
    /New version available:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i.exec(output) ??
    /New version\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s+is available/i.exec(output);

  const currentVersion = currentMatch?.[1]?.trim();
  const latestVersion = latestMatch?.[1]?.trim();

  if (isUpToDate || !latestVersion || !isValidSemver(latestVersion)) {
    return {
      updateAvailable: false,
      currentVersion: isValidSemver(currentVersion) ? currentVersion : undefined,
      latestVersion: undefined,
    };
  }

  let updateAvailable = true;
  if (currentVersion && isValidSemver(currentVersion)) {
    updateAvailable = isNewerVersion(latestVersion, currentVersion);
  }

  return {
    updateAvailable,
    currentVersion,
    latestVersion,
  };
}

/**
 * Check if a newer version of OMP is available.
 */
export async function checkOmpUpdate(overridePath?: string): Promise<OmpUpdateCheckResult> {
  let exe: string;
  try {
    exe = resolveOmpPath(overridePath);
  } catch (err) {
    return {
      updateAvailable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return new Promise<OmpUpdateCheckResult>((resolve) => {
    execFile(exe, ["update", "--check"], { timeout: 15000, env: process.env }, (err, stdout, stderr) => {
      const combined = `${stdout || ""}\n${stderr || ""}`.trim();
      const parsed = parseOmpUpdateCheckOutput(combined);

      if (err) {
        if (parsed.latestVersion) {
          resolve(parsed);
          return;
        }
        resolve({
          updateAvailable: false,
          error: err.message || combined || "Failed to check for OMP updates",
        });
        return;
      }

      resolve(parsed);
    });
  });
}

/**
 * Run `omp update` to download and install the latest OMP release.
 */
export async function performOmpUpdate(overridePath?: string): Promise<OmpUpdateResult> {
  let exe: string;
  try {
    exe = resolveOmpPath(overridePath);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return new Promise<OmpUpdateResult>((resolve) => {
    execFile(
      exe,
      ["update"],
      {
        timeout: 180000,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const combined = `${stdout || ""}\n${stderr || ""}`.trim();
        if (err) {
          resolve({
            success: false,
            error: err.message || combined || "Failed to update OMP",
            output: combined,
          });
          return;
        }
        resolve({
          success: true,
          output: combined,
        });
      },
    );
  });
}
