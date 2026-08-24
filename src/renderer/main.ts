import {
  IMAGE_EXT,
  quotePath,
  type CustomModelConfig,
  type InstalledModel,
  type TabState,
} from "../shared/ipc";
import {
  DEFAULT_THEME_NAME,
  getThemeByName,
  type ThemePreset,
} from "./theme";
import {
  Dock,
  buildThinkingLevelsForModel,
  clampThinkingToLevels,
  formatThinkingLevel,
  normalizeThinkingToken,
  toThinkingCommandToken,
  type DockPayload,
  type DockState,
  type PlanState,
} from "./dock";
import { installWindowDnd } from "./dnd";
import { DEFAULT_USER_MODELS, ModelModal } from "./model-modal";
import { SettingsModal } from "./settings";
import { TabContextMenu, TAB_COLOR_PRESETS } from "./tab-menu";
import { TermView } from "./term-view";
import { DockToolsMenu } from "./dock-tools-menu";
import { UsageModal } from "./usage-modal";
const api = window.omphif;

const tabsEl = document.getElementById("tabs") as HTMLDivElement;
const viewsEl = document.getElementById("views") as HTMLDivElement;
const newTabButton = document.getElementById("new-tab") as HTMLButtonElement;
const settingsBtn = document.getElementById("btn-settings") as HTMLButtonElement;
const headerUsage = document.getElementById("header-usage") as HTMLDivElement;
const headerUsageText = document.getElementById("header-usage-text") as HTMLSpanElement;

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
  planState: PlanState;
  /** Combined busy for the tab chrome (progress OSC and/or agent activity). */
  busy: boolean;
  /** ConEmu OSC 9;4 progress (indeterminate while agent runs). */
  progressBusy: boolean;
  /** control-bridge activity classification. */
  activity: "idle" | "working" | "thinking";
  /** Clears stuck progressBusy if omp never sends 9;4;0. */
  progressBusyTimer: number | null;
  button: HTMLButtonElement;
  colorDot: HTMLSpanElement;
  label: HTMLSpanElement;
  notice: HTMLDivElement | null;
  dock: DockState | undefined;
};

const tabs: Tab[] = [];
const bySession = new Map<string, Tab>();
let active: Tab | null = null;
let draggedTab: Tab | null = null;
let currentPreset: ThemePreset = getThemeByName(DEFAULT_THEME_NAME);
let favoriteModels: string[] = ["gemini-3.7-flash", "claude-3-7-sonnet", "gpt-4o"];
let customModels: CustomModelConfig[] = [];
let installedModels: InstalledModel[] = [];
let showFavoritesOnly = false;
let showUsageInHeader = true;

let settingsModal: SettingsModal | null = null;
let modelModal: ModelModal | null = null;
let usageModal: UsageModal | null = null;
let dockToolsMenu: DockToolsMenu | null = null;
const tabContextMenu = new TabContextMenu();

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

function applyThinkingLevelsForModel(modelSpec: string, currentLevel?: string): void {
  const installed = findInstalledModel(modelSpec);
  const levels = buildThinkingLevelsForModel(installed);
  const cur = currentLevel ?? active?.thinkingLevel ?? "low";
  const clamped = clampThinkingToLevels(cur, levels);
  dock.setThinkingLevels(levels, clamped);
  if (active) active.thinkingLevel = formatThinkingLevel(clamped);
}

function applyModelToDock(modelSpec: string): void {
  const allModels = customModels.length > 0 ? customModels : DEFAULT_USER_MODELS;
  if (!modelSpec) {
    dock.setModel("Model");
    applyThinkingLevelsForModel("");
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
  if (found) {
    dock.setModel(found.name, found.iconUrl, found.provider);
  } else {
    const parts = modelSpec.split("/");
    const provider = parts.length > 1 ? parts[0] : undefined;
    const name = parts.length > 1 ? parts[1] : modelSpec;
    dock.setModel(name!, undefined, provider);
  }
  applyThinkingLevelsForModel(modelSpec, active?.thinkingLevel);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Drive omp's real plan mode via native `/plan` and Alt+Shift+P.
 * control-bridge `/m plan` only flips an extension-local flag — it does NOT
 * call InteractiveSession.handlePlanModeCommand / #_t.
 *
 * Native cycle: OFF → ON → PAUSED → OFF
 */
async function applyPlanMode(next: "on" | "off"): Promise<void> {
  const tab = active;
  const view = tab?.view;
  if (!tab || !view) return;

  const cur: "on" | "off" | "paused" =
    tab.planState === "on" ? "on" : tab.planState === "paused" ? "paused" : "off";

  if (next === "on" && cur === "on") return;
  if (next === "off" && cur === "off") return;

  const fire = (): void => {
    // Native slash command → InteractiveSession.handlePlanModeCommand → #_t/#Pt
    view.runSlash("/plan");
  };

  try {
    if (next === "on") {
      if (cur === "paused") {
        // PAUSED → OFF, then OFF → ON
        fire();
        await sleep(120);
      }
      fire();
      tab.planState = "on";
      dock.setPlanState("on");
      return;
    }

    // next === "off"
    if (cur === "on") {
      // ON → PAUSED, then PAUSED → OFF
      fire();
      await sleep(120);
      fire();
    } else {
      // PAUSED → OFF
      fire();
    }
    tab.planState = "off";
    dock.setPlanState("off");
  } catch {
    // Stream / bridge will reconcile.
  }
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
  ["", "omp", "oh my pi", "oh-my-pi", "omphif", "terminal", "bash", "pwsh", "powershell", "cmd"].map(
    (s) => s.toLowerCase(),
  ),
);

function cleanAutoTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let t = raw.replace(/\s+/g, " ").trim();
  // Common terminal title shapes: "name — path", "name - path", "user@host: path"
  t = t.split(/\s+[—–|•]\s+/)[0]?.trim() || t;
  t = t.split(/\s+-\s+/)[0]?.trim() || t;
  if (t.length > 48) t = `${t.slice(0, 45).trimEnd()}…`;
  if (GENERIC_TITLES.has(t.toLowerCase())) return undefined;
  return t || undefined;
}

/** Prefer manual rename, then omp auto-title, then folder name. */
function tabDisplayName(tab: Tab): string {
  if (tab.customTitle?.trim()) return tab.customTitle.trim();
  const auto = cleanAutoTitle(tab.title);
  if (auto) return auto;
  const folder = basename(tab.cwd);
  return folder || "OMP";
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
  });
}

function sendToPty(tab: Tab, data: string): void {
  if (tab.sessionId) api.write(tab.sessionId, data);
  else tab.pending.push(data);
}

/**
 * Write filesystem paths as bracketed pastes. Images go in one paste of their own:
 * omp attaches a multi-path paste only when *every* token is an image path.
 */
function pastePaths(tab: Tab, paths: readonly string[]): void {
  const images = paths.filter((p) => IMAGE_EXT.test(p));
  const others = paths.filter((p) => !IMAGE_EXT.test(p));
  if (images.length) tab.view?.paste(images.map(quotePath).join(" "));
  if (others.length) tab.view?.paste(others.map(quotePath).join(" "));
}

function renderTabs(): void {
  for (const tab of tabs) {
    const name = tabDisplayName(tab);
    tab.button.classList.toggle("active", tab === active);
    tab.button.classList.toggle("busy", tab.busy);
    tab.button.classList.toggle("thinking", tab.activity === "thinking");
    tab.label.textContent = name;

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
function syncTabBusy(tab: Tab): void {
  const next = tab.progressBusy || tab.activity !== "idle";
  if (tab.busy !== next) tab.busy = next;
  renderTabs();
  if (tab === active) {
    dock.setAgentBusy(next, next ? tab.activity : "idle");
  }
}

/** OSC 9;4 progress — omp pulses state 3 while running, 0 when idle. */
function setTabProgressBusy(tab: Tab, busy: boolean): void {
  if (tab.progressBusyTimer !== null) {
    window.clearTimeout(tab.progressBusyTimer);
    tab.progressBusyTimer = null;
  }
  tab.progressBusy = busy;
  if (busy) {
    // omp's own interval is 30s; if we never see 9;4;0, drop the spinner.
    tab.progressBusyTimer = window.setTimeout(() => {
      tab.progressBusyTimer = null;
      if (!tab.progressBusy) return;
      tab.progressBusy = false;
      syncTabBusy(tab);
    }, 8000);
  }
  syncTabBusy(tab);
}

function setTabActivity(tab: Tab, activity: "idle" | "working" | "thinking"): void {
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
  if (usageModal?.isOpen) void usageModal.open();
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
  if (tab.modelName) applyModelToDock(tab.modelName);
  if (tab.thinkingLevel) dock.setThinkingLevel(tab.thinkingLevel);
  dock.setPlanState(tab.planState);
  dock.setAgentBusy(tab.busy, tab.busy ? tab.activity : "idle");
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
  persist();
  if (tabs.length === 0) window.close();
}

function closeOtherTabs(target: Tab): void {
  const toClose = tabs.filter((t) => t !== target);
  for (const t of toClose) {
    closeTab(t);
  }
}

function closeTabsToRight(target: Tab): void {
  const index = tabs.indexOf(target);
  if (index < 0) return;
  const toClose = tabs.slice(index + 1);
  for (const t of toClose) {
    closeTab(t);
  }
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
    if (!val || val === "OMP" || (auto && val === auto)) {
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
  return new TermView(
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
        setTabProgressBusy(tab, false);
        setTabActivity(tab, "idle");
      },
    },
    currentPreset,
  );
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

  const busy = document.createElement("span");
  busy.className = "tab-busy";
  const colorDot = document.createElement("span");
  colorDot.className = "tab-color-dot";
  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = customTitle || "OMP";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "tab-close";
  close.textContent = "\u00d7";
  close.setAttribute("aria-label", "Close tab");
  button.append(busy, colorDot, label, close);

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
    planState: "off",
    busy: false,
    progressBusy: false,
    activity: "idle",
    progressBusyTimer: null,
    button,
    colorDot,
    label,
    notice: null,
    dock: undefined,
  };

  button.addEventListener("mousedown", (ev) => {
    if (ev.button === 1) {
      ev.preventDefault();
      closeTab(tab);
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
        closeTab(tab);
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
    closeTab(tab);
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
  return tab;
}

/** Spawn a new session in the current tab's directory without opening a folder picker. Default name is OMP. */
async function addTab(): Promise<void> {
  const targetCwd = active ? active.cwd : await api.homeDir();
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
  const plain = rawData.replace(/\x1b\[[0-9;?<>]*[a-zA-Z]/g, "");

  // Match Thinking level: e.g. "· ⃠ off", "· ◔ min", "· ◔ low", "· ◔ medium", "Thinking level set to min", etc.
  const thinkMatch =
    /(?:[·•│][^·•│📁\n]*?\b(off|min|minimal|low|med|medium|high|xhigh|max|auto)\b|\bthinking(?:\s+level)?(?:\s+set\s+to|:)?\s+(off|min|minimal|low|med|medium|high|xhigh|max|auto))/i.exec(
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
        applyModelToDock(model);
        modelModal?.setCurrentModel(model);
      }
    }
  }

  // Match Plan mode status in output (on / paused / off)
  if (/Plan:\s*on\b/i.test(plain) || /plan mode (?:enabled|active)/i.test(plain)) {
    tab.planState = "on";
    if (tab === active) dock.setPlanState("on");
  } else if (/Plan:\s*paused?\b/i.test(plain) || /plan mode paused/i.test(plain)) {
    tab.planState = "paused";
    if (tab === active) dock.setPlanState("paused");
  } else if (/Plan:\s*off\b/i.test(plain) || /plan mode (?:disabled|inactive)/i.test(plain)) {
    tab.planState = "off";
    if (tab === active) dock.setPlanState("off");
  }
}

const dock = new Dock({
  submit: (payload) => void submitDock(payload),
  interrupt: () => {
    if (!active) return;
    sendToPty(active, "\x03");
    setTabProgressBusy(active, false);
    setTabActivity(active, "idle");
  },
  focusTerminal: () => active?.view?.focus(),
  forwardChord: (ev) => active?.view?.forwardChord(ev) ?? false,
  type: (data) => active?.view?.type(data),
  togglePlan: (next) => {
    void applyPlanMode(next);
  },
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
            applyModelToDock(modelId);
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
      document.body.appendChild(usageModal.el);
    }
    void usageModal.open();
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
  cycleThinking: () => {
    if (!active?.view) return;
    const levels = dock.getThinkingLevels();
    if (levels.length <= 1) return;
    const cur = normalizeThinkingToken(active.thinkingLevel || "low");
    let idx = levels.indexOf(cur);
    if (idx < 0) idx = levels.indexOf(clampThinkingToLevels(cur, levels));
    if (idx < 0) idx = 0;
    const next = levels[(idx + 1) % levels.length] ?? levels[0]!;
    active.thinkingLevel = formatThinkingLevel(next);
    dock.setThinkingLevel(next);
    active.view.runSlash(`/m ${toThinkingCommandToken(next)}`);
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
  },
});

api.onData(({ id, data }) => {
  const tab = bySession.get(id);
  if (!tab?.view) return;
  tab.view.feed(data, () => api.ack(id));
  parseStatusStream(tab, data);
});

/** Route control-bridge telemetry to the owning tab — never guess by active/cwd alone. */
function findTabForBridgeStatus(status: {
  sessionId?: string | null;
  pid?: number;
  cwd?: string | null;
}): Tab | undefined {
  const rawKey = status.sessionId?.trim();
  if (rawKey) {
    const key = rawKey.includes(":") ? rawKey.slice(rawKey.lastIndexOf(":") + 1) : rawKey;
    const byKey = tabs.find((t) => t.sessionKey === key || t.sessionId === key);
    if (byKey) return byKey;
  }

  if (typeof status.pid === "number" && status.pid > 0) {
    const byPid = tabs.find((t) => t.ompPid === status.pid);
    if (byPid) return byPid;
  }

  // Single-tab apps can use cwd; multi-tab same-cwd must not steal busy state.
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

api.onControlBridgeStatus((status) => {
  if (!status) return;

  const tab = findTabForBridgeStatus(status);
  if (!tab) return;

  const activity =
    status.activity === "thinking" || status.activity === "working"
      ? status.activity
      : "idle";
  setTabActivity(tab, activity);

  // Dock chrome only follows the active tab.
  if (tab !== active) return;

  if (status.model) {
    tab.modelName = status.model;
    applyModelToDock(status.model);
    modelModal?.setCurrentModel(status.model);
  }

  if (status.thinkingLevel) {
    tab.thinkingLevel = formatThinkingLevel(status.thinkingLevel);
    dock.setThinkingLevel(tab.thinkingLevel);
  }

  if (typeof status.plan === "boolean") {
    tab.planState = status.plan ? "on" : "off";
    dock.setPlanState(tab.planState);
  }
});

api.onExit(({ id, exitCode }) => {
  const tab = bySession.get(id);
  if (!tab) return;
  bySession.delete(id);
  tab.sessionId = null;
  tab.sessionKey = null;
  tab.ompPid = null;
  setTabActivity(tab, "idle");
  tab.view?.dispose();
  tab.view = null;
  showNotice(tab, `omp exited (code ${exitCode})`);
  renderTabs();
});

installWindowDnd((paths) => {
  if (active?.view && !dock.isFocused && document.activeElement !== document.body) {
    pastePaths(active, paths);
    return;
  }
  dock.addPaths(paths);
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
    document.body.appendChild(usageModal.el);
  }
  void usageModal.open();
}

settingsBtn.addEventListener("click", () => {
  if (!settingsModal) {
    settingsModal = new SettingsModal(
      currentPreset.name,
      showUsageInHeader,
      (preset) => {
        applyTheme(preset);
        persist();
      },
      (show) => {
        showUsageInHeader = show;
        updateHeaderUsageVisibility();
        persist();
      },
    );
    document.body.appendChild(settingsModal.el);
  }
  settingsModal.open();
});

window.addEventListener(
  "keydown",
  (ev) => {
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
          closeTab(active);
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
  for (const tab of tabs) {
    if (tab.sessionId) api.kill(tab.sessionId);
  }
});

async function boot(): Promise<void> {
  const state = await api.loadState();
  if (state.themeName) {
    applyTheme(getThemeByName(state.themeName));
  }
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
    if (initStatus && active) {
      if (initStatus.model) {
        active.modelName = initStatus.model;
        applyModelToDock(initStatus.model);
      }
      if (initStatus.thinkingLevel) {
        applyThinkingLevelsForModel(active.modelName, initStatus.thinkingLevel);
      }
      if (typeof initStatus.plan === "boolean") {
        active.planState = initStatus.plan ? "on" : "off";
        dock.setPlanState(active.planState);
      }
    } else if (active?.modelName) {
      applyThinkingLevelsForModel(active.modelName, active.thinkingLevel);
    }
  } catch {}
}

void boot();
