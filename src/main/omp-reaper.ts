import { execFileSync } from "node:child_process";
import { system32 } from "./elevation";

/**
 * Kills only omp worker processes whose parent is gone (or whose parent PID was reused by a newer
 * process). Workers of a live omp in any terminal have a live, older parent and are skipped.
 * Constant string: no interpolated input.
 */
const SWEEP_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$all = @(Get-CimInstance Win32_Process)
$byId = @{}
foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
foreach ($p in $all) {
  if ($p.Name -ne 'omp.exe' -or $p.CommandLine -notmatch '__omp_worker_') { continue }
  $parent = $byId[[int]$p.ParentProcessId]
  if ($parent -and $parent.CreationDate -le $p.CreationDate) { continue }
  & "$env:SystemRoot\\System32\\taskkill.exe" /PID $p.ProcessId /T /F | Out-Null
}
`;

/**
 * Kill each pid plus all descendants while the parent link still exists. Synchronous on purpose:
 * PiShift is exiting and an async child would be cut off.
 */
export function killProcessTrees(pids: number[]): void {
  if (process.platform !== "win32") return;
  const valid = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (valid.length === 0) return;
  try {
    execFileSync(
      system32("taskkill.exe"),
      ["/T", "/F", ...valid.flatMap((p) => ["/PID", String(p)])],
      { windowsHide: true, stdio: "ignore", timeout: 3000 },
    );
  } catch {
    // exit 128 = already gone; a timeout must never block quitting
  }
}

/**
 * Reap orphaned omp workers. Synchronous: a detached child is not guaranteed to survive PiShift
 * exiting (job objects), so the sweep must finish before quit continues.
 */
export function sweepOrphanOmpWorkers(): void {
  if (process.platform !== "win32") return;
  try {
    execFileSync(
      system32("WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", SWEEP_SCRIPT],
      { windowsHide: true, stdio: "ignore", timeout: 6000 },
    );
  } catch {
    // best effort; a timeout must never block quitting
  }
}
