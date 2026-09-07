import { execFile } from "node:child_process";
import type { OmpUpdateCheckResult, OmpUpdateResult } from "../shared/ipc";
import { resolveOmpPath } from "./omp-locate";

/**
 * Parse version output from `omp update --check` or startup terminal banners.
 */
export function parseOmpUpdateCheckOutput(output: string): {
  updateAvailable: boolean;
  currentVersion?: string;
  latestVersion?: string;
} {
  const currentMatch = /Current version:\s*([^\s\r\n]+)/i.exec(output);
  const latestMatch =
    /New version available:\s*([^\s\r\n]+)/i.exec(output) ??
    /New version\s+([^\s\r\n]+)\s+is available/i.exec(output);

  const currentVersion = currentMatch?.[1]?.trim();
  const latestVersion = latestMatch?.[1]?.trim();
  const updateAvailable = Boolean(latestVersion && (!currentVersion || latestVersion !== currentVersion));

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
