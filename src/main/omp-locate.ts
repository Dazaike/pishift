import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const EXE = process.platform === "win32" ? "omp.exe" : "omp";

/**
 * Resolve the omp executable. First hit wins: an explicit override from settings,
 * the standard per-user install location, then `PATH`.
 */
export function resolveOmpPath(override?: string): string {
  if (override && existsSync(override)) return override;

  const local = process.env.LOCALAPPDATA;
  if (local) {
    const candidate = join(local, "omp", EXE);
    if (existsSync(candidate)) return candidate;
  }

  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, EXE);
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(`${EXE} not found — set ompPath in settings`);
}
