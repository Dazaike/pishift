import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PersistedState, TabState } from "../shared/ipc";
import { DEFAULT_PERSISTED_SETTINGS } from "../shared/defaults";
import {
  normalizeSettingsSectionCollapsed,
  normalizeUsageTrackerSettings,
} from "../shared/usage-tracker";
import { clampTabRailHoverReachPx, isTabLayout, isTabRailSide } from "../shared/tab-layout";
import {
  isPasteMarkerPaint,
  isPasteMarkerStyle,
  isPasteModeSetting,
} from "../shared/paste-attach";

/** The subset of `PersistedState` that is a portable "setting" — excludes window
 * bounds, the local omp executable path, recent folders, and the active tab list,
 * all of which are machine/session-specific and never travel with export/import. */
export type PersistedSettings = Omit<
  PersistedState,
  "tabs" | "activeIndex" | "bounds" | "ompPath" | "recentFolders"
>;

/** Normalizes an arbitrary (partial, possibly malformed) object into a full settings
 * payload, falling back field-by-field to `defaults`. Shared by disk-load, export and
 * import so all three paths reject the same malformed shapes the same way. */
export function normalizeSettings(
  raw: Partial<PersistedState>,
  defaults: typeof DEFAULT_PERSISTED_SETTINGS,
): PersistedSettings {
  return {
    autoUpdateOmpOnOpen:
      typeof raw.autoUpdateOmpOnOpen === "boolean"
        ? raw.autoUpdateOmpOnOpen
        : defaults.autoUpdateOmpOnOpen,
    themeName: raw.themeName ?? defaults.themeName,
    theme: raw.theme,
    fontFamily: typeof raw.fontFamily === "string" ? raw.fontFamily : defaults.fontFamily,
    fontSize:
      typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)
        ? raw.fontSize
        : defaults.fontSize,
    scrollSteps:
      typeof raw.scrollSteps === "number" && Number.isFinite(raw.scrollSteps)
        ? raw.scrollSteps
        : defaults.scrollSteps,
    defaultViewMode:
      raw.defaultViewMode === "chat" || raw.defaultViewMode === "terminal"
        ? raw.defaultViewMode
        : defaults.defaultViewMode,
    autoExpandTools:
      typeof raw.autoExpandTools === "boolean" ? raw.autoExpandTools : defaults.autoExpandTools,
    autoExpandReasoning:
      typeof raw.autoExpandReasoning === "boolean"
        ? raw.autoExpandReasoning
        : defaults.autoExpandReasoning,
    doneSoundEnabled:
      typeof raw.doneSoundEnabled === "boolean"
        ? raw.doneSoundEnabled
        : defaults.doneSoundEnabled,
    doneSoundVolume:
      typeof raw.doneSoundVolume === "number" && Number.isFinite(raw.doneSoundVolume)
        ? raw.doneSoundVolume
        : defaults.doneSoundVolume,
    favoriteModels: Array.isArray(raw.favoriteModels) ? raw.favoriteModels : defaults.favoriteModels,
    customModels: Array.isArray(raw.customModels) ? raw.customModels : defaults.customModels,
    showFavoritesOnly:
      typeof raw.showFavoritesOnly === "boolean"
        ? raw.showFavoritesOnly
        : defaults.showFavoritesOnly,
    showUsageInHeader:
      typeof raw.showUsageInHeader === "boolean"
        ? raw.showUsageInHeader
        : defaults.showUsageInHeader,
    activityColors: raw.activityColors ?? defaults.activityColors,
    activityColorsOnTabs:
      typeof raw.activityColorsOnTabs === "boolean"
        ? raw.activityColorsOnTabs
        : defaults.activityColorsOnTabs,
    todoPanelVisible:
      typeof raw.todoPanelVisible === "boolean" ? raw.todoPanelVisible : defaults.todoPanelVisible,
    todoPanelMode: raw.todoPanelMode ?? defaults.todoPanelMode,
    hideTopButtonLabels:
      typeof raw.hideTopButtonLabels === "boolean"
        ? raw.hideTopButtonLabels
        : defaults.hideTopButtonLabels,
    hideBottomButtonLabels:
      typeof raw.hideBottomButtonLabels === "boolean"
        ? raw.hideBottomButtonLabels
        : defaults.hideBottomButtonLabels,
    collapseTopBarToMenu:
      typeof raw.collapseTopBarToMenu === "boolean"
        ? raw.collapseTopBarToMenu
        : defaults.collapseTopBarToMenu,
    panelPosition:
      raw.panelPosition === "center" ||
      raw.panelPosition === "top-center" ||
      raw.panelPosition === "bottom-center" ||
      raw.panelPosition === "top-right"
        ? raw.panelPosition
        : defaults.panelPosition,
    tabPreviews: typeof raw.tabPreviews === "boolean" ? raw.tabPreviews : defaults.tabPreviews,
    tabLayout: isTabLayout(raw.tabLayout) ? raw.tabLayout : defaults.tabLayout,
    tabRailSide: isTabRailSide(raw.tabRailSide) ? raw.tabRailSide : defaults.tabRailSide,
    tabRailHoverReachPx:
      raw.tabRailHoverReachPx !== undefined
        ? clampTabRailHoverReachPx(raw.tabRailHoverReachPx)
        : defaults.tabRailHoverReachPx,
    thinkingControlStyle:
      raw.thinkingControlStyle === "horizontal" ||
      raw.thinkingControlStyle === "vertical" ||
      raw.thinkingControlStyle === "list"
        ? raw.thinkingControlStyle
        : defaults.thinkingControlStyle,
    pasteMode: isPasteModeSetting(raw.pasteMode) ? raw.pasteMode : defaults.pasteMode,
    pasteMarkerStyle: isPasteMarkerStyle(raw.pasteMarkerStyle)
      ? raw.pasteMarkerStyle
      : defaults.pasteMarkerStyle,
    pasteMarkerPaint: isPasteMarkerPaint(raw.pasteMarkerPaint)
      ? raw.pasteMarkerPaint
      : defaults.pasteMarkerPaint,
    pasteMarkerPulse:
      typeof raw.pasteMarkerPulse === "boolean"
        ? raw.pasteMarkerPulse
        : defaults.pasteMarkerPulse,
    splitRatio:
      typeof raw.splitRatio === "number" && raw.splitRatio >= 0.1 && raw.splitRatio <= 0.9
        ? raw.splitRatio
        : undefined,
    usageTracker: raw.usageTracker
      ? normalizeUsageTrackerSettings(raw.usageTracker)
      : defaults.usageTracker,
    settingsSectionCollapsed: raw.settingsSectionCollapsed
      ? normalizeSettingsSectionCollapsed(raw.settingsSectionCollapsed)
      : defaults.settingsSectionCollapsed,
  };
}
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
    const defaults = DEFAULT_PERSISTED_SETTINGS;
    try {
      if (!existsSync(this.file)) {
        const initial: PersistedState = {
          ...defaults,
          tabs: [{ cwd: this.homeDir }],
          activeIndex: 0,
        };
        try {
          mkdirSync(dirname(this.file), { recursive: true });
          writeFileSync(this.file, JSON.stringify(initial, null, 2), "utf8");
        } catch {}
        return initial;
      }

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
        recentFolders: Array.isArray(raw.recentFolders)
          ? raw.recentFolders.filter((f): f is string => typeof f === "string" && existsSync(f))
          : undefined,
        ...normalizeSettings(raw, defaults),
        tabs,
        activeIndex: Math.min(
          Math.max(raw.activeIndex ?? 0, 0),
          Math.max(tabs.length - 1, 0),
        ),
      };
    } catch {
      return {
        ...defaults,
        tabs: [{ cwd: this.homeDir }],
        activeIndex: 0,
      };
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

  /** Sanitized settings payload for export — excludes window bounds, the local omp
   * path, recent folders, and the active tab list, none of which are portable. */
  exportSettings(): PersistedSettings {
    return normalizeSettings(this.state, DEFAULT_PERSISTED_SETTINGS);
  }

  /** Merges an imported settings payload (as produced by `exportSettings`) into the
   * store. Field-by-field normalization rejects malformed/foreign JSON the same way
   * a corrupt `state.json` would be rejected on load. Persists immediately. */
  importSettings(raw: unknown): void {
    if (typeof raw !== "object" || raw === null) {
      throw new Error("Settings file must contain a JSON object");
    }
    const settings = normalizeSettings(raw as Partial<PersistedState>, DEFAULT_PERSISTED_SETTINGS);
    this.patch(settings);
    this.flush();
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
