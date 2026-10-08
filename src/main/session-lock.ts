import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Marker file that exists exactly while the app is running. A clean exit removes it, so finding
 * it at startup means the previous run crashed or was killed.
 */
export class SessionLock {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, "session.lock");
  }

  /** Claims the lock; true when the previous run never released it. */
  acquire(): boolean {
    const stale = existsSync(this.file);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, String(process.pid), "utf8");
    } catch {
      // Best-effort: without the marker a crash simply goes undetected.
    }
    return stale;
  }

  release(): void {
    try {
      rmSync(this.file, { force: true });
    } catch {
      // Best-effort; a leftover marker only causes one false crash prompt.
    }
  }
}
