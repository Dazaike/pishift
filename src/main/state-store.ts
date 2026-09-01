import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PersistedState, TabState } from "../shared/ipc";
import {
  normalizeSettingsSectionCollapsed,
  normalizeUsageTrackerSettings,
} from "../shared/usage-tracker";
import { isTabLayoutMode } from "../shared/tab-layout";

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
              ...(typeof t.customTitle === "string" && t.customTitle
                ? { customTitle: t.customTitle }
                : {}),
              ...(typeof t.colorTag === "string" && t.colorTag
                ? { colorTag: t.colorTag }
                : {}),
            }))
        : [];
      return {
        bounds: raw.bounds,
        ompPath: raw.ompPath,
        themeName: raw.themeName,
        theme: raw.theme,
        fontFamily: typeof raw.fontFamily === "string" ? raw.fontFamily : undefined,
        fontSize:
          typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)
            ? raw.fontSize
            : undefined,
        // Whitelisted read: keys omitted here are silently dropped on restart.
        scrollSteps:
          typeof raw.scrollSteps === "number" && Number.isFinite(raw.scrollSteps)
            ? raw.scrollSteps
            : undefined,
        defaultViewMode:
          raw.defaultViewMode === "chat" || raw.defaultViewMode === "terminal"
            ? raw.defaultViewMode
            : undefined,
        autoExpandTools:
          typeof raw.autoExpandTools === "boolean" ? raw.autoExpandTools : undefined,
        autoExpandReasoning:
          typeof raw.autoExpandReasoning === "boolean" ? raw.autoExpandReasoning : undefined,
        doneSoundEnabled:
          typeof raw.doneSoundEnabled === "boolean" ? raw.doneSoundEnabled : undefined,
        doneSoundVolume:
          typeof raw.doneSoundVolume === "number" && Number.isFinite(raw.doneSoundVolume)
            ? raw.doneSoundVolume
            : undefined,
        favoriteModels: Array.isArray(raw.favoriteModels) ? raw.favoriteModels : undefined,
        customModels: Array.isArray(raw.customModels) ? raw.customModels : undefined,
        showFavoritesOnly: raw.showFavoritesOnly,
        showUsageInHeader: raw.showUsageInHeader,
        activityColors: raw.activityColors,
        activityColorsOnTabs: raw.activityColorsOnTabs,
        todoPanelVisible: raw.todoPanelVisible,
        todoPanelMode: raw.todoPanelMode,
        recentFolders: Array.isArray(raw.recentFolders)
          ? raw.recentFolders.filter((f): f is string => typeof f === "string" && existsSync(f))
          : undefined,
        hideTopButtonLabels: typeof raw.hideTopButtonLabels === "boolean" ? raw.hideTopButtonLabels : undefined,
        hideBottomButtonLabels: typeof raw.hideBottomButtonLabels === "boolean" ? raw.hideBottomButtonLabels : undefined,
        collapseTopBarToMenu: typeof raw.collapseTopBarToMenu === "boolean" ? raw.collapseTopBarToMenu : undefined,
        panelPosition:
          raw.panelPosition === "center" ||
          raw.panelPosition === "top-center" ||
          raw.panelPosition === "bottom-center" ||
          raw.panelPosition === "top-right"
            ? raw.panelPosition
            : undefined,
        tabLayoutMode: isTabLayoutMode(raw.tabLayoutMode) ? raw.tabLayoutMode : undefined,
        usageTracker: raw.usageTracker
          ? normalizeUsageTrackerSettings(raw.usageTracker)
          : undefined,
        settingsSectionCollapsed: raw.settingsSectionCollapsed
          ? normalizeSettingsSectionCollapsed(raw.settingsSectionCollapsed)
          : undefined,
        tabs,
        activeIndex: Math.min(
          Math.max(raw.activeIndex ?? 0, 0),
          Math.max(tabs.length - 1, 0),
        ),
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
  get recentFolders(): string[] {
    return this.state.recentFolders ?? [];
  }

  addRecentFolder(folder: string): string[] {
    const list = this.state.recentFolders ?? [];
    const normalized = folder.replace(/[\\/]+$/, "");
    const filtered = list.filter((f) => f.replace(/[\\/]+$/, "").toLowerCase() !== normalized.toLowerCase());
    const updated = [folder, ...filtered].slice(0, 50);
    this.patch({ recentFolders: updated });
    return updated;
  }

  removeRecentFolder(folder: string): string[] {
    const list = this.state.recentFolders ?? [];
    const normalized = folder.replace(/[\\/]+$/, "").toLowerCase();
    const updated = list.filter((f) => f.replace(/[\\/]+$/, "").toLowerCase() !== normalized);
    this.patch({ recentFolders: updated });
    return updated;
  }

  clearRecentFolders(): void {
    this.patch({ recentFolders: [] });
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
