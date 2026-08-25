import appIcon from "./assets/icons/icon.png";
import settingsIcon from "./assets/icons/settings.png";
import {
  DEFAULT_ACTIVITY_COLORS,
  GLOW_ACTIVITIES,
  GLOW_ACTIVITY_LABELS,
  quotePath,
  type ControlBridgeActivity,
  type ControlBridgeState,
  type CustomModelConfig,
  type GlowActivity,
  type InstalledModel,
  type PanelPosition,
  type PendingAsk,
  type TabState,
  type TodoPhase,
} from "../shared/ipc";
import { parseModelSlashCommand } from "../shared/model-command";
import {
  DEFAULT_THEME_NAME,
  FONT_FAMILY,
  FONT_SIZE,
  getThemeByName,
  type ThemePreset,
} from "./theme";
import { TodoPanel, type TodoPanelMode } from "./todo-panel";
import { ConfirmDialog } from "./confirm-dialog";
import {
  Dock,
  buildThinkingLevelsForModel,
  clampThinkingToLevels,
  formatThinkingLevel,
  toThinkingCommandToken,
  type DockPayload,
  type DockState,
} from "./dock";
import { clampVolume, CompletionSound, DEFAULT_DONE_SOUND_VOLUME } from "./completion-sound";
import {
  PlanReconciler,
  isPlanExitConfirm,
  parsePlanStatus,
  type PlanTarget,
} from "../shared/plan-mode";
import { installWindowDnd, INTERNAL_DRAG_TYPE } from "./dnd";
import { DEFAULT_USER_MODELS, ModelModal } from "./model-modal";
import { SettingsModal } from "./settings";
import { TabContextMenu, TAB_COLOR_PRESETS } from "./tab-menu";
import {
  clampScrollSteps,
  DEFAULT_SCROLL_STEPS,
  TermView,
} from "./term-view";
import { DockToolsMenu } from "./dock-tools-menu";
import { UsageModal } from "./usage-modal";
import { AskModal, type AskAnswer } from "./ask-modal";
import { RecentFoldersModal } from "./recent-folders-modal";
import { RecentChatsModal } from "./recent-chats-modal";
import { TopMenu } from "./top-menu";
const api = window.omphif;

const tabsEl = document.getElementById("tabs") as HTMLDivElement;
const viewsEl = document.getElementById("views") as HTMLDivElement;
const newTabButton = document.getElementById("new-tab") as HTMLButtonElement;
const settingsBtn = document.getElementById("btn-settings") as HTMLButtonElement;
const settingsImg = settingsBtn.querySelector<HTMLImageElement>("img.btn-icon");
if (settingsImg) settingsImg.src = settingsIcon;
const todoBtn = document.getElementById("btn-todo") as HTMLButtonElement;
const recentFoldersBtn = document.getElementById("btn-recent-folders") as HTMLButtonElement;
const recentChatsBtn = document.getElementById("btn-recent-chats") as HTMLButtonElement;
const topMenuBtn = document.getElementById("btn-top-menu") as HTMLButtonElement | null;
const relaunchBtn = document.getElementById("btn-relaunch") as HTMLButtonElement | null;
const quitBtn = document.getElementById("btn-quit") as HTMLButtonElement | null;
const headerUsage = document.getElementById("header-usage") as HTMLDivElement;
const headerUsageText = document.getElementById("header-usage-text") as HTMLSpanElement;
const headerActivity = document.getElementById("header-activity") as HTMLDivElement;
const headerActivityDot = document.getElementById("header-activity-dot") as HTMLSpanElement;
const headerActivityText = document.getElementById("header-activity-text") as HTMLSpanElement;
const keyTargetIndicator = document.getElementById("key-target-indicator") as HTMLDivElement | null;

type Tab = {
  cwd: string;
  customTitle?: string;
  colorTag?: string;
  view: TermView | null;
  sessionId: string | null;
  /** Matches control-bridge `sessionId` / OMPHIF_SESSION_ID. */
  sessionKey: string | null;
  /** PTY process pid (best-effort match to control-bridge pid). */
  ompPid: number | null;
  /** Bytes produced before the PTY id is known. */
  pending: string[];
  title: string;
  modelName: string;
  thinkingLevel: string;
  /** Sole owner of this tab's plan display state and toggle reconciliation. */
  plan: PlanReconciler;
  /** Combined busy for the tab chrome (progress OSC and/or agent activity). */
  busy: boolean;
  /** ConEmu OSC 9;4 progress (indeterminate while agent runs). */
  progressBusy: boolean;
  /** control-bridge activity classification. */
  activity: ControlBridgeActivity;
  /** Clears stuck progressBusy if omp never sends 9;4;0. */
  progressBusyTimer: number | null;
  button: HTMLButtonElement;
  appIcon: HTMLImageElement;
  colorDot: HTMLSpanElement;
  label: HTMLSpanElement;
  notice: HTMLDivElement | null;
  dock: DockState | undefined;
  pendingAsk: PendingAsk | null;
  dismissedAskToolCallId: string | null;
  /** Auto-incrementing fallback label ("Session N") when no folder/auto-title applies. */
  sessionNumber: number;
  /** Read-only mirror of OMP's `/todo` tool state for this session. */
  todo: TodoPhase[] | null;
  /** Set when the user cancelled or the session died — that idle is not "done". */
  suppressDoneSound: boolean;
};

const tabs: Tab[] = [];
let sessionCounter = 0;
const bySession = new Map<string, Tab>();
let active: Tab | null = null;
let draggedTab: Tab | null = null;
let currentPreset: ThemePreset = getThemeByName(DEFAULT_THEME_NAME);
let favoriteModels: string[] = ["gemini-3.7-flash", "claude-3-7-sonnet", "gpt-4o"];
let customModels: CustomModelConfig[] = [];
let installedModels: InstalledModel[] = [];
let showFavoritesOnly = false;
let showUsageInHeader = true;
let customFontFamily = "";
/** Terminal zoom (xterm font px); restored across app restarts. */
let terminalFontSize = FONT_SIZE;
const KNOWN_ACTIVITIES: readonly ControlBridgeActivity[] = ["idle", ...GLOW_ACTIVITIES];
let activityColors: Record<GlowActivity, string> = { ...DEFAULT_ACTIVITY_COLORS };
let activityColorsOnTabs = false;
let todoPanelVisible = false;
let todoPanelMode: TodoPanelMode = "overlay";
let hideTopButtonLabels = false;
let hideBottomButtonLabels = false;
let collapseTopBarToMenu = false;
let panelPosition: PanelPosition = "top-right";
let terminalScrollSteps = DEFAULT_SCROLL_STEPS;
let doneSoundEnabled = true;
let doneSoundVolume = DEFAULT_DONE_SOUND_VOLUME;
const doneSound = new CompletionSound(doneSoundEnabled, doneSoundVolume);

function applyScrollSteps(steps: number): void {
  terminalScrollSteps = clampScrollSteps(steps);
  for (const tab of tabs) tab.view?.setScrollSteps(terminalScrollSteps);
}
function applyButtonLabelVisibility(): void {
  document.body.classList.toggle("hide-top-button-labels", hideTopButtonLabels);
  document.body.classList.toggle("hide-bottom-button-labels", hideBottomButtonLabels);
  document.body.classList.toggle("top-bar-as-menu", collapseTopBarToMenu);
}
let settingsModal: SettingsModal | null = null;
let modelModal: ModelModal | null = null;
let usageModal: UsageModal | null = null;
let askModal: AskModal | null = null;
let dockToolsMenu: DockToolsMenu | null = null;
let recentFoldersModal: RecentFoldersModal | null = null;
let recentChatsModal: RecentChatsModal | null = null;
let topMenu: TopMenu | null = null;
const tabContextMenu = new TabContextMenu();
const todoPanel = new TodoPanel(
  (visible) => {
    todoPanelVisible = visible;
    persist();
  },
  (mode) => {
    todoPanelMode = mode;
    persist();
  },
);
const confirmDialog = new ConfirmDialog();
document.body.appendChild(confirmDialog.root);

function applyTheme(preset: ThemePreset): void {
  currentPreset = preset;
  const root = document.documentElement;
  root.style.setProperty("--bg", preset.bg);
  root.style.setProperty("--bg-raised", preset.bgRaised);
  root.style.setProperty("--bg-tab", preset.bgTab);
  root.style.setProperty("--border", preset.border);
  root.style.setProperty("--fg", preset.fg);
  root.style.setProperty("--fg-dim", preset.fgDim);
  root.style.setProperty("--accent", preset.accent);
  // Keep Windows caption-button strip color-matched to the app chrome.
  api.setChromeColors(preset.bgRaised, preset.fg);
  for (const tab of tabs) {
    tab.view?.setTheme(preset);
  }
}

function applyFont(family: string): void {
  customFontFamily = family;
  const stack = family || FONT_FAMILY;
  const root = document.documentElement;
  root.style.setProperty("--mono", stack);
  root.style.setProperty("--ui", stack);
  for (const tab of tabs) tab.view?.setFontFamily(stack);
}

/** Apply the resolved (default-merged) activity glow colors as CSS custom properties. */
function applyActivityColors(): void {
  const root = document.documentElement;
  for (const key of GLOW_ACTIVITIES) {
    root.style.setProperty(`--glow-${key}`, activityColors[key]);
  }
  root.classList.toggle("activity-colors-on-tabs", activityColorsOnTabs);
}

function setActivityColor(key: GlowActivity, color: string): void {
  activityColors = { ...activityColors, [key]: color };
  applyActivityColors();
  persist();
}

function resetActivityColors(): void {
  activityColors = { ...DEFAULT_ACTIVITY_COLORS };
  applyActivityColors();
  persist();
}

function setActivityColorsOnTabs(enabled: boolean): void {
  activityColorsOnTabs = enabled;
  applyActivityColors();
  persist();
}


function findInstalledModel(modelSpec: string): InstalledModel | undefined {
  if (!modelSpec) return undefined;
  const specLow = modelSpec.toLowerCase();
  const bare = specLow.includes("/") ? specLow.slice(specLow.lastIndexOf("/") + 1) : specLow;
  return installedModels.find((m) => {
    const id = m.id.toLowerCase();
    const bareId = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
    return (
      id === specLow ||
      bareId === bare ||
      specLow.endsWith("/" + bareId) ||
      id.endsWith("/" + bare) ||
      bareId.includes(bare) ||
      bare.includes(bareId)
    );
  });
}

function applyThinkingLevelsForModel(
  modelSpec: string,
  currentLevel?: string,
  targetTab: Tab | null = active,
): void {
  const installed = findInstalledModel(modelSpec);
  const levels = buildThinkingLevelsForModel(installed);
  const cur = currentLevel ?? targetTab?.thinkingLevel ?? "low";
  const clamped = clampThinkingToLevels(cur, levels);
  // Only paint the dock when this is the active session.
  if (targetTab === active) {
    dock.setThinkingLevels(levels, clamped);
  }
  if (targetTab) targetTab.thinkingLevel = formatThinkingLevel(clamped);
}

function applyModelToDock(modelSpec: string, thinkingLevel?: string, targetTab: Tab | null = active): void {
  const allModels = customModels.length > 0 ? customModels : DEFAULT_USER_MODELS;
  const paint = targetTab === active;
  if (!modelSpec) {
    if (paint) dock.setModel("Model");
    applyThinkingLevelsForModel("", thinkingLevel, targetTab);
    return;
  }
  const specLow = modelSpec.toLowerCase();
  const found = allModels.find(
    (m) =>
      m.id.toLowerCase() === specLow ||
      m.name.toLowerCase() === specLow ||
      specLow.includes(m.id.toLowerCase()) ||
      specLow.includes(m.name.toLowerCase()),
  );
  if (paint) {
    if (found) {
      dock.setModel(found.name, found.iconUrl, found.provider);
    } else {
      const parts = modelSpec.split("/");
      const provider = parts.length > 1 ? parts[0] : undefined;
      const name = parts.length > 1 ? parts[1] : modelSpec;
      dock.setModel(name!, undefined, provider);
    }
  }
  if (targetTab) targetTab.modelName = modelSpec;
  applyThinkingLevelsForModel(modelSpec, thinkingLevel ?? targetTab?.thinkingLevel, targetTab);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const ASK_ARROW_UP = "\x1b[A";
const ASK_ARROW_DOWN = "\x1b[B";
const ASK_KEY_ENTER = "\r";
const ASK_KEY_SPACE = " ";

function sanitizeAskText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\x1b/g, "");
}

/**
 * Translate structured ask-modal answers into the raw keystroke sequence the
 * native omp `ask` TUI expects: ArrowDown to the target row, then Enter
 * (single-select) or Space per checked row + Enter (multi-select), with a
 * detour into the trailing "Other" row when `customText` is set.
 */
function buildAskSequence(answers: AskAnswer[]): string {
  let seq = "";
  for (const a of answers) {
    const otherIndex = a.optionsCount;
    if (a.multi) {
      let cursor = 0;
      for (const idx of [...a.selectedIndices].sort((x, y) => x - y)) {
        seq += ASK_ARROW_DOWN.repeat(idx - cursor);
        cursor = idx;
        seq += ASK_KEY_SPACE;
      }
      if (a.customText !== undefined) {
        seq += ASK_ARROW_DOWN.repeat(otherIndex - cursor);
        seq += ASK_KEY_ENTER + sanitizeAskText(a.customText) + ASK_KEY_ENTER;
        seq += ASK_ARROW_UP + ASK_KEY_ENTER;
      } else {
        seq += ASK_KEY_ENTER;
      }
    } else if (a.customText !== undefined) {
      seq += ASK_ARROW_DOWN.repeat(otherIndex);
      seq += ASK_KEY_ENTER + sanitizeAskText(a.customText) + ASK_KEY_ENTER;
    } else {
      seq += ASK_ARROW_DOWN.repeat(a.selectedIndices[0] ?? 0);
      seq += ASK_KEY_ENTER;
    }
  }
  if (answers.length > 1) seq += ASK_KEY_ENTER;
  return seq;
}

function sendAskAnswers(tab: Tab, answers: AskAnswer[]): void {
  if (!tab.view) return;
  tab.view.writeRaw(buildAskSequence(answers));
}

function syncAskModal(tab: Tab): void {
  const pending = tab.pendingAsk;
  if (!pending || pending.toolCallId === tab.dismissedAskToolCallId) {
    askModal?.close();
    return;
  }
  if (!askModal) {
    askModal = new AskModal();
    const dockEl = document.getElementById("dock");
    if (dockEl) dockEl.insertBefore(askModal.el, dockEl.firstChild);
    else document.body.appendChild(askModal.el);
  }
  askModal.open(
    pending,
    (answers) => {
      sendAskAnswers(tab, answers);
      tab.pendingAsk = null;
    },
    () => {
      tab.dismissedAskToolCallId = pending.toolCallId;
    },
  );
}
function updateHeaderUsageVisibility(): void {
  if (headerUsage) {
    headerUsage.style.display = showUsageInHeader ? "inline-flex" : "none";
  }
}

async function refreshHeaderUsage(): Promise<void> {
  try {
    const stats = await api.getProviderUsage();
    if (stats && stats.length > 0) {
      usageModal?.updateReports(stats);
      const top = stats.find((s) => s.limits && s.limits.length > 0);
      if (top && top.limits[0]) {
        const l = top.limits[0];
        headerUsageText.textContent = `${top.providerName} \u00b7 ${l.label} ${l.usedPercent}%`;
      } else {
        headerUsageText.textContent = `${stats.length} Providers Active`;
      }
    }
  } catch {}
}


const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() || p;

/** Titles that are noise / not useful as a tab label. */
const GENERIC_TITLES = new Set(
  ["", "omp", "oh my pi", "oh-my-pi", "omphif", "terminal", "bash", "pwsh", "powershell", "cmd", "temp", "tmp"].map(
    (s) => s.toLowerCase(),
  ),
);

function cleanAutoTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let t = raw.replace(/\s+/g, " ").trim();
  // Common terminal title shapes: "name — path", "name - path", "user@host: path"
  t = t.split(/\s+[—–|•]\s+/)[0]?.trim() || t;
  t = t.split(/\s+-\s+/)[0]?.trim() || t;
  // omp's own breadcrumb ("π > tmp") is redundant noise, not a real session title.
  if (/^\W+\s*>\s*\S/.test(t)) return undefined;
  if (t.length > 48) t = `${t.slice(0, 45).trimEnd()}…`;
  if (GENERIC_TITLES.has(t.toLowerCase())) return undefined;
  return t || undefined;
}

/** Prefer manual rename, then omp auto-title, then folder name. Default temp dir displays app name. */
function tabDisplayName(tab: Tab): string {
  if (tab.customTitle?.trim()) return tab.customTitle.trim();
  const auto = cleanAutoTitle(tab.title);
  if (auto) return auto;
  const folder = basename(tab.cwd);
  if (!folder || folder.toLowerCase() === "temp" || folder.toLowerCase() === "tmp") {
    return "PiShift";
  }
  return folder || `Session ${tab.sessionNumber}`;
}

function persist(): void {
  const state: TabState[] = tabs.map((tab) => ({
    cwd: tab.cwd,
    customTitle: tab.customTitle,
    colorTag: tab.colorTag,
  }));
  api.saveState({
    tabs: state,
    activeIndex: Math.max(active ? tabs.indexOf(active) : 0, 0),
    themeName: currentPreset.name,
    favoriteModels,
    customModels,
    showFavoritesOnly,
    showUsageInHeader,
    fontFamily: customFontFamily,
    fontSize: terminalFontSize,
    scrollSteps: terminalScrollSteps,
    activityColors,
    activityColorsOnTabs,
    todoPanelVisible,
    panelPosition,
    collapseTopBarToMenu,
    todoPanelMode,
    hideTopButtonLabels,
    hideBottomButtonLabels,
    doneSoundEnabled,
    doneSoundVolume,
  });
}

function sendToPty(tab: Tab, data: string): void {
  if (tab.sessionId) api.write(tab.sessionId, data);
  else tab.pending.push(data);
}

function renderTabs(): void {
  for (const tab of tabs) {
    const name = tabDisplayName(tab);
    tab.button.classList.toggle("active", tab === active);
    tab.button.classList.toggle("busy", tab.busy);
    if (activityColorsOnTabs && tab.activity !== "idle") {
      tab.button.style.setProperty("--tab-glow", activityColors[tab.activity]);
    } else {
      tab.button.style.removeProperty("--tab-glow");
    }
    tab.label.textContent = name;

    const isPiShift = name === "PiShift";
    tab.appIcon.style.display = isPiShift ? "inline-block" : "none";
    tab.button.classList.toggle("has-app-icon", isPiShift);

    // Color tag badge
    const colorPreset = tab.colorTag
      ? TAB_COLOR_PRESETS.find((p) => p.id === tab.colorTag)
      : undefined;
    if (colorPreset) {
      tab.colorDot.style.backgroundColor = colorPreset.color;
      tab.colorDot.style.display = "inline-block";
    } else {
      tab.colorDot.style.display = "none";
    }

    const source = tab.customTitle
      ? "manual"
      : cleanAutoTitle(tab.title)
        ? "auto"
        : "folder";
    tab.button.title = `${name} (${tab.cwd}) — ${source} · right-click for options · double-click to rename`;
  }
}
function updateHeaderActivity(tab: Tab | null = active): void {
  if (!headerActivity || !headerActivityDot || !headerActivityText) return;
  if (!tab || (!tab.busy && tab.activity === "idle")) {
    headerActivity.hidden = true;
    headerActivity.dataset.activity = "idle";
    headerActivityText.textContent = "Idle";
    headerActivityDot.style.background = "var(--fg-dim)";
    return;
  }

  const kind: GlowActivity =
    tab.activity !== "idle" ? (tab.activity as GlowActivity) : "working";
  const color = activityColors[kind] ?? DEFAULT_ACTIVITY_COLORS[kind];
  const label = GLOW_ACTIVITY_LABELS[kind] ?? "Working";

  headerActivity.hidden = false;
  headerActivity.dataset.activity = kind;
  headerActivity.title = `Agent activity: ${label}`;
  headerActivityText.textContent = label;
  headerActivityDot.style.background = color;
  headerActivity.style.setProperty("--header-activity-color", color);
}

function syncTabBusy(tab: Tab): void {
  const next = tab.progressBusy || tab.activity !== "idle";
  const finished = tab.busy && !next;
  tab.busy = next;
  if (next) {
    // A fresh run always re-arms: a cancel that never reached a busy state
    // must not swallow the next genuine completion.
    tab.suppressDoneSound = false;
  } else if (finished) {
    // Cancels and exits also land on idle; only an unforced finish is "done".
    if (tab.suppressDoneSound) tab.suppressDoneSound = false;
    else doneSound.play();
  }
  renderTabs();
  if (tab === active) {
    // Prefer bridge activity; fall back to generic working when only OSC busy is set.
    const kind = next ? (tab.activity !== "idle" ? tab.activity : "working") : "idle";
    dock.setAgentBusy(next, kind);
    updateHeaderActivity(tab);
  }
  syncTaskbarBusy();
}

let taskbarBusy = false;

/** Windows taskbar button animates while *any* tab is running, not just the active one. */
function syncTaskbarBusy(): void {
  const next = tabs.some(isTabBusy);
  if (next === taskbarBusy) return;
  taskbarBusy = next;
  api.setTaskbarBusy(next);
}

/** OSC 9;4 progress — omp pulses state 3 while running, 0 when idle. */
function setTabProgressBusy(tab: Tab, busy: boolean): void {
  if (tab.progressBusyTimer !== null) {
    window.clearTimeout(tab.progressBusyTimer);
    tab.progressBusyTimer = null;
  }
  tab.progressBusy = busy;
  if (busy) {
    // omp's progress OSC can be sparse (~30s). Keep the OSC latch alive longer
    // than that pulse so chrome doesn't drop between progress frames.
    tab.progressBusyTimer = window.setTimeout(() => {
      tab.progressBusyTimer = null;
      if (!tab.progressBusy) return;
      tab.progressBusy = false;
      // OSC-only busy: do not invent a sticky bridge activity.
      syncTabBusy(tab);
    }, 45_000);
  }
  // Never assign tab.activity from OSC — that stuck the header on "Working"
  // after the progress pulse cleared while bridge idle never rematched.
  syncTabBusy(tab);
}

function setTabActivity(tab: Tab, activity: ControlBridgeActivity): void {
  tab.activity = activity;
  // Authoritative idle from the bridge also clears a stuck OSC progress flag.
  if (activity === "idle") {
    if (tab.progressBusyTimer !== null) {
      window.clearTimeout(tab.progressBusyTimer);
      tab.progressBusyTimer = null;
    }
    tab.progressBusy = false;
  }
  syncTabBusy(tab);
}

function updateUsageDisplay(tab: Tab): void {
  if (!tab || tab !== active) return;
  void refreshHeaderUsage();
}

function playViewSwitch(tab: Tab, dir: "left" | "right"): void {
  const el = tab.view?.el ?? tab.notice;
  if (!el) return;
  el.classList.remove("switch-from-left", "switch-from-right");
  // Force restart when switching rapidly.
  void el.offsetWidth;
  const cls = dir === "right" ? "switch-from-right" : "switch-from-left";
  el.classList.add(cls);
  const done = (): void => {
    el.classList.remove(cls);
    el.removeEventListener("animationend", done);
  };
  el.addEventListener("animationend", done);
}

function activate(tab: Tab): void {
  if (active === tab) {
    dock.focus();
    return;
  }
  const fromIndex = active ? tabs.indexOf(active) : -1;
  const toIndex = tabs.indexOf(tab);
  const dir: "left" | "right" =
    fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex ? "left" : "right";

  if (active) {
    // Snapshot composer contents only; model/thinking/plan live on the Tab.
    active.dock = dock.snapshot();
    active.view?.deactivate();
    active.notice?.classList.remove("active");
  }
  active = tab;
  tab.view?.activate(viewsEl);
  tab.notice?.classList.add("active");
  playViewSwitch(tab, dir);
  dock.load(tab.dock);
  dock.setCwd(tab.cwd);
  // Always paint from the tab's own session state (never leftover dock chrome).
  applyModelToDock(tab.modelName, tab.thinkingLevel, tab);
  dock.setThinkingLevel(tab.thinkingLevel || "low");
  dock.setPlanMode(tab.plan.mode, tab.plan.pending);
  dock.setAgentBusy(tab.busy, tab.busy ? tab.activity : "idle");
  updateHeaderActivity(tab);
  syncAskModal(tab);
  todoPanel.setPhases(tab.todo);
  modelModal?.setCurrentModel(tab.modelName || "");
  if (recentFoldersModal?.isOpen) {
    recentFoldersModal.setCurrentCwd(tab.cwd);
  }
  if (recentChatsModal?.isOpen) {
    recentChatsModal.setCurrentCwd(tab.cwd);
    recentChatsModal.setActiveSessionId(tab.sessionKey ?? tab.sessionId);
  }
  dock.focus();
  document.title = `${tabDisplayName(tab)} · PiShift`;
  renderTabs();
  updateUsageDisplay(tab);
  persist();
}

function closeTab(tab: Tab): void {
  const index = tabs.indexOf(tab);
  if (index < 0) return;
  tabs.splice(index, 1);
  if (tab.sessionId) {
    api.kill(tab.sessionId);
    bySession.delete(tab.sessionId);
  }
  tab.view?.dispose();
  tab.notice?.remove();
  tab.button.remove();

  if (active === tab) {
    active = null;
    const next = tabs[Math.min(index, tabs.length - 1)];
    if (next) activate(next);
  }
  renderTabs();
  syncTaskbarBusy();
  persist();
  if (tabs.length === 0) {
    void addTab();
  }
}

function isTabBusy(tab: Tab): boolean {
  return tab.busy || tab.activity !== "idle";
}

async function requestCloseTab(tab: Tab): Promise<void> {
  if (isTabBusy(tab)) {
    const ok = await confirmDialog.confirm(
      "Close active session?",
      `"${tabDisplayName(tab)}" is actively running. Closing it will stop the agent mid-task.`,
    );
    if (!ok) return;
  }
  closeTab(tab);
}

async function requestCloseTabs(toClose: readonly Tab[]): Promise<void> {
  const busyCount = toClose.filter(isTabBusy).length;
  if (busyCount > 0) {
    const ok = await confirmDialog.confirm(
      "Close active sessions?",
      `${busyCount} of ${toClose.length} session${toClose.length === 1 ? "" : "s"} ${busyCount === 1 ? "is" : "are"} actively running. Closing them will stop the agent mid-task.`,
    );
    if (!ok) return;
  }
  for (const t of toClose) closeTab(t);
  if (tabs.length === 0) {
    void addTab();
  }
}
function closeOtherTabs(target: Tab): void {
  void requestCloseTabs(tabs.filter((t) => t !== target));
}

function closeTabsToRight(target: Tab): void {
  const index = tabs.indexOf(target);
  if (index < 0) return;
  void requestCloseTabs(tabs.slice(index + 1));
}

async function restartSession(tab: Tab): Promise<void> {
  if (tab.sessionId) {
    api.kill(tab.sessionId);
    bySession.delete(tab.sessionId);
    tab.sessionId = null;
    tab.sessionKey = null;
    tab.ompPid = null;
  }
  tab.view?.dispose();
  tab.view = null;
  tab.notice?.remove();
  tab.notice = null;
  await startSession(tab);
  renderTabs();
}

function startRenameTab(tab: Tab): void {
  const currentName = tabDisplayName(tab);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "tab-rename-input";
  input.value = currentName;
  input.spellcheck = false;
  const commit = (): void => {
    const val = input.value.trim();
    // Empty / same as auto title clears the manual override so auto titles resume.
    const auto = cleanAutoTitle(tab.title);
    if (!val || val === "PiShift" || val === "OMP" || (auto && val === auto)) {
      tab.customTitle = undefined;
    } else {
      tab.customTitle = val;
    }
    input.replaceWith(tab.label);
    renderTabs();
    persist();
    if (tab === active) {
      document.title = `${tabDisplayName(tab)} · PiShift`;
    }
  };

  const cancel = (): void => {
    input.replaceWith(tab.label);
    renderTabs();
  };

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      commit();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  });

  input.addEventListener("blur", commit);
  tab.label.replaceWith(input);
  input.focus();
  input.select();
}

function showNotice(tab: Tab, message: string): void {
  tab.notice?.remove();
  const notice = document.createElement("div");
  notice.className = tab === active ? "view exit-notice active" : "view exit-notice";
  const text = document.createElement("span");
  text.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Reopen";
  button.addEventListener("click", () => {
    notice.remove();
    tab.notice = null;
    void startSession(tab);
  });
  notice.append(text, button);
  viewsEl.appendChild(notice);
  tab.notice = notice;
}

function cycleTab(step: -1 | 1): void {
  if (!active || tabs.length < 2) return;
  const index = (tabs.indexOf(active) + step + tabs.length) % tabs.length;
  const next = tabs[index];
  if (next) activate(next);
}

function createView(tab: Tab): TermView {
  const view = new TermView(
    {
      write: (data) => sendToPty(tab, data),
      resize: (cols, rows) => {
        if (tab.sessionId) api.resize(tab.sessionId, cols, rows);
      },
      setTitle: (title) => {
        const cleaned = cleanAutoTitle(title) ?? title.trim();
        if (cleaned === tab.title) return;
        tab.title = cleaned;
        if (tab === active) document.title = `${tabDisplayName(tab)} · PiShift`;
        renderTabs();
      },
      setBusy: (busy) => {
        setTabProgressBusy(tab, busy);
      },
      notify: (body) => {
        if (document.hasFocus() && tab === active) return;
        api.notify(tab.customTitle || tab.title || basename(tab.cwd), body);
      },
      onUserCancel: () => {
        // Esc / bare Ctrl+C — drop working chrome immediately; bridge will confirm.
        tab.suppressDoneSound = true;
        setTabProgressBusy(tab, false);
        setTabActivity(tab, "idle");
      },
      onReferenceSelection: (text) => {
        // Chips live on the active tab's dock state; a background tab's
        // selection must not leak into whatever the user is composing.
        if (tab !== active) return;
        dock.addSnippet(text);
      },
    },
    currentPreset,
    terminalFontSize,
  );
  if (customFontFamily) view.setFontFamily(customFontFamily || FONT_FAMILY);
  view.setScrollSteps(terminalScrollSteps);
  view.setFontSizeChangeHandler((size) => {
    terminalFontSize = size;
    // Keep sibling tabs in sync with the global zoom.
    for (const t of tabs) {
      if (t.view && t.view !== view) t.view.applyPersistedFontSize(size);
    }
    persist();
  });
  return view;
}

async function startSession(tab: Tab): Promise<void> {
  const view = createView(tab);
  tab.view = view;
  if (tab === active) {
    view.activate(viewsEl);
    // New tabs activate before their view exists, so animate here instead.
    playViewSwitch(tab, "right");
  } else {
    viewsEl.appendChild(view.el);
  }

  const result = await api.spawn({ cwd: tab.cwd, cols: view.cols, rows: view.rows });
  if ("error" in result) {
    view.dispose();
    tab.view = null;
    showNotice(tab, result.error);
    return;
  }
  tab.sessionId = result.id;
  tab.sessionKey = result.id;
  tab.ompPid = result.pid;
  bySession.set(result.id, tab);
  api.resize(result.id, view.cols, view.rows);
  for (const chunk of tab.pending.splice(0)) api.write(result.id, chunk);
  if (tab === active) dock.focus();
}

function makeTab(cwd: string, customTitle?: string, colorTag?: string): Tab {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tab";
  button.role = "tab";
  button.draggable = true;

  const appIconEl = document.createElement("img");
  appIconEl.className = "tab-app-icon";
  appIconEl.src = appIcon;
  appIconEl.alt = "";

  const busy = document.createElement("span");
  busy.className = "tab-busy";
  const colorDot = document.createElement("span");
  colorDot.className = "tab-color-dot";
  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = customTitle || "PiShift";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "tab-close";
  close.textContent = "\u00d7";
  close.setAttribute("aria-label", "Close tab");
  button.append(appIconEl, busy, colorDot, label, close);

  // Declared before the tab literal so the reconciler hooks can close over it.
  let self: Tab;
  const plan = new PlanReconciler({
    sendToggle: () => self.view?.runSlash("/plan"),
    answerConfirm: () => self.view?.writeRaw("\r"),
    onDisplay: (mode, pending) => {
      if (self === active) dock.setPlanMode(mode, pending);
    },
  });

  const tab: Tab = {
    cwd,
    customTitle,
    colorTag,
    view: null,
    sessionId: null,
    sessionKey: null,
    ompPid: null,
    pending: [],
    title: "",
    modelName: "",
    thinkingLevel: "low",
    plan,
    busy: false,
    progressBusy: false,
    activity: "idle",
    progressBusyTimer: null,
    button,
    appIcon: appIconEl,
    colorDot,
    label,
    notice: null,
    dock: undefined,
    pendingAsk: null,
    dismissedAskToolCallId: null,
    sessionNumber: ++sessionCounter,
    todo: null,
    suppressDoneSound: false,
  };
  self = tab;

  button.addEventListener("mousedown", (ev) => {
    if (ev.button === 1) {
      ev.preventDefault();
      void requestCloseTab(tab);
      return;
    }
    if (ev.target === close) return;
    if (ev.button === 0) activate(tab);
  });

  // Right click context menu
  button.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    tabContextMenu.open(ev.clientX, ev.clientY, tab, {
      onOpenExplorer: (t) => {
        void api.openPath(t.cwd);
      },
      onCopyPath: (t) => {
        api.copyText(t.cwd);
      },
      onDuplicate: (t) => {
        void openTab(t.cwd, true);
      },
      onRename: (_t) => {
        startRenameTab(tab);
      },
      onSetColor: (_t, colorId) => {
        tab.colorTag = colorId;
        renderTabs();
        persist();
      },
      onClose: (_t) => {
        void requestCloseTab(tab);
      },
      onCloseOthers: (_t) => {
        closeOtherTabs(tab);
      },
      onCloseRight: (_t) => {
        closeTabsToRight(tab);
      },
    });
  });

  // Tab drag-and-drop horizontal reordering
  button.addEventListener("dragstart", (ev) => {
    draggedTab = tab;
    button.classList.add("tab-dragging");
    ev.dataTransfer?.setData("text/plain", tab.cwd);
    ev.dataTransfer?.setData(INTERNAL_DRAG_TYPE, "tab");
  });

  button.addEventListener("dragend", () => {
    draggedTab = null;
    button.classList.remove("tab-dragging");
    for (const t of tabs) {
      t.button.classList.remove("drop-before", "drop-after");
    }
  });

  button.addEventListener("dragover", (ev) => {
    if (!draggedTab || draggedTab === tab) return;
    ev.preventDefault();
    const rect = button.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    if (ev.clientX < mid) {
      button.classList.add("drop-before");
      button.classList.remove("drop-after");
    } else {
      button.classList.add("drop-after");
      button.classList.remove("drop-before");
    }
  });

  button.addEventListener("dragleave", () => {
    button.classList.remove("drop-before", "drop-after");
  });

  button.addEventListener("drop", (ev) => {
    if (!draggedTab || draggedTab === tab) return;
    ev.preventDefault();
    button.classList.remove("drop-before", "drop-after");
    const fromIdx = tabs.indexOf(draggedTab);
    let toIdx = tabs.indexOf(tab);
    if (fromIdx < 0 || toIdx < 0) return;
    const rect = button.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    if (ev.clientX >= mid) {
      toIdx += 1;
    }
    tabs.splice(fromIdx, 1);
    const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
    tabs.splice(insertIdx, 0, draggedTab);
    for (const t of tabs) {
      tabsEl.appendChild(t.button);
    }
    persist();
  });

  // Double-click to rename tab
  button.addEventListener("dblclick", (ev) => {
    if (ev.target === close) return;
    ev.preventDefault();
    startRenameTab(tab);
  });

  close.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void requestCloseTab(tab);
  });

  tabsEl.appendChild(button);
  tabs.push(tab);
  return tab;
}

async function openTab(
  cwd: string,
  makeActive: boolean,
  customTitle?: string,
  colorTag?: string,
): Promise<Tab> {
  const tab = makeTab(cwd, customTitle, colorTag);
  if (makeActive) activate(tab);
  else renderTabs();
  await startSession(tab);
  renderTabs();
  persist();
  void api.addRecentFolder(cwd);
  return tab;
}

/** Spawn a new session in the default temp directory (C:\temp on Windows). */
async function addTab(): Promise<void> {
  const targetCwd = await api.defaultCwd();
  await openTab(targetCwd, true);
}

/** omp reads these leading characters as a mode switch rather than prose. */
const DIRECTIVE = /^\s*[/!$#]/;

/**
 * omp expands pasted image paths into `[Image #N, WxH]` atoms inside its own
 * editor. That redraw is usually ready within a frame or two; we used to wait
 * up to ~1.2s for a plain-text atom echo on the PTY, but the echo is often
 * SGR-heavy / not matched — so text sat behind a long timeout even though the
 * chip was already visible. A short fixed settle is enough.
 */
const ATTACH_SETTLE_MS = 70;
const EDITOR_SETTLE_MS = 16;

/**
 * Submit the dock as a single user turn:
 * 1) paste image/file paths (omp expands images into attachment atoms)
 * 2) brief settle so the editor owns the atoms
 * 3) append text on the SAME prompt line
 * 4) one CR
 */
async function submitDock(payload: DockPayload): Promise<void> {
  const tab = active;
  const view = tab?.view;
  if (!tab || !view) return;

  const hasImages = payload.imagePaths.length > 0;
  const hasOthers = payload.otherPaths.length > 0;
  const hasFiles = hasImages || hasOthers;
  const text = payload.text;
  const hasText = Boolean(text.trim());

  if (!hasFiles && !hasText) return;

  if (!hasFiles && hasText) {
    const parsed = parseModelSlashCommand(text);
    if (parsed.targetPlan !== undefined) {
      const target: PlanTarget =
        parsed.targetPlan === "toggle"
          ? (tab.plan.mode === "off" ? "on" : "off")
          : parsed.targetPlan;
      tab.plan.request(target, Date.now());
      if (!parsed.remainingSlashCommand) {
        return;
      }
      view.runSlash(parsed.remainingSlashCommand);
      return;
    }
  }

  if (hasImages) {
    view.paste(payload.imagePaths.map(quotePath).join(" "));
  }
  if (hasOthers) {
    view.paste(payload.otherPaths.map(quotePath).join(" "));
  }
  if (hasFiles) {
    await sleep(ATTACH_SETTLE_MS);
  }

  if (hasText) {
    // Append onto the same composer line as any attachment atoms.
    // Prefer type() so we don't open a second bracketed-paste "segment".
    const body = text.replace(/\r\n/g, "\n");
    if (!body.includes("\n")) {
      const chunk = DIRECTIVE.test(body) ? body.trimStart() : body;
      view.type(hasFiles ? ` ${chunk}` : chunk);
    } else {
      view.paste(hasFiles ? ` ${body}` : body);
      await sleep(EDITOR_SETTLE_MS);
    }
  }

  // Single submit for attachments + text together.
  view.submit();
}

/** Parse omp's terminal stream to extract active model, thinking level, plan state and usage metrics. */
function parseStatusStream(tab: Tab, rawData: string): void {
  const plain = rawData.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");

  // Plan lines must be handled before the statusline gate: "Plan mode paused."
  // and "Plan mode disabled." can arrive without a statusline.
  const planStatus = parsePlanStatus(plain);
  if (planStatus) tab.plan.observe(planStatus, Date.now());
  if (isPlanExitConfirm(plain)) tab.plan.confirmPrompt(Date.now());

  // Only parse explicit statusline or command feedback lines to prevent chat text matching
  const isStatusLine =
    /^\s*π\s+/m.test(plain) || /(?:^|\n)[^\n]*?Thinking level set to/i.test(plain);
  if (!isStatusLine) return;

  // Match Thinking level: e.g. "· ⃠ off", "· ◔ min", "· ◔ low", "Thinking level set to min"
  const thinkMatch =
    /(?:[·•│][^·•│📁\n]*?\b(off|min|minimal|low|med|medium|high|xhigh|max|auto)\b|\bthinking(?:\s+level)?\s+set\s+to\s+(off|min|minimal|low|med|medium|high|xhigh|max|auto))/i.exec(
      plain,
    );
  const raw = (thinkMatch?.[1] || thinkMatch?.[2])?.toLowerCase();
  if (raw) {
    const formatted = formatThinkingLevel(raw);
    tab.thinkingLevel = formatted;
    if (tab === active) {
      dock.setThinkingLevel(formatted);
    }
  }

  // Match Model name: e.g. "• Gemini 3.7 Flash ·" or "TheBox  │ ⬢ Claude 3.5 Sonnet ·"
  const modelMatch = /(?:[⬢•·]|\bmodel:\s*)\s*([A-Za-z0-9\s.-]{2,30}?)\s*[·•│]\s*[◔◕●○]/.exec(plain);
  if (modelMatch && modelMatch[1]) {
    const model = modelMatch[1].trim();
    if (model && model.length > 1 && !model.includes("TheBox") && !model.includes("omp")) {
      tab.modelName = model;
      if (tab === active) {
        applyModelToDock(model, tab.thinkingLevel, tab);
        modelModal?.setCurrentModel(model);
      }
    }
  }

  // Plan state is observed above and authoritatively published by
  // control-bridge; no speculative statusline glyph matching here.
}

const dock = new Dock({
  submit: (payload) => void submitDock(payload),
  interrupt: () => {
    if (!active) return;
    active.suppressDoneSound = true;
    sendToPty(active, "\x1b");
    setTabProgressBusy(active, false);
    setTabActivity(active, "idle");
  },
  focusTerminal: () => active?.view?.focus(),
  forwardChord: (ev) => active?.view?.forwardChord(ev) ?? false,
  type: (data) => active?.view?.type(data),
  writeTerminalRaw: (data) => active?.view?.writeRaw(data),
  wantsTerminalArrows: () => active?.view?.wantsArrowKeys() ?? false,
  writeTerminalArrow: (ev) => active?.view?.writeArrow(ev) ?? false,
  setPlanTarget: (target: PlanTarget) => active?.plan.request(target, Date.now()),
  openModel: () => {
    if (!modelModal) {
      modelModal = new ModelModal(
        customModels,
        active?.modelName ?? "gemini-3.7-flash",
        (modelId, provider) => {
          if (active?.view) {
            const cmdArg =
              provider && provider !== "generic" ? `${provider}/${modelId}` : modelId;
            active.view.runSlash(`/m ${cmdArg}`);
            active.modelName = modelId;
            applyModelToDock(modelId, active.thinkingLevel, active);
            persist();
          }
        },
        (customs) => {
          customModels = customs;
          persist();
        },
      );
      const modelWrap = document.getElementById("dock-model-wrap");
      if (modelWrap) {
        modelWrap.appendChild(modelModal.el);
      } else {
        const dockControls = document.getElementById("dock-controls");
        if (dockControls) dockControls.appendChild(modelModal.el);
        else document.body.appendChild(modelModal.el);
      }
    }
    modelModal.toggle(active?.modelName);
  },
  openUsage: () => {
    if (!usageModal) {
      usageModal = new UsageModal(() => {
        if (active?.view) active.view.runSlash("/stats");
      });
      const usageWrap = document.getElementById("dock-usage-wrap");
      if (usageWrap) {
        usageWrap.appendChild(usageModal.el);
      } else {
        const dockControls = document.getElementById("dock-controls");
        if (dockControls) dockControls.appendChild(usageModal.el);
        else document.body.appendChild(usageModal.el);
      }
    }
    usageModal.toggle();
  },
  openTools: () => {
    if (!dockToolsMenu) {
      dockToolsMenu = new DockToolsMenu({
        onCopy: () => {
          if (!active?.view) return;
          const sel = active.view.getSelection();
          if (sel) {
            void navigator.clipboard.writeText(sel);
          }
        },
        onPaste: () => {
          if (!active?.view) return;
          void navigator.clipboard.readText().then((text) => {
            if (text && active?.view) active.view.paste(text);
          });
        },
        onClear: () => {
          if (active) sendToPty(active, "\x0c");
        },
        onFind: () => {
          active?.view?.openSearch();
        },
        onZoomIn: () => {
          active?.view?.zoomIn();
        },
        onZoomOut: () => {
          active?.view?.zoomOut();
        },
        onZoomReset: () => {
          active?.view?.resetZoom();
        },
        onToggleExpand: () => {
          dock.toggleExpand();
        },
        onRestartSession: () => {
          if (active) void restartSession(active);
        },
      });
      const toolsWrap = document.getElementById("dock-tools-wrap");
      if (toolsWrap) {
        toolsWrap.appendChild(dockToolsMenu.el);
      } else {
        const dockControls = document.getElementById("dock-controls");
        if (dockControls) dockControls.appendChild(dockToolsMenu.el);
        else document.body.appendChild(dockToolsMenu.el);
      }
    }
    dockToolsMenu.toggle();
  },
  selectThinking: (level: string) => {
    if (!active?.view) return;
    const levels = dock.getThinkingLevels();
    const clamped = clampThinkingToLevels(level, levels);
    active.thinkingLevel = formatThinkingLevel(clamped);
    dock.setThinkingLevel(clamped);
    active.view.runSlash(`/m ${toThinkingCommandToken(clamped)}`);
  },
  changeCwd: async () => {
    if (!active) return;
    const chosen = await api.pickDirectory();
    if (!chosen || chosen === active.cwd) return;
    active.cwd = chosen;
    dock.setCwd(chosen);
    renderTabs();
    persist();
    if (active.view) {
      active.view.runSlash(`/move ${quotePath(chosen)}`);
    }
    void api.addRecentFolder(chosen);
    if (recentFoldersModal?.isOpen) {
      recentFoldersModal.setCurrentCwd(chosen);
    }
    if (recentChatsModal?.isOpen) {
      recentChatsModal.setCurrentCwd(chosen);
    }
  },
});

// Floating dock: keep terminal bottom padding in sync with dock height, but
// only when clearance changes enough that xterm may gain/lose a row.
{
  const dockEl = document.getElementById("dock");
  if (dockEl) {
    let lastClearance = -1;
    const syncDockClearance = (): void => {
      const rect = dockEl.getBoundingClientRect();
      const clearance = Math.ceil(rect.height + 26);
      if (Math.abs(clearance - lastClearance) < 2) return;
      lastClearance = clearance;
      document.documentElement.style.setProperty("--dock-clearance", `${clearance}px`);
      for (const tab of tabs) {
        tab.view?.refit();
      }
    };
    syncDockClearance();
    new ResizeObserver(() => syncDockClearance()).observe(dockEl);
  }
}

function isTerminalKeyTarget(el: Element | null): boolean {
  if (!el || !active?.view) return false;
  if (active.view.el.contains(el)) return true;
  // xterm keeps a hidden textarea; it may not always sit inside .view in edge cases.
  if (el instanceof HTMLTextAreaElement && el.classList.contains("xterm-helper-textarea")) {
    return true;
  }
  return false;
}

/** Hide is deferred to the exit animation, matching the jump-to-latest pill. */
function setKeyTargetVisible(visible: boolean): void {
  if (!keyTargetIndicator) return;
  if (visible) {
    keyTargetIndicator.classList.remove("leaving");
    keyTargetIndicator.hidden = false;
    return;
  }
  if (keyTargetIndicator.hidden || keyTargetIndicator.classList.contains("leaving")) return;
  keyTargetIndicator.classList.add("leaving");
}

function updateKeyTargetIndicator(): void {
  if (!keyTargetIndicator) return;
  const terminalOwnsKeys = isTerminalKeyTarget(document.activeElement);
  setKeyTargetVisible(terminalOwnsKeys);
  keyTargetIndicator.dataset.target = terminalOwnsKeys ? "terminal" : "dock";
  const label = keyTargetIndicator.querySelector(".key-target-label");
  if (label) label.textContent = "Terminal";
}

keyTargetIndicator?.addEventListener("animationend", (ev) => {
  if (ev.animationName === "term-jump-out" && keyTargetIndicator.classList.contains("leaving")) {
    keyTargetIndicator.classList.remove("leaving");
    keyTargetIndicator.hidden = true;
  }
});

document.addEventListener("focusin", () => updateKeyTargetIndicator());
document.addEventListener("focusout", () => {
  // focusout fires before the next focusin; defer so activeElement is settled.
  queueMicrotask(() => updateKeyTargetIndicator());
});
window.addEventListener("blur", () => setKeyTargetVisible(false));
window.addEventListener("focus", () => updateKeyTargetIndicator());
updateKeyTargetIndicator();
api.onData(({ id, data }) => {
  const tab = bySession.get(id);
  if (!tab?.view) return;
  tab.view.feed(data, () => api.ack(id));
  parseStatusStream(tab, data);
});

/** Route control-bridge telemetry to the owning tab only. */
function findTabForBridgeStatus(status: {
  sessionId?: string | null;
  pid?: number;
  cwd?: string | null;
}): Tab | undefined {
  const rawKey = status.sessionId?.trim();
  if (rawKey) {
    const key = rawKey.includes(":") ? rawKey.slice(rawKey.lastIndexOf(":") + 1) : rawKey;
    const byKey = tabs.find((t) => t.sessionKey === key || t.sessionId === key);
    // Session id is authoritative. Unknown ids must not fall through to another tab.
    return byKey;
  }

  if (typeof status.pid === "number" && status.pid > 0) {
    const byPid = tabs.find((t) => t.ompPid === status.pid);
    if (byPid) return byPid;
  }

  // No session id (older hosts): only unambiguous ownership.
  if (tabs.length === 1) return tabs[0];

  const statusCwd = (status.cwd || "").replace(/[\\/]+$/, "").toLowerCase();
  if (statusCwd) {
    const matches = tabs.filter(
      (t) => t.cwd.replace(/[\\/]+$/, "").toLowerCase() === statusCwd,
    );
    if (matches.length === 1) return matches[0];
  }

  return undefined;
}

function applyControlBridgeStatus(status: ControlBridgeState | null | undefined): void {
  if (!status) return;

  const tab = findTabForBridgeStatus(status);
  if (!tab) return;

  // Bind/refresh the stable session key when the bridge reports one.
  const rawKey = status.sessionId?.trim();
  if (rawKey) {
    const key = rawKey.includes(":") ? rawKey.slice(rawKey.lastIndexOf(":") + 1) : rawKey;
    tab.sessionKey = key;
  }
  if (typeof status.pid === "number" && status.pid > 0) {
    tab.ompPid = status.pid;
  }

  const activity: ControlBridgeActivity = KNOWN_ACTIVITIES.includes(status.activity)
    ? status.activity
    : "idle";
  setTabActivity(tab, activity);

  // Always keep per-tab session state up to date, even when backgrounded.
  if (status.model) {
    tab.modelName = status.model;
  }
  if (status.thinkingLevel) {
    tab.thinkingLevel = formatThinkingLevel(status.thinkingLevel);
  }
  if (status.planMode) {
    tab.plan.observe(status.planMode, Date.now());
  }
  if ("ask" in status) {
    tab.pendingAsk = status.ask ?? null;
    if (tab.pendingAsk && tab.pendingAsk.toolCallId !== tab.dismissedAskToolCallId) {
      tab.dismissedAskToolCallId = null;
    }
  }
  if ("todo" in status) {
    tab.todo = status.todo ?? null;
  }

  // Dock / shared chrome only follows the active session.
  if (tab !== active) return;

  if (status.model) {
    applyModelToDock(status.model, tab.thinkingLevel, tab);
    modelModal?.setCurrentModel(status.model);
  } else if (status.thinkingLevel) {
    dock.setThinkingLevel(tab.thinkingLevel);
  }
  syncAskModal(tab);
  todoPanel.setPhases(tab.todo);
}

api.onControlBridgeStatus((status) => {
  applyControlBridgeStatus(status);
});

// Periodically verify terminal model, thinking level, and plan state stay 100% synced with UI
setInterval(async () => {
  try {
    const status = await api.readControlBridgeStatus();
    if (status) applyControlBridgeStatus(status);
  } catch {}
}, 2000);

// Retry a plan cycle step that a modal swallowed; bounded by PLAN_MAX_ATTEMPTS.
setInterval(() => {
  const now = Date.now();
  for (const tab of tabs) tab.plan.tick(now);
}, 500);


api.onExit(({ id, exitCode }) => {
  const tab = bySession.get(id);
  if (!tab) return;
  bySession.delete(id);
  tab.sessionId = null;
  tab.sessionKey = null;
  tab.ompPid = null;
  tab.suppressDoneSound = true;
  setTabActivity(tab, "idle");
  tab.view?.dispose();
  tab.view = null;
  showNotice(tab, `omp exited (code ${exitCode})`);
  renderTabs();
});

const dndOverlay = document.getElementById("dnd-overlay") as HTMLDivElement | null;
const dndOverlaySub = document.getElementById("dnd-overlay-sub") as HTMLSpanElement | null;

/** Every external drag, regardless of what is focused, attaches to the dock. */
function setDropOverlay(visible: boolean, count: number): void {
  document.body.classList.toggle("dnd-hover", visible);
  if (!dndOverlay) return;
  if (visible) {
    dndOverlay.classList.remove("leaving");
    dndOverlay.hidden = false;
    if (dndOverlaySub) {
      dndOverlaySub.textContent =
        count > 1 ? `${count} items → composer` : "Attaches to the composer";
    }
    return;
  }
  // Held until the exit animation ends — dropping or leaving both fade out.
  if (dndOverlay.hidden || dndOverlay.classList.contains("leaving")) return;
  dndOverlay.classList.add("leaving");
}

dndOverlay?.addEventListener("animationend", (ev) => {
  if (ev.animationName === "dnd-fade-out" && dndOverlay.classList.contains("leaving")) {
    dndOverlay.classList.remove("leaving");
    dndOverlay.hidden = true;
  }
});

installWindowDnd({
  onPaths: (paths) => dock.addPaths(paths),
  onText: (text) => dock.insertDroppedText(text),
  onHover: setDropOverlay,
});

newTabButton.addEventListener("click", () => void addTab());

headerUsage.addEventListener("click", () => {
  dockHooksUsage();
});

function dockHooksUsage(): void {
  if (!usageModal) {
    usageModal = new UsageModal(() => {
      if (active?.view) active.view.runSlash("/stats");
    });
    const usageWrap = document.getElementById("dock-usage-wrap");
    if (usageWrap) {
      usageWrap.appendChild(usageModal.el);
    } else {
      const dockControls = document.getElementById("dock-controls");
      if (dockControls) dockControls.appendChild(usageModal.el);
      else document.body.appendChild(usageModal.el);
    }
  }
  usageModal.toggle();
}
function openRecentFoldersModal(): void {
  if (!recentFoldersModal) {
    recentFoldersModal = new RecentFoldersModal(recentFoldersBtn, {
      onSelectFolder: (folder, newTab) => {
        if (newTab) {
          void openTab(folder, true);
        } else if (active) {
          if (active.cwd.replace(/[\\/]+$/, "").toLowerCase() === folder.replace(/[\\/]+$/, "").toLowerCase()) {
            active.view?.focus();
            return;
          }
          active.cwd = folder;
          dock.setCwd(folder);
          renderTabs();
          persist();
          void api.addRecentFolder(folder);
          if (active.view) {
            active.view.runSlash(`/move ${quotePath(folder)}`);
            active.view.focus();
          }
          if (recentChatsModal?.isOpen) {
            recentChatsModal.setCurrentCwd(folder);
          }
        }
      },
      onOpenNewFolder: async () => {
        const chosen = await api.pickDirectory();
        if (!chosen) return;
        void api.addRecentFolder(chosen);
        if (active) {
          active.cwd = chosen;
          dock.setCwd(chosen);
          renderTabs();
          persist();
          if (active.view) {
            active.view.runSlash(`/move ${quotePath(chosen)}`);
            active.view.focus();
          }
        }
      },
      onShowInExplorer: (folder) => {
        void api.openPath(folder);
      },
    });
  }
  recentFoldersModal.setPanelPosition(panelPosition);
  recentFoldersModal.toggle(active?.cwd);
}

function openRecentChatsModal(): void {
  if (!recentChatsModal) {
    recentChatsModal = new RecentChatsModal(recentChatsBtn, {
      onResumeChat: (sessionId) => {
        if (active?.view) {
          active.view.runSlash(`/resume ${sessionId}`);
          active.view.focus();
        }
      },
      onTriggerResumePicker: () => {
        if (active?.view) {
          active.view.runSlash(`/resume`);
          active.view.focus();
        }
      },
      onNewChat: () => {
        if (active?.view) {
          active.view.runSlash(`/new`);
          active.view.focus();
        }
      },
    });
  }
  const currentCwd = active?.cwd ?? "";
  recentChatsModal.setPanelPosition(panelPosition);
  recentChatsModal.toggle(currentCwd, active?.sessionKey ?? active?.sessionId);
}

function openSettingsModal(): void {
  if (!settingsModal) {
    settingsModal = new SettingsModal({
      initialThemeName: currentPreset.name,
      showUsageInHeader,
      initialFontFamily: customFontFamily,
      initialActivityColors: activityColors,
      initialActivityColorsOnTabs: activityColorsOnTabs,
      hideTopButtonLabels,
      hideBottomButtonLabels,
      collapseTopBarToMenu,
      panelPosition,
      onSelect: (preset) => {
        applyTheme(preset);
        persist();
      },
      onToggleUsageHeader: (show) => {
        showUsageInHeader = show;
        updateHeaderUsageVisibility();
        persist();
      },
      onFontChange: (family) => {
        applyFont(family);
        persist();
      },
      onActivityColorChange: (key, color) => setActivityColor(key, color),
      onResetActivityColors: () => resetActivityColors(),
      onToggleActivityColorsOnTabs: (enabled) => setActivityColorsOnTabs(enabled),
      onToggleHideTopButtonLabels: (hide) => {
        hideTopButtonLabels = hide;
        applyButtonLabelVisibility();
        persist();
      },
      onToggleHideBottomButtonLabels: (hide) => {
        hideBottomButtonLabels = hide;
        applyButtonLabelVisibility();
        persist();
      },
      onToggleCollapseTopBarToMenu: (collapse) => {
        collapseTopBarToMenu = collapse;
        applyButtonLabelVisibility();
        persist();
      },
      onPanelPositionChange: (pos) => {
        panelPosition = pos;
        recentFoldersModal?.setPanelPosition(pos);
        recentChatsModal?.setPanelPosition(pos);
        persist();
      },
      initialScrollSteps: terminalScrollSteps,
      onScrollStepsChange: (steps) => {
        applyScrollSteps(steps);
        persist();
      },
      doneSoundEnabled,
      doneSoundVolume,
      onToggleDoneSound: (enabled) => {
        doneSoundEnabled = enabled;
        doneSound.setEnabled(enabled);
        if (enabled) doneSound.play(true);
        persist();
      },
      onDoneSoundVolumeChange: (volume) => {
        doneSoundVolume = clampVolume(volume);
        doneSound.setVolume(doneSoundVolume);
        persist();
      },
      onPreviewDoneSound: () => doneSound.play(true),
    });
    document.body.appendChild(settingsModal.el);
  }
  settingsModal.syncState({
    themeName: currentPreset.name,
    showUsageInHeader,
    fontFamily: customFontFamily,
    activityColors,
    activityColorsOnTabs,
    hideTopButtonLabels,
    hideBottomButtonLabels,
    collapseTopBarToMenu,
    panelPosition,
    scrollSteps: terminalScrollSteps,
    doneSoundEnabled,
    doneSoundVolume,
  });
  settingsModal.open();
}

todoBtn.addEventListener("click", () => todoPanel.toggle());
recentFoldersBtn.addEventListener("click", () => openRecentFoldersModal());
recentChatsBtn.addEventListener("click", () => openRecentChatsModal());
settingsBtn.addEventListener("click", () => openSettingsModal());

topMenuBtn?.addEventListener("click", () => {
  if (!topMenu && topMenuBtn) {
    topMenu = new TopMenu(topMenuBtn, {
      onOpenTodo: () => todoPanel.toggle(),
      onOpenSettings: () => openSettingsModal(),
      onRelaunch: () => {
        persist();
        api.relaunchApp();
      },
      onQuit: () => {
        persist();
        api.quitApp();
      },
    });
  }
  topMenu?.toggle();
});

relaunchBtn?.addEventListener("click", () => {
  persist();
  api.relaunchApp();
});

quitBtn?.addEventListener("click", () => {
  persist();
  api.quitApp();
});

window.addEventListener(
  "keydown",
  (ev) => {
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && active?.view) {
      if (ev.key === "Enter" || ev.code === "Enter" || ev.code === "NumpadEnter") {
        ev.preventDefault();
        ev.stopPropagation();
        active.view.writeRaw("\r");
        return;
      }
      if (ev.key === "ArrowUp" || ev.key === "ArrowDown" || ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        ev.preventDefault();
        ev.stopPropagation();
        active.view.writeArrow({
          key: ev.key,
          code: ev.code,
          altKey: false,
          shiftKey: ev.shiftKey,
          ctrlKey: false,
          metaKey: false,
        });
        return;
      }
    }

    if (!ev.ctrlKey || ev.altKey || !active) return;
    const key = ev.key.toLowerCase();
    const claim = (): void => {
      ev.preventDefault();
      ev.stopPropagation();
    };

    if (ev.shiftKey) {
      switch (key) {
        case "enter":
          claim();
          if (dock.isFocused) dock.toggleExpanded();
          else dock.focus();
          return;
        case "t":
          claim();
          void addTab();
          return;
        case "w":
          claim();
          void requestCloseTab(active);
          return;
        case "f":
          claim();
          active.view?.toggleSearch();
          return;
        case "tab":
          claim();
          cycleTab(-1);
          return;
        default:
          return;
      }
    }
    if (key === "=" || key === "+") {
      claim();
      active.view?.zoomIn();
      return;
    }
    if (key === "-" || key === "_") {
      claim();
      active.view?.zoomOut();
      return;
    }
    if (key === "0") {
      claim();
      active.view?.resetZoom();
      return;
    }
    if (key === "tab") {
      claim();
      cycleTab(1);
    }
  },
  { capture: true },
);

window.addEventListener("beforeunload", () => {
  persist();
  for (const tab of tabs) {
    if (tab.sessionId) api.kill(tab.sessionId);
  }
});

async function boot(): Promise<void> {
  const state = await api.loadState();
  if (state.themeName) {
    applyTheme(getThemeByName(state.themeName));
  }
  if (typeof state.fontFamily === "string" && state.fontFamily) {
    applyFont(state.fontFamily);
  }
  if (typeof state.fontSize === "number" && Number.isFinite(state.fontSize)) {
    terminalFontSize = Math.min(32, Math.max(8, Math.round(state.fontSize)));
  }
  if (typeof state.scrollSteps === "number") {
    terminalScrollSteps = clampScrollSteps(state.scrollSteps);
  }
  if (typeof state.doneSoundEnabled === "boolean") {
    doneSoundEnabled = state.doneSoundEnabled;
    doneSound.setEnabled(doneSoundEnabled);
  }
  if (typeof state.doneSoundVolume === "number") {
    doneSoundVolume = clampVolume(state.doneSoundVolume);
    doneSound.setVolume(doneSoundVolume);
  }
  if (state.activityColors) {
    activityColors = { ...DEFAULT_ACTIVITY_COLORS, ...state.activityColors };
  }
  if (typeof state.activityColorsOnTabs === "boolean") {
    activityColorsOnTabs = state.activityColorsOnTabs;
  }
  applyActivityColors();
  if (typeof state.todoPanelVisible === "boolean") {
    todoPanelVisible = state.todoPanelVisible;
  }
  if (state.todoPanelMode === "overlay" || state.todoPanelMode === "docked") {
    todoPanelMode = state.todoPanelMode;
  }
  todoPanel.init(todoPanelVisible, todoPanelMode);
  if (state.favoriteModels) {
    favoriteModels = state.favoriteModels;
  }
  if (state.customModels) {
    customModels = state.customModels;
  }
  if (typeof state.showFavoritesOnly === "boolean") {
    showFavoritesOnly = state.showFavoritesOnly;
  }
  if (typeof state.showUsageInHeader === "boolean") {
    showUsageInHeader = state.showUsageInHeader;
  }
  if (typeof state.hideTopButtonLabels === "boolean") {
    hideTopButtonLabels = state.hideTopButtonLabels;
  }
  if (typeof state.hideBottomButtonLabels === "boolean") {
    hideBottomButtonLabels = state.hideBottomButtonLabels;
  }
  if (typeof state.collapseTopBarToMenu === "boolean") {
    collapseTopBarToMenu = state.collapseTopBarToMenu;
  }
  applyButtonLabelVisibility();
  if (state.panelPosition) {
    panelPosition = state.panelPosition;
  }
  updateHeaderUsageVisibility();
  void refreshHeaderUsage();

  const list = state.tabs.length
    ? state.tabs
    : [{ cwd: (await api.pickDirectory()) ?? (await api.homeDir()) }];
  for (const [index, entry] of list.entries()) {
    await openTab(
      entry.cwd,
      index === Math.min(state.activeIndex, list.length - 1),
      entry.customTitle,
      entry.colorTag,
    );
  }
  dock.focus();

  try {
    const groups = await api.getModels();
    installedModels = groups.flatMap((g) => g.models);
  } catch {
    installedModels = [];
  }

  try {
    const initStatus = await api.readControlBridgeStatus();
    if (initStatus) {
      applyControlBridgeStatus(initStatus);
    } else if (active?.modelName) {
      applyThinkingLevelsForModel(active.modelName, active.thinkingLevel);
    }
  } catch {}
}

void boot();
