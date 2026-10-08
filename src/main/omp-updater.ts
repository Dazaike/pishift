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
 * Parse version output from `omp update --check`. `recognized` is false when the text matches
 * none of the known shapes, so format drift is reported instead of read as "up to date".
 */
export function parseOmpUpdateCheckOutput(output: string): {
  updateAvailable: boolean;
  currentVersion?: string;
  latestVersion?: string;
  recognized: boolean;
} {
  const isUpToDate = /Already up to date/i.test(output);

  const currentMatch = /Current version:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i.exec(output);
  const latestMatch =
    /New version available:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i.exec(output) ??
    /New version\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s+is available/i.exec(output);
  const recognized = isUpToDate || Boolean(currentMatch) || Boolean(latestMatch);

  const currentVersion = currentMatch?.[1]?.trim();
  const latestVersion = latestMatch?.[1]?.trim();

  if (isUpToDate || !latestVersion || !isValidSemver(latestVersion)) {
    return {
      updateAvailable: false,
      currentVersion: isValidSemver(currentVersion) ? currentVersion : undefined,
      latestVersion: undefined,
      recognized,
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
    recognized,
  };
}

const CHECK_TIMEOUT_MS = 45_000;
// The release binary is ~240 MB; a slow link must not be killed mid-download.
const UPDATE_TIMEOUT_MS = 600_000;
const VERSION_TIMEOUT_MS = 10_000;
const CHECK_RETRY_DELAY_MS = 2_000;
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

type RunResult = { err: Error | null; combined: string; timedOut: boolean };

/** Runs omp without a console window and with stdin closed, so an interactive prompt can never hang to the timeout. */
function run(exe: string, args: string[], timeoutMs: number): Promise<RunResult> {
  const { promise, resolve } = Promise.withResolvers<RunResult>();
  const child = execFile(
    exe,
    args,
    { timeout: timeoutMs, env: process.env, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout, stderr) => {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      const killed = Boolean(err && (err as Error & { killed?: boolean }).killed);
      resolve({
        err,
        combined: `${stdout || ""}\n${stderr || ""}`.trim(),
        // A maxBuffer overflow also kills the child, but is not a timeout.
        timedOut: killed && code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      });
    },
  );
  child.stdin?.end();
  return promise;
}

/** One-line failure reason: the timeout, else the tail of omp's own output, else the process error. */
function summarizeFailure(err: Error, combined: string, timedOut: boolean, timeoutMs: number): string {
  if (timedOut) {
    return timeoutMs < 120_000
      ? `Timed out after ${Math.round(timeoutMs / 1000)} s`
      : `Timed out after ${Math.round(timeoutMs / 60_000)} min`;
  }
  const tail = combined
    .replace(ANSI_ESCAPE, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3);
  return tail.length > 0 ? tail.join(" | ") : err.message || "Unknown error";
}

async function checkOnce(exe: string): Promise<OmpUpdateCheckResult> {
  const { err, combined, timedOut } = await run(exe, ["update", "--check"], CHECK_TIMEOUT_MS);
  const { recognized, ...parsed } = parseOmpUpdateCheckOutput(combined);

  if (err) {
    // A non-zero exit that still names a newer version is a usable answer.
    if (parsed.latestVersion) return parsed;
    return { updateAvailable: false, error: summarizeFailure(err, combined, timedOut, CHECK_TIMEOUT_MS) };
  }
  if (!recognized) {
    return {
      updateAvailable: false,
      error: `Unrecognized output from "omp update --check": ${combined.slice(0, 200)}`,
    };
  }
  return parsed;
}

/**
 * Check if a newer version of OMP is available. A failed check carries `error`; it is never
 * reported as "up to date". One retry covers a transient network blip.
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

  const first = await checkOnce(exe);
  if (!first.error) return first;
  const { promise: delay, resolve: elapsed } = Promise.withResolvers<void>();
  setTimeout(elapsed, CHECK_RETRY_DELAY_MS);
  await delay;
  return checkOnce(exe);
}

async function runUpdate(overridePath: string | undefined, expectedVersion: string | undefined): Promise<OmpUpdateResult> {
  let exe: string;
  try {
    exe = resolveOmpPath(overridePath);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const { err, combined, timedOut } = await run(exe, ["update"], UPDATE_TIMEOUT_MS);
  if (err) {
    return { success: false, error: summarizeFailure(err, combined, timedOut, UPDATE_TIMEOUT_MS), output: combined };
  }

  // Exit code 0 alone does not prove the binary changed; confirm the installed version.
  const wanted = expectedVersion?.trim().replace(/^v/i, "");
  if (wanted && isValidSemver(wanted)) {
    const probe = await run(exe, ["--version"], VERSION_TIMEOUT_MS);
    const found = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(probe.combined)?.[1];
    // No version token (older/odd output): trust the exit code rather than fail a good update.
    if (found && found !== wanted) {
      return {
        success: false,
        error: `omp update finished but omp --version still reports ${found} (expected ${wanted})`,
        output: combined,
      };
    }
  }
  return { success: true, output: combined };
}

let inflight: Promise<OmpUpdateResult> | null = null;

/**
 * Run `omp update` to download and install the latest OMP release. Single-flight: a call made
 * while an update is running joins it instead of starting a second concurrent install.
 */
export function performOmpUpdate(overridePath?: string, expectedVersion?: string): Promise<OmpUpdateResult> {
  inflight ??= runUpdate(overridePath, expectedVersion).finally(() => {
    inflight = null;
  });
  return inflight;
}
