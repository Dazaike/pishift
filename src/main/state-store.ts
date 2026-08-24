import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PersistedState, TabState } from "../shared/ipc";

const DEBOUNCE_MS = 500;

/** Window bounds, tab list and settings, persisted to `userData/state.json`. */
export class StateStore {
  private readonly file: string;
  private state: PersistedState;
  private timer: NodeJS.Timeout | undefined;

  constructor(userDataDir: string, private readonly homeDir: string) {
    this.file = join(userDataDir, "state.json");
    this.state = this.read();
  }

  private read(): PersistedState {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<PersistedState>;
      const tabs = Array.isArray(raw.tabs)
        ? raw.tabs
            .filter((t): t is TabState => typeof t?.cwd === "string" && existsSync(t.cwd))
            .map((t) => ({
              cwd: t.cwd,
              ...(typeof t.customTitle === "string" && t.customTitle ? { customTitle: t.customTitle } : {}),
            }))
        : [];
      return {
        bounds: raw.bounds,
        ompPath: raw.ompPath,
        themeName: raw.themeName,
        theme: raw.theme,
        favoriteModels: Array.isArray(raw.favoriteModels) ? raw.favoriteModels : undefined,
        customModels: Array.isArray(raw.customModels) ? raw.customModels : undefined,
        showFavoritesOnly: raw.showFavoritesOnly,
        showUsageInHeader: raw.showUsageInHeader,
        tabs,
        activeIndex: Math.min(Math.max(raw.activeIndex ?? 0, 0), Math.max(tabs.length - 1, 0)),
      };
    } catch {
      return { tabs: [], activeIndex: 0 };
    }
  }

  /** Restored tabs, or a single tab at the user's home directory. */
  get(): PersistedState {
    if (this.state.tabs.length === 0) {
      return { ...this.state, tabs: [{ cwd: this.homeDir }], activeIndex: 0 };
    }
    return this.state;
  }

  get ompPath(): string | undefined {
    return this.state.ompPath;
  }

  patch(next: Partial<PersistedState>): void {
    this.state = { ...this.state, ...next };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.state, null, 2), "utf8");
    } catch {
      // Persistence is best-effort; a read-only profile must not block quitting.
    }
  }
}
