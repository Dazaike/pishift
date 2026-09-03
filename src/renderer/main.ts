import appIcon from "./assets/icons/icon.png";
import settingsIcon from "./assets/icons/settings.png";
import {
  DEFAULT_ACTIVITY_COLORS,
  GLOW_ACTIVITIES,
  GLOW_ACTIVITY_LABELS,
  quotePath,
  type AsyncJob,
  type ControlBridgeActivity,
  type ControlBridgeState,
  isJobLifecycleUpdate,
  type CustomModelConfig,
  type GlowActivity,
  type InstalledModel,
  type PanelPosition,
  type PendingAsk,
  type ProviderUsageReport,
  type TabState,
  type ViewMode,
  type TodoPhase,
} from "../shared/ipc";
import { parseModelSlashCommand } from "../shared/model-command";
import { findInstalledModel } from "../shared/model-match";
import { ASK_ENTER_GAP_MS, ASK_KEY_GAP_MS, buildAskDialogSteps, type AskAnswer } from "../shared/ask-keys";
import { formatElapsed } from "../shared/elapsed";
import {
  PASTE_MENU_POLL_MS,
  PASTE_MENU_PROBE_MS,
  PASTE_MENU_WAIT_MS,
  countPasteLines,
  detectPasteMenu,
  isLargePaste,
  isPasteModeSetting,
  isPasteMarkerPaint,
  isPasteMarkerStyle,
  pasteMenuDownCount,
  renderPasteMarkersForHistory,
  splitPasteSegments,
  triggersPasteMenu,
  type PasteMode,
  type PasteModeSetting,
  type PasteMarkerPaint,
  type PasteMarkerStyle,
} from "../shared/paste-attach";
import {
  DEFAULT_THEME_NAME,
  FONT_FAMILY,
  FONT_SIZE,
  getThemeByName,
  type ThemePreset,
} from "./theme";
import { TodoPanel, type TodoPanelMode } from "./todo-panel";
import { ActivityTab, type SentMessageEntry } from "./activity-tab";
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
import { AskModal } from "./ask-modal";
import { PlanReviewModal, type PlanReviewAction } from "./plan-review-modal";
import { JobActivityModal } from "./job-activity-modal";
import { RecentFoldersModal } from "./recent-folders-modal";
import { RecentChatsModal } from "./recent-chats-modal";
import { ChatView } from "./chat-view";
import { TopMenu } from "./top-menu";
import { TabStrip, type TabStripEntry } from "./tab-strip";
import {
  DEFAULT_TAB_LAYOUT_MODE,
  isTabLayoutMode,
  type TabLayoutMode,
} from "../shared/tab-layout";
import {
  DEFAULT_SETTINGS_SECTION_COLLAPSED,
  DEFAULT_USAGE_TRACKER_SETTINGS,
  normalizeSettingsSectionCollapsed,
  normalizeUsageTrackerSettings,
  type SettingsSectionId,
  type UsageTrackerSettings,
} from "../shared/usage-tracker";
import { UsageTracker } from "./usage-tracker";
const api = window.pishift;

const tabsEl = document.getElementById("tabs") as HTMLDivElement;
const tabStripEl = document.getElementById("tab-strip") as HTMLDivElement;
const tabNudgeLeft = document.getElementById("tab-nudge-left") as HTMLButtonElement;
const tabNudgeRight = document.getElementById("tab-nudge-right") as HTMLButtonElement;
const tabOverflowChip = document.getElementById("tab-overflow-chip") as HTMLButtonElement;
const viewsEl = document.getElementById("views") as HTMLDivElement;
const panePrimaryEl = document.getElementById("pane-primary") as HTMLDivElement;
const paneSecondaryEl = document.getElementById("pane-secondary") as HTMLDivElement;
const splitDividerEl = document.getElementById("split-divider") as HTMLDivElement;
const splitBtn = document.getElementById("btn-split") as HTMLButtonElement | null;
const newTabButton = document.getElementById("new-tab") as HTMLButtonElement;
const settingsBtn = document.getElementById("btn-settings") as HTMLButtonElement;
const settingsImg = settingsBtn.querySelector<HTMLImageElement>("img.btn-icon");
if (settingsImg) settingsImg.src = settingsIcon;
const todoBtn = document.getElementById("btn-todo") as HTMLButtonElement;
const recentFoldersBtn = document.getElementById("btn-recent-folders") as HTMLButtonElement;
const usageTrackerAnchor = document.getElementById("usage-tracker-anchor") as HTMLDivElement;
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
  /** Matches control-bridge `sessionId` / PISHIFT_SESSION_ID. */
  sessionKey: string | null;
  /** omp's own session id; names the on-disk transcript the chat view renders. */
  ompSessionId: string | null;
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
  stallBanner: HTMLDivElement | null;
  /** When the current non-idle activity began; null while idle. */
  activitySince: number | null;
  button: HTMLButtonElement;
  appIcon: HTMLImageElement;
  colorDot: HTMLSpanElement;
  label: HTMLSpanElement;
  notice: HTMLDivElement | null;
  dock: DockState | undefined;
  pendingAsk: PendingAsk | null;
  /** omp is blocked on an unanswered question. */
  awaitingAsk: boolean;
  /** In-flight delivery of ask answers to omp's AskDialogComponent. */
  askSend: { seq: number } | null;
  askSendSeq: number;
  dismissedAskToolCallId: string | null;
  /** Auto-incrementing fallback label ("Session N") when no folder/auto-title applies. */
  sessionNumber: number;
  /** Read-only mirror of OMP's `/todo` tool state for this session. */
  todo: TodoPhase[] | null;
  /** Read-only mirror of OMP's async job registry for this session. */
  jobs: AsyncJob[];
  /** Active Plan Review menu state in this session. */
  planReview: { contextStats?: string } | null;
  /** omp is blocked on the plan-review menu. */
  awaitingPlanReview: boolean;
  /** omp is compacting context after "Approve and Compact Context"; suppress reopen/close flicker until done. */
  planReviewCompacting: boolean;
  /** Set when the user cancelled or the session died — that idle is not "done". */
  suppressDoneSound: boolean;
  /** Messages sent from the dock this session, for the activity tab's jump-to-message list. */
  sentMessages: SentMessageEntry[];
  /** omp session key whose transcript already backfilled `sentMessages`; guards repeat loads. */
  activityBackfilledKey: string | null;
  /** omp's large-paste selector is on screen, awaiting the mode we already chose. */
  pasteMenuSeen: boolean;
  /** Which renderer this tab shows. The PTY runs in both modes. */
  viewMode: ViewMode;
  /** Built lazily on first switch into chat mode, then kept for instant toggling. */
  chat: ChatView | null;
  /** Whether main is tailing this tab's transcript. */
  transcriptSubscribed: boolean;
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
const ELAPSED_MIN_MS = 5000;
let hideTopButtonLabels = false;
let hideBottomButtonLabels = false;
let collapseTopBarToMenu = false;
let panelPosition: PanelPosition = "top-right";
/** View mode new tabs open in; per-tab mode diverges freely from it. */
let defaultViewMode: ViewMode = "terminal";
/** Whether chat tool groups open automatically. */
let autoExpandTools = false;
/** Whether completed transcript reasoning rows open automatically. */
let autoExpandReasoning = true;
let terminalScrollSteps = DEFAULT_SCROLL_STEPS;
let pasteMode: PasteModeSetting = "ask";
let pasteMarkerStyle: PasteMarkerStyle = "content";
let pasteMarkerPaint: PasteMarkerPaint = "pill";
let pasteMarkerPulse = true;
let doneSoundEnabled = true;
let doneSoundVolume = DEFAULT_DONE_SOUND_VOLUME;
let tabLayoutMode: TabLayoutMode = DEFAULT_TAB_LAYOUT_MODE;
let usageTrackerSettings: UsageTrackerSettings = {
  ...DEFAULT_USAGE_TRACKER_SETTINGS,
  quotas: [],
  providerIconUrls: {},
  iconPlacement: "inside",
  showPercent: false,
};
let settingsSectionCollapsed: Partial<Record<SettingsSectionId, boolean>> = {
  ...DEFAULT_SETTINGS_SECTION_COLLAPSED,
};
let splitMode = false;
let activePane: "primary" | "secondary" = "primary";
let primaryTab: Tab | null = null;
let secondaryTab: Tab | null = null;
let splitRatio = 0.5;
const doneSound = new CompletionSound(doneSoundEnabled, doneSoundVolume);

function applyScrollSteps(steps: number): void {
  terminalScrollSteps = clampScrollSteps(steps);
  for (const tab of tabs) tab.view?.setScrollSteps(terminalScrollSteps);
}
/** Header control width feeds the tab strip's overflow budget, so re-plan. */
function applyButtonLabelVisibility(): void {
  document.body.classList.toggle("hide-top-button-labels", hideTopButtonLabels);
  document.body.classList.toggle("hide-bottom-button-labels", hideBottomButtonLabels);
  document.body.classList.toggle("top-bar-as-menu", collapseTopBarToMenu);
  tabStrip.invalidate();
  renderTabs();
}
function applyPasteMarkerPaint(): void {
  document.body.dataset.pastePaint = pasteMarkerPaint;
}

/** Tab overflow behaviour (scrolling strip / stacked rows / `+N` menu). */
const tabStrip = new TabStrip({
  strip: tabStripEl,
  scroller: tabsEl,
  nudgeLeft: tabNudgeLeft,
  nudgeRight: tabNudgeRight,
  chip: tabOverflowChip,
  entries: (): TabStripEntry[] =>
    tabs.map((tab) => ({
      key: tab.sessionNumber,
      label: tabDisplayName(tab),
      cwd: tab.cwd,
      element: tab.button,
      active: tab === active,
      busy: tab.busy,
      awaiting: tab.awaitingAsk || tab.awaitingPlanReview,
      glow:
        activityColorsOnTabs && tab.activity !== "idle" ? activityColors[tab.activity] : null,
    })),
  onActivate: (key) => {
    const tab = tabs.find((t) => t.sessionNumber === key);
    if (tab) activate(tab);
  },
  onClose: (key) => {
    const tab = tabs.find((t) => t.sessionNumber === key);
    if (tab) void requestCloseTab(tab);
  },
});

function applyTabLayoutMode(mode: TabLayoutMode): void {
  tabLayoutMode = mode;
  tabStrip.setMode(mode);
  usageTracker?.render();
  queueUsageTrackerLayout(true);
}
let settingsModal: SettingsModal | null = null;
let modelModal: ModelModal | null = null;
let usageModal: UsageModal | null = null;
let askModal: AskModal | null = null;
let planReviewModal: PlanReviewModal | null = null;
let jobActivityModal: JobActivityModal | null = null;
let dockToolsMenu: DockToolsMenu | null = null;
let recentFoldersModal: RecentFoldersModal | null = null;
let recentChatsModal: RecentChatsModal | null = null;
let topMenu: TopMenu | null = null;
const confirmDialog = new ConfirmDialog();
document.body.appendChild(confirmDialog.root);
const tabContextMenu = new TabContextMenu();
async function killJob(job: AsyncJob): Promise<void> {
  if (!active) return;

  void api.killJob({ jobId: job.id, sessionId: active.sessionKey ?? active.sessionId });
  job.status = "cancelled";
  const existing = active.jobs.find((j) => j.id === job.id);
  if (existing) existing.status = "cancelled";
  todoPanel.setJobs(active.jobs);

  active.suppressDoneSound = true;
  sendToPty(active, "\x1b");
  await sleep(40);
  if (active?.view) {
    active.view.runSlash(`/cancel ${job.id}`);
  }
}

let usageTracker: UsageTracker | null = null;

const todoPanel = new TodoPanel(
  (visible) => {
    todoPanelVisible = visible;
    persist();
  },
  (mode) => {
    todoPanelMode = mode;
    persist();
  },
  () => usageTracker!.refresh(),
  (job) => {
    if (!jobActivityModal) {
      jobActivityModal = new JobActivityModal();
      document.body.appendChild(jobActivityModal.el);
    }
    void jobActivityModal.open(job, active?.cwd, (target) => {
      killJob(target);
    });
  },
  (job) => {
    killJob(job);
  },
);
function updateProviderReports(reports: ProviderUsageReport[]): void {
  usageModal?.updateReports(reports);
  todoPanel.setUsageReports(reports);
  settingsModal?.setUsageReports(reports);
  const top = reports.find((report) => report.limits.length > 0);
  if (!top || !top.limits[0]) {
    headerUsageText.textContent = reports.length ? `${reports.length} Providers Active` : "Usage · $0.00";
    return;
  }
  headerUsageText.textContent = `${top.providerName} · ${top.limits[0].label} ${top.limits[0].usedPercent}%`;
}

let usageTrackerLayoutFrame: number | null = null;
let usageTrackerLayoutNeedsReplan = false;

function queueUsageTrackerLayout(replan: boolean): void {
  usageTrackerLayoutNeedsReplan ||= replan;
  if (usageTrackerLayoutFrame !== null) return;
  usageTrackerLayoutFrame = window.requestAnimationFrame(() => {
    usageTrackerLayoutFrame = null;
    const needsReplan = usageTrackerLayoutNeedsReplan;
    usageTrackerLayoutNeedsReplan = false;
    placeUsageTracker();
    if (!needsReplan) return;
    tabStrip.invalidate();
    tabStrip.sync();
    placeUsageTracker();
  });
}

usageTracker = new UsageTracker({
  getProviderUsage: () => api.getProviderUsage(),
  settings: usageTrackerSettings,
  onReports: updateProviderReports,
  onRender: () => {
    placeUsageTracker();
  },
});
usageTrackerAnchor.appendChild(usageTracker.el);

const activityTab = new ActivityTab();

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

function applyThinkingLevelsForModel(
  modelSpec: string,
  currentLevel?: string,
  targetTab: Tab | null = active,
): void {
  const installed = findInstalledModel(modelSpec, installedModels);
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


async function sendAskAnswers(tab: Tab, answers: AskAnswer[]): Promise<void> {
  if (!tab.view) return;
  const seq = ++tab.askSendSeq;
  tab.askSend = { seq };
  const steps = buildAskDialogSteps(answers);
  const ARROW_KEY_BY_DIR: Record<"up" | "down" | "left" | "right", string> = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  };
  const arrow = (dir: "up" | "down" | "left" | "right") => {
    const key = ARROW_KEY_BY_DIR[dir];
    tab.view?.writeArrow({
      key,
      code: key,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
  };
  for (const step of steps) {
    if (tab.askSendSeq !== seq || !tab.view) return;
    switch (step.type) {
      case "arrow":
        arrow(step.dir);
        await sleep(ASK_KEY_GAP_MS);
        break;
      case "space":
        tab.view.writeRaw(" ");
        await sleep(ASK_KEY_GAP_MS);
        break;
      case "enter":
        tab.view.writeRaw("\r");
        await sleep(ASK_ENTER_GAP_MS);
        await tab.view.waitForQuiet(40, 250);
        break;
      case "wait":
        await sleep(step.ms);
        await tab.view.waitForQuiet(40, 250);
        break;
      case "text":
        tab.view.writeRaw(step.value);
        await sleep(ASK_KEY_GAP_MS);
        break;
    }
  }
  if (tab.askSendSeq === seq) tab.askSend = null;
}

/**
 * Answer omp's large-paste selector with the mode the user already picked in
 * the dock.
 *
 * omp's threshold is user-configurable, so the menu's appearance is never
 * assumed: without a sighting in the stream nothing is sent, and the following
 * `view.submit()` remains an ordinary Enter.
 */
async function answerPasteMenu(tab: Tab, mode: PasteMode, expected: boolean): Promise<void> {
  if (!tab.view) return;
  const budget = expected ? PASTE_MENU_WAIT_MS : PASTE_MENU_PROBE_MS;
  const deadline = Date.now() + budget;
  while (!tab.pasteMenuSeen && Date.now() < deadline) {
    await sleep(PASTE_MENU_POLL_MS);
  }
  if (!tab.pasteMenuSeen || !tab.view) {
    tab.pasteMenuSeen = false;
    return;
  }
  tab.pasteMenuSeen = false;

  for (let i = 0; i < pasteMenuDownCount(mode); i++) {
    tab.view.writeArrow({
      key: "ArrowDown",
      code: "ArrowDown",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
    await sleep(ASK_KEY_GAP_MS);
  }
  tab.view.writeRaw("\r");
  await sleep(ASK_ENTER_GAP_MS);
  await tab.view.waitForQuiet(40, 250);
}

function clearAskSend(tab: Tab): void {
  tab.askSendSeq++;
  tab.askSend = null;
}

function raiseAskAttention(tab: Tab, ask: PendingAsk): void {
  tab.awaitingAsk = true;
  renderTabs();
  doneSound.play();
  // A question the user is already staring at does not need an OS toast.
  if (document.hasFocus() && tab === active) return;
  const first = ask.questions[0]?.question ?? "omp needs an answer";
  const body = first.length > 120 ? `${first.slice(0, 119)}…` : first;
  api.notify(tab.customTitle || tab.title || basename(tab.cwd), body);
}

function clearAskAttention(tab: Tab): void {
  if (!tab.awaitingAsk) return;
  tab.awaitingAsk = false;
  renderTabs();
}

function raisePlanReviewAttention(tab: Tab): void {
  tab.awaitingPlanReview = true;
  renderTabs();
  doneSound.play();
  if (document.hasFocus() && tab === active) return;
  api.notify(
    tab.customTitle || tab.title || basename(tab.cwd),
    "Plan ready — choose next step",
  );
}

function clearPlanReviewAttention(tab: Tab): void {
  if (!tab.awaitingPlanReview) return;
  tab.awaitingPlanReview = false;
  renderTabs();
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
  // Re-opening on every heartbeat would wipe half-entered answers; the sheet is
  // rebuilt only when omp actually asks something new.
  if (askModal.isOpen && askModal.toolCallId === pending.toolCallId) return;
  askModal.open(
    pending,
    (answers) => {
      void sendAskAnswers(tab, answers);
      tab.pendingAsk = null;
      clearAskAttention(tab);
    },
    () => {
      tab.dismissedAskToolCallId = pending.toolCallId;
      clearAskAttention(tab);
    },
  );
}
async function sendPlanReviewAction(tab: Tab, action: PlanReviewAction): Promise<void> {
  if (!tab.view) return;
  tab.planReview = null;
  if (action === "compact") tab.planReviewCompacting = true;
  clearPlanReviewAttention(tab);

  if (action === "quit") {
    tab.view.writeRaw("\x1b");
    return;
  }

  const targetIndex =
    action === "execute"
      ? 0
      : action === "compact"
        ? 1
        : action === "keep"
          ? 2
          : action === "refine"
            ? 3
            : action === "save"
              ? 4
              : 0;

  if (targetIndex === 0) {
    tab.view.writeRaw("\r");
    return;
  }

  const arrowDown = {
    key: "ArrowDown",
    code: "ArrowDown",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  };

  for (let i = 0; i < targetIndex; i++) {
    tab.view.writeArrow(arrowDown);
    await sleep(35);
  }
  await sleep(25);
  tab.view.writeRaw("\r");
}

function syncPlanReviewModal(tab: Tab): void {
  if (tab.planReviewCompacting) {
    if (!planReviewModal) {
      planReviewModal = new PlanReviewModal();
      const dockEl = document.getElementById("dock");
      if (dockEl) dockEl.insertBefore(planReviewModal.el, dockEl.firstChild);
      else document.body.appendChild(planReviewModal.el);
    }
    planReviewModal.showCompacting();
    return;
  }
  if (!tab.planReview) {
    planReviewModal?.close();
    return;
  }
  if (!planReviewModal) {
    planReviewModal = new PlanReviewModal();
    const dockEl = document.getElementById("dock");
    if (dockEl) dockEl.insertBefore(planReviewModal.el, dockEl.firstChild);
    else document.body.appendChild(planReviewModal.el);
  }
  if (planReviewModal.isOpen) {
    if (tab.planReview.contextStats) {
      planReviewModal.updateStats(tab.planReview.contextStats);
    }
    return;
  }
  planReviewModal.open(
    { contextStats: tab.planReview.contextStats },
    (action) => {
      sendPlanReviewAction(tab, action);
    },
  );
}
function updateHeaderUsageVisibility(): void {
  if (headerUsage) {
    headerUsage.style.display = showUsageInHeader ? "inline-flex" : "none";
  }
  tabStrip.invalidate();
  renderTabs();
}

async function refreshHeaderUsage(): Promise<void> {
  if (!usageTracker) return;
  try {
    await usageTracker.refresh();
  } catch {
    // Retain the last provider summary while the tracker backs off.
  }
}


const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() || p;

/** Titles that are noise / not useful as a tab label. */
const GENERIC_TITLES = new Set(
  ["", "omp", "oh my pi", "oh-my-pi", "terminal", "bash", "pwsh", "powershell", "cmd", "temp", "tmp"].map(
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
    pasteMode,
    pasteMarkerStyle,
    pasteMarkerPaint,
    pasteMarkerPulse,
    activityColors,
    activityColorsOnTabs,
    todoPanelVisible,
    panelPosition,
    defaultViewMode,
    autoExpandTools,
    autoExpandReasoning,
    collapseTopBarToMenu,
    todoPanelMode,
    hideTopButtonLabels,
    hideBottomButtonLabels,
    doneSoundEnabled,
    doneSoundVolume,
    tabLayoutMode,
    usageTracker: usageTrackerSettings,
    settingsSectionCollapsed,
    splitRatio: splitRatio !== 0.5 ? splitRatio : undefined,
  });
}

function sendToPty(tab: Tab, data: string): void {
  if (tab.sessionId) api.write(tab.sessionId, data);
  else tab.pending.push(data);
}

function renderTabs(): void {
  for (const tab of tabs) {
    const name = tabDisplayName(tab);
    const isSecSplit = splitMode && tab === secondaryTab && active !== secondaryTab;
    tab.button.classList.toggle("active", tab === active || isSecSplit);
    tab.button.classList.toggle("tab-split-secondary", isSecSplit);
    tab.button.classList.toggle("busy", tab.busy);
    tab.button.classList.toggle("awaiting-ask", tab.awaitingAsk || tab.awaitingPlanReview);
    if (activityColorsOnTabs && tab.activity !== "idle") {
      tab.button.style.setProperty("--tab-glow", activityColors[tab.activity]);
    } else {
      tab.button.style.removeProperty("--tab-glow");
    }
    tab.label.textContent = name;

    const isPiShift = name === "PiShift";
    tab.appIcon.style.display = isPiShift ? "inline-block" : "none";
    tab.button.classList.toggle("has-app-icon", isPiShift);

    const colorPreset = tab.colorTag
      ? TAB_COLOR_PRESETS.find((preset) => preset.id === tab.colorTag)
      : undefined;
    if (colorPreset) {
      tab.colorDot.style.backgroundColor = colorPreset.color;
      tab.colorDot.style.display = "inline-block";
    } else {
      tab.colorDot.style.display = "none";
    }

    const source = tab.customTitle ? "manual" : cleanAutoTitle(tab.title) ? "auto" : "folder";
    tab.button.title = `${name} (${tab.cwd}) — ${source} · right-click for options · double-click to rename`;
  }
  tabStrip.sync();
  queueUsageTrackerLayout(true);
}

function placeUsageTracker(): void {
  if (!usageTracker || usageTracker.el.parentElement === usageTrackerAnchor) return;
  usageTrackerAnchor.appendChild(usageTracker.el);
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
  const elapsedMs = tab.activitySince === null ? 0 : Date.now() - tab.activitySince;
  const elapsed = elapsedMs >= ELAPSED_MIN_MS ? ` · ${formatElapsed(elapsedMs)}` : "";

  headerActivity.hidden = false;
  headerActivity.dataset.activity = kind;
  headerActivity.title = `Agent activity: ${label}`;
  headerActivityText.textContent = `${label}${elapsed}`;
  headerActivityDot.style.background = color;
  headerActivity.style.setProperty("--header-activity-color", color);
}

let elapsedTicker: number | null = null;

/** Repaint the header once a second while a turn is running, so the elapsed
 * label advances without waiting for the next bridge update. */
function syncElapsedTicker(): void {
  const needed = active !== null && active.activitySince !== null;
  if (needed && elapsedTicker === null) {
    elapsedTicker = window.setInterval(() => updateHeaderActivity(), 1000);
  } else if (!needed && elapsedTicker !== null) {
    window.clearInterval(elapsedTicker);
    elapsedTicker = null;
  }
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
  if (activity === "idle") tab.activitySince = null;
  else if (tab.activity !== activity || tab.activitySince === null) {
    tab.activitySince = Date.now();
  }
  tab.activity = activity;
  // Authoritative idle from the bridge also clears a stuck OSC progress flag.
  if (activity === "idle") {
    if (tab.progressBusyTimer !== null) {
      window.clearTimeout(tab.progressBusyTimer);
      tab.progressBusyTimer = null;
    }
    tab.progressBusy = false;
  }
  tab.chat?.setActivity(activity, tab.activitySince);
  syncTabBusy(tab);
  syncElapsedTicker();
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

/** Build the tab's chat renderer on first use; the terminal keeps running below it. */
function ensureChatView(tab: Tab): ChatView {
  if (tab.chat) return tab.chat;

  const chat = new ChatView({
    copyText: (text) => api.copyText(text),
    openExternal: (url) => {
      void api.openExternal(url);
    },
    resolveBlob: (ref, mimeType) => api.transcriptBlob(ref, mimeType),
    openImage: (src) => dock.showImage(src),
    onRevertToTerminal: () => setViewMode(tab, "terminal"),
  });
  chat.setAutoExpandTools(autoExpandTools);
  chat.setAutoExpandReasoning(autoExpandReasoning);
  tab.chat = chat;
  const targetPane = splitMode && tab === secondaryTab ? paneSecondaryEl : panePrimaryEl;
  chat.mount(targetPane);
  return chat;
}

/** Start (or repoint) main's transcript tail for a tab and paint the first snapshot. */
function subscribeTranscript(tab: Tab): void {
  if (!tab.sessionId) return;
  const sessionId = tab.sessionId;
  tab.transcriptSubscribed = true;
  void api.subscribeTranscript(sessionId, tab.ompSessionId, tab.cwd).then((snapshot) => {
    // The tab may have been closed or restarted while the round trip was in flight.
    if (!snapshot || !tab.chat || tab.sessionId !== sessionId) return;
    tab.chat.apply(snapshot);
  });
}

/**
 * Swap which renderer a tab shows. Presentation only: the PTY, the composer and
 * every overlay keep working in both modes, so this is always reversible.
 */
function setViewMode(tab: Tab, mode: ViewMode): void {
  if (tab.viewMode === mode) return;
  tab.viewMode = mode;

  if (mode === "chat") {
    const chat = ensureChatView(tab);
    chat.setEmptyReason("loading");
    if (!tab.transcriptSubscribed) subscribeTranscript(tab);
  }

  if (tab === active) syncViewMode(tab);
  dock.focus();
}

/** Paint the active tab's mode onto the DOM; inactive tabs keep their chat mounted but hidden. */
function syncViewMode(tab: Tab): void {
  const chat = tab.viewMode === "chat";
  document.body.dataset.viewMode = tab.viewMode;
  tab.chat?.setActive(chat);
  dock.setViewMode(tab.viewMode);
}

function mountTabInPane(tab: Tab, pane: "primary" | "secondary"): void {
  const target = pane === "primary" ? panePrimaryEl : paneSecondaryEl;
  if (tab.view && tab.view.el.parentElement !== target) {
    target.appendChild(tab.view.el);
  }
  if (tab.chat && tab.chat.el.parentElement !== target) {
    target.appendChild(tab.chat.el);
  }
  if (tab.notice && tab.notice.parentElement !== target) {
    target.appendChild(tab.notice);
  }
  if (tab.stallBanner && tab.stallBanner.parentElement !== target) {
    target.appendChild(tab.stallBanner);
  }
}

function updatePaneFocusStyles(): void {
  panePrimaryEl.classList.toggle("active", activePane === "primary");
  paneSecondaryEl.classList.toggle("active", activePane === "secondary");
}

function focusPane(pane: "primary" | "secondary"): void {
  if (!splitMode) return;
  activePane = pane;
  updatePaneFocusStyles();
  const targetTab = pane === "primary" ? primaryTab : secondaryTab;
  if (!targetTab) return;

  if (active !== targetTab) {
    if (active) {
      active.dock = dock.snapshot();
    }
    active = targetTab;
    dock.load(targetTab.dock);
    dock.setCwd(targetTab.cwd);
    applyModelToDock(targetTab.modelName, targetTab.thinkingLevel, targetTab);
    dock.setThinkingLevel(targetTab.thinkingLevel || "low");
    dock.setPlanMode(targetTab.plan.mode, targetTab.plan.pending);
    dock.setAgentBusy(targetTab.busy, targetTab.busy ? targetTab.activity : "idle");
    updateHeaderActivity(targetTab);
    syncAskModal(targetTab);
    syncPlanReviewModal(targetTab);
    syncActivityTab(targetTab);
    todoPanel.setPhases(targetTab.todo);
    todoPanel.setJobs(targetTab.jobs);
    modelModal?.setCurrentModel(targetTab.modelName || "");
    if (recentFoldersModal?.isOpen) {
      recentFoldersModal.setCurrentCwd(targetTab.cwd);
    }
    if (recentChatsModal?.isOpen) {
      recentChatsModal.setCurrentCwd(targetTab.cwd);
      recentChatsModal.setActiveSessionId(targetTab.sessionKey ?? targetTab.sessionId);
    }
    document.title = `${tabDisplayName(targetTab)} · PiShift`;
    renderTabs();
    updateUsageDisplay(targetTab);
    persist();
    syncElapsedTicker();
  }
}

async function toggleSplitScreen(targetTab?: Tab): Promise<void> {
  if (splitMode) {
    splitMode = false;
    viewsEl.classList.remove("split-active");
    splitDividerEl.hidden = true;
    paneSecondaryEl.hidden = true;
    panePrimaryEl.classList.remove("active");
    paneSecondaryEl.classList.remove("active");
    splitBtn?.classList.remove("active");

    if (secondaryTab) {
      if (secondaryTab !== active) {
        secondaryTab.view?.deactivate();
        secondaryTab.notice?.classList.remove("active");
        secondaryTab.stallBanner?.classList.remove("active");
        secondaryTab.chat?.setActive(false);
      }
      mountTabInPane(secondaryTab, "primary");
    }

    if (primaryTab) {
      mountTabInPane(primaryTab, "primary");
    }

    secondaryTab = null;
    primaryTab = active;
    activePane = "primary";
    active?.view?.activate(panePrimaryEl);
    active?.view?.refit();
    renderTabs();
    persist();
    return;
  }

  if (tabs.length <= 1) {
    await addTab();
  }

  splitMode = true;
  viewsEl.classList.add("split-active");
  splitDividerEl.hidden = false;
  paneSecondaryEl.hidden = false;
  splitBtn?.classList.add("active");

  primaryTab = active ?? tabs[0] ?? null;
  secondaryTab = targetTab && targetTab !== primaryTab ? targetTab : (tabs.find((t) => t !== primaryTab) ?? null);
  activePane = "primary";

  if (primaryTab) {
    mountTabInPane(primaryTab, "primary");
    primaryTab.view?.activate(panePrimaryEl);
    primaryTab.notice?.classList.add("active");
    primaryTab.stallBanner?.classList.add("active");
  }

  if (secondaryTab) {
    mountTabInPane(secondaryTab, "secondary");
    secondaryTab.view?.activate(paneSecondaryEl);
    secondaryTab.notice?.classList.add("active");
    secondaryTab.stallBanner?.classList.add("active");
  }

  updatePaneFocusStyles();
  primaryTab?.view?.refit();
  secondaryTab?.view?.refit();
  renderTabs();
  persist();
}

function activate(tab: Tab): void {
  if (splitMode) {
    if (tab === primaryTab) {
      focusPane("primary");
      dock.focus();
      return;
    }
    if (tab === secondaryTab) {
      focusPane("secondary");
      dock.focus();
      return;
    }

    if (activePane === "primary") {
      if (primaryTab) {
        primaryTab.dock = dock.snapshot();
        primaryTab.view?.deactivate();
        primaryTab.notice?.classList.remove("active");
        primaryTab.stallBanner?.classList.remove("active");
        primaryTab.chat?.setActive(false);
      }
      primaryTab = tab;
      mountTabInPane(tab, "primary");
      tab.view?.activate(panePrimaryEl);
      tab.notice?.classList.add("active");
      tab.stallBanner?.classList.add("active");
    } else {
      if (secondaryTab) {
        secondaryTab.dock = dock.snapshot();
        secondaryTab.view?.deactivate();
        secondaryTab.notice?.classList.remove("active");
        secondaryTab.stallBanner?.classList.remove("active");
        secondaryTab.chat?.setActive(false);
      }
      secondaryTab = tab;
      mountTabInPane(tab, "secondary");
      tab.view?.activate(paneSecondaryEl);
      tab.notice?.classList.add("active");
      tab.stallBanner?.classList.add("active");
    }

    active = tab;
    syncViewMode(tab);
    dock.load(tab.dock);
    dock.setCwd(tab.cwd);
    applyModelToDock(tab.modelName, tab.thinkingLevel, tab);
    dock.setThinkingLevel(tab.thinkingLevel || "low");
    dock.setPlanMode(tab.plan.mode, tab.plan.pending);
    dock.setAgentBusy(tab.busy, tab.busy ? tab.activity : "idle");
    updateHeaderActivity(tab);
    syncAskModal(tab);
    syncPlanReviewModal(tab);
    syncActivityTab(tab);
    todoPanel.setPhases(tab.todo);
    todoPanel.setJobs(tab.jobs);
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
    tab.view?.refit();
    persist();
    syncElapsedTicker();
    return;
  }

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
    active.stallBanner?.classList.remove("active");
    active.chat?.setActive(false);
  }
  active = tab;
  tab.view?.activate(panePrimaryEl);
  tab.notice?.classList.add("active");
  tab.stallBanner?.classList.add("active");
  syncViewMode(tab);
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
  syncPlanReviewModal(tab);
  syncActivityTab(tab);
  todoPanel.setPhases(tab.todo);
  todoPanel.setJobs(tab.jobs);
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
  syncElapsedTicker();
}

function closeTab(tab: Tab): void {
  const index = tabs.indexOf(tab);
  if (index < 0) return;
  tabs.splice(index, 1);
  if (tab.sessionId) {
    api.kill(tab.sessionId);
    api.unsubscribeTranscript(tab.sessionId);
    bySession.delete(tab.sessionId);
  }
  tab.transcriptSubscribed = false;
  tab.chat?.dispose();
  tab.chat = null;
  tab.view?.dispose();
  tab.notice?.remove();
  clearStallBanner(tab);
  tab.button.remove();

  if (splitMode) {
    if (tabs.length < 2) {
      splitMode = false;
      viewsEl.classList.remove("split-active");
      splitDividerEl.hidden = true;
      paneSecondaryEl.hidden = true;
      splitBtn?.classList.remove("active");
      panePrimaryEl.classList.remove("active");
      paneSecondaryEl.classList.remove("active");
      const remaining = tabs[0];
      if (remaining) {
        mountTabInPane(remaining, "primary");
        primaryTab = remaining;
        secondaryTab = null;
        activePane = "primary";
        activate(remaining);
      } else {
        void addTab();
      }
      return;
    }

    if (tab === primaryTab) {
      const next = tabs.find((t) => t !== secondaryTab) ?? tabs[0]!;
      primaryTab = next;
      mountTabInPane(next, "primary");
      next.view?.activate(panePrimaryEl);
      if (active === tab) {
        active = next;
        activate(next);
      } else {
        renderTabs();
      }
    } else if (tab === secondaryTab) {
      const next = tabs.find((t) => t !== primaryTab) ?? tabs[0]!;
      secondaryTab = next;
      mountTabInPane(next, "secondary");
      next.view?.activate(paneSecondaryEl);
      if (active === tab) {
        active = next;
        activate(next);
      } else {
        renderTabs();
      }
    } else {
      renderTabs();
    }
    return;
  }

  if (active === tab) {
    active = null;
    askModal?.close();
    activityTab.setEntries([], () => false);
    planReviewModal?.close();
    clearPlanReviewAttention(tab);
    const next = tabs[Math.min(index, tabs.length - 1)];
    if (next) activate(next);
  }
  if (tabs.length === 0) {
    void addTab();
    return;
  }
  // Closing an inactive tab skips activate(); the strip still needs re-laying out.
  renderTabs();
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
    api.unsubscribeTranscript(tab.sessionId);
    bySession.delete(tab.sessionId);
    tab.sessionId = null;
    tab.sessionKey = null;
    tab.ompSessionId = null;
    tab.ompPid = null;
  }
  tab.transcriptSubscribed = false;
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
  const targetPane = splitMode && tab === secondaryTab ? paneSecondaryEl : panePrimaryEl;
  targetPane.appendChild(notice);
  tab.notice = notice;
}

/** How long the stall report stays up once flow has been restored. */
const STALL_BANNER_TTL_MS = 6000;
const stallBannerTimers = new WeakMap<HTMLDivElement, number>();

/** Overlay shown when the PTY sat paused past the watchdog. Main resumes the
 * child itself, so this reports and offers a hard escape; it never replaces the
 * terminal view. */
function showStallBanner(tab: Tab): void {
  if (tab.stallBanner) return;
  const banner = document.createElement("div");
  banner.className = tab === active ? "stall-banner active" : "stall-banner";

  const text = document.createElement("span");
  text.textContent = "Output stalled — flow resumed automatically.";

  const resumeBtn = document.createElement("button");
  resumeBtn.type = "button";
  resumeBtn.textContent = "Resume output";
  resumeBtn.addEventListener("click", () => {
    if (tab.sessionId) api.resumeFlow(tab.sessionId);
    clearStallBanner(tab);
  });

  const killBtn = document.createElement("button");
  killBtn.type = "button";
  killBtn.className = "stall-banner-kill";
  killBtn.textContent = "Kill session";
  killBtn.addEventListener("click", () => {
    clearStallBanner(tab);
    if (tab.sessionId) api.kill(tab.sessionId);
  });

  banner.append(text, resumeBtn, killBtn);
  const targetPane = splitMode && tab === secondaryTab ? paneSecondaryEl : panePrimaryEl;
  targetPane.appendChild(banner);
  tab.stallBanner = banner;
  // Flow is already restored by the time this shows; a permanent banner would
  // outlive the condition it reports (the stall-cleared event only arrives if
  // the renderer's own ack eventually lands).
  stallBannerTimers.set(banner, window.setTimeout(() => clearStallBanner(tab), STALL_BANNER_TTL_MS));
}

function clearStallBanner(tab: Tab): void {
  const banner = tab.stallBanner;
  if (!banner) return;
  const timer = stallBannerTimers.get(banner);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    stallBannerTimers.delete(banner);
  }
  banner.remove();
  tab.stallBanner = null;
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
      onCopyFromTerminal: () => {
        if (tab !== active) return;
        dock.showToast("Just copied", 1300);
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
    const targetPane = splitMode && activePane === "secondary" ? paneSecondaryEl : panePrimaryEl;
    view.activate(targetPane);
    // New tabs activate before their view exists, so animate here instead.
    playViewSwitch(tab, "right");
  } else {
    panePrimaryEl.appendChild(view.el);
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
  bySession.set(result.id, tab);
  api.resize(result.id, view.cols, view.rows);
  for (const chunk of tab.pending.splice(0)) api.write(result.id, chunk);
  // A tab that starts (or restarts) already in chat mode needs its feed opened;
  // `setViewMode` could not do it before a PTY id existed.
  if (tab.viewMode === "chat") {
    ensureChatView(tab).setEmptyReason("loading");
    subscribeTranscript(tab);
    if (tab === active) syncViewMode(tab);
  }
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
    ompSessionId: null,
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
    stallBanner: null,
    activitySince: null,
    dock: undefined,
    pendingAsk: null,
    awaitingAsk: false,
    askSend: null,
    askSendSeq: 0,
    dismissedAskToolCallId: null,
    sessionNumber: ++sessionCounter,
    todo: null,
    jobs: [],
    planReview: null,
    awaitingPlanReview: false,
    planReviewCompacting: false,
    suppressDoneSound: false,
    sentMessages: [],
    activityBackfilledKey: null,
    pasteMenuSeen: false,
    viewMode: defaultViewMode,
    chat: null,
    transcriptSubscribed: false,
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
      onSplit: (_t) => {
        if (!splitMode) {
          void toggleSplitScreen(tab);
        } else {
          activate(tab);
        }
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
    renderTabs();
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
 * Resolve a clicked activity row to a terminal position. A live marker is
 * exact; a transcript-backfilled row has none, so fall back to finding its
 * text in the scrollback. Returns false when neither locates anything.
 */
function jumpToSentMessage(tab: Tab, entry: SentMessageEntry): boolean {
  const view = tab.view;
  if (!view) return false;
  if (entry.marker && !entry.marker.isDisposed) {
    view.scrollToMarker(entry.marker);
    view.focus();
    return true;
  }
  if (!view.scrollToText(entry.text)) return false;
  view.focus();
  return true;
}

function syncActivityTab(tab: Tab): void {
  activityTab.setEntries(tab.sentMessages, (entry) => jumpToSentMessage(tab, entry));
}

function recordSentMessage(tab: Tab, text: string): void {
  if (!tab.view) return;
  const marker = tab.view.markCurrentLine();
  tab.sentMessages.push({ text, marker, at: Date.now() });
  if (tab === active) syncActivityTab(tab);
}

/** Starting a fresh chat context (new/resumed session) invalidates every
 * marker pointing into the just-replaced terminal buffer; drop the stale
 * entries instead of leaving them listed and disabled/grayed. */
function resetActivityHistory(tab: Tab): void {
  for (const entry of tab.sentMessages) entry.marker?.dispose();
  tab.sentMessages = [];
  if (tab === active) syncActivityTab(tab);
}

/**
 * Backfill the activity tab from a session's on-disk transcript, so opening or
 * resuming a chat lists what was already typed instead of starting empty.
 *
 * Transcript entries get no terminal marker (their text predates this window's
 * buffer), so they list but cannot be jumped to. Live entries recorded in this
 * window are preserved and kept last; a transcript row repeating a live entry's
 * text is dropped so the newest message is not listed twice.
 */
async function backfillSessionMessages(tab: Tab, sessionId: string): Promise<void> {
  tab.activityBackfilledKey = sessionId;
  const messages = await window.pishift.getSessionMessages(sessionId);
  const live = tab.sentMessages.filter((entry) => entry.marker !== null);
  const liveTexts = new Set(live.map((entry) => entry.text));
  const historical: SentMessageEntry[] = messages
    .filter((m) => !liveTexts.has(m.text))
    .map((m) => ({ text: m.text, marker: null, at: m.at }));
  tab.sentMessages = [...historical, ...live];
  if (tab === active) syncActivityTab(tab);
}

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
    const bySeq = new Map(payload.pastes.map((item) => [item.seq, item]));
    const segments = splitPasteSegments(body, new Set(bySeq.keys()));
    // No dock choice was possible for a long body that never became a chip
    // (a recalled history entry, say), so honour the pinned setting.
    const fallback: PasteMode = pasteMode === "ask" ? "inline" : pasteMode;
    let first = true;

    for (const segment of segments) {
      const lead = first && hasFiles ? " " : "";
      first = false;
      if (segment.kind === "paste") {
        const item = bySeq.get(segment.seq)!;
        if (lead) view.type(lead);
        // Only a sighting produced by this paste may answer for it.
        tab.pasteMenuSeen = false;
        const pasteContent =
          item.mode === "wrapped" && !triggersPasteMenu(item.lines)
            ? `<attachment>\n${item.text}\n</attachment>`
            : item.text;
        view.paste(pasteContent);
        await sleep(EDITOR_SETTLE_MS);
        await answerPasteMenu(tab, item.mode, triggersPasteMenu(item.lines));
        continue;
      }
      if (!segment.text.includes("\n")) {
        const chunk = DIRECTIVE.test(segment.text) ? segment.text.trimStart() : segment.text;
        view.type(lead + chunk);
        continue;
      }
      tab.pasteMenuSeen = false;
      view.paste(lead + segment.text);
      await sleep(EDITOR_SETTLE_MS);
      await answerPasteMenu(
        tab,
        fallback,
        isLargePaste(segment.text) && triggersPasteMenu(countPasteLines(segment.text)),
      );
    }

    recordSentMessage(tab, renderPasteMarkersForHistory(body));
  }

  // Single submit for attachments + text together.
  view.submit();
}

/**
 * Cap on how much of a chunk is scanned for statusline state. omp's statusline
 * is the tail of a frame and a full screen of ANSI is well under this, so the
 * only chunks big enough to be trimmed are image payloads — which must never
 * cost the UI thread a multi-megabyte regex pass while the PTY waits on an ack.
 */
const STATUS_SCAN_LIMIT = 262_144;

/** Parse omp's terminal stream to extract active model, thinking level, plan state and usage metrics. */
function parseStatusStream(tab: Tab, rawData: string): void {
  // Drop inline image sequences (OSC 1337 ; File= ... BEL/ST) before any heavy
  // regex sees them. An unterminated one runs to the end of the chunk: the
  // stream transformer releases a stuck sequence raw, so that case is real.
  let text = rawData;
  if (text.includes("\x1b]1337;File=")) {
    text = text.replace(/\x1b\]1337;File=[^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
    const open = text.indexOf("\x1b]1337;File=");
    if (open >= 0) text = text.slice(0, open);
    if (!text.trim()) return;
  }
  if (text.length > STATUS_SCAN_LIMIT) text = text.slice(text.length - STATUS_SCAN_LIMIT);
  const plain = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
  if (!plain) return;
  // Ahead of the statusline gate: omp's large-paste selector replaces the
  // statusline entirely while it is up.
  if (detectPasteMenu(plain)) tab.pasteMenuSeen = true;
  // Plan lines must be handled before the statusline gate: "Plan mode paused."
  // and "Plan mode disabled." can arrive without a statusline.
  const planStatus = parsePlanStatus(plain);
  if (planStatus) tab.plan.observe(planStatus, Date.now());
  if (isPlanExitConfirm(plain)) tab.plan.confirmPrompt(Date.now());

  // Plan review detection: OMP displays "Plan mode - next step" menu with options
  const isPlanReview =
    /Plan mode\s*[-–—]\s*next step/i.test(plain) ||
    (plain.includes("Approve and execute") && plain.includes("Refine plan"));

  if (isPlanReview) {
    const first = tab.planReview === null;
    const statsMatch = /Approve and keep context\s*(\([^\)]+\))/i.exec(plain);
    tab.planReview = { contextStats: statsMatch?.[1] };
    if (first) raisePlanReviewAttention(tab);
    if (tab === active) syncPlanReviewModal(tab);
  } else if (
    (tab.planReview || tab.planReviewCompacting) &&
    !plain.includes("Approve and execute") &&
    !plain.includes("Plan mode - next step") &&
    (plain.includes("Plan mode enabled") || plain.includes("Plan mode disabled") || plain.includes("π ") || /^\s*π\s+/m.test(plain))
  ) {
    tab.planReview = null;
    tab.planReviewCompacting = false;
    clearPlanReviewAttention(tab);
    if (tab === active) syncPlanReviewModal(tab);
  }
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
  pasteMode: () => pasteMode,
  pasteMarkerStyle: () => pasteMarkerStyle,
  pasteMarkerPulse: () => pasteMarkerPulse,
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
  openModel: () => openModelSelector(),
  openUsage: () => {
    if (!usageModal) {
      usageModal = new UsageModal(
        () => {
          if (active?.view) active.view.runSlash("/stats");
        },
        () => usageTracker!.refresh(),
      );
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
            dock.showToast("Just copied", 1300);
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
  openCwd: () => {
    if (active) void api.openPath(active.cwd);
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
  toggleViewMode: () => {
    if (active) setViewMode(active, active.viewMode === "chat" ? "terminal" : "chat");
  },
});

function openModelSelector(): void {
  if (!modelModal) {
    modelModal = new ModelModal(
      customModels,
      active?.modelName ?? "gemini-3.7-flash",
      (modelId, provider) => {
        if (!active?.view) return;
        const cmdArg = provider && provider !== "generic" ? `${provider}/${modelId}` : modelId;
        active.view.runSlash(`/m ${cmdArg}`);
        active.modelName = modelId;
        applyModelToDock(modelId, active.thinkingLevel, active);
        persist();
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
}

// Floating dock: keep terminal bottom padding in sync with dock height, but
// only when clearance changes enough that xterm may gain/lose a row.
{
  const dockEl = document.getElementById("dock");
  if (dockEl) {
    let lastClearance = -1;
    let clearanceFrame: number | null = null;
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
    const queueDockClearance = (): void => {
      if (clearanceFrame !== null) return;
      clearanceFrame = window.requestAnimationFrame(() => {
        clearanceFrame = null;
        syncDockClearance();
      });
    };
    syncDockClearance();
    new ResizeObserver(queueDockClearance).observe(dockEl);
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
  if (!tab?.view) {
    // Nothing can render this chunk, but the PTY stays paused until we ack.
    // A silent return wedges the session permanently.
    api.ack(id);
    return;
  }
  tab.view.feed(data, () => api.ack(id));
  parseStatusStream(tab, data);
});

api.onStalled(({ id }) => {
  const tab = bySession.get(id);
  if (tab) showStallBanner(tab);
});
api.onStallCleared(({ id }) => {
  const tab = bySession.get(id);
  if (tab) clearStallBanner(tab);
});

/** Route control-bridge telemetry to the owning tab only. */
function findTabForBridgeStatus(status: {
  sessionId?: string | null;
  pid?: number;
  cwd?: string | null;
}): Tab | undefined {
  const rawKey = status.sessionId?.trim();
  if (!rawKey) return undefined;

  const key = rawKey.includes(":") ? rawKey.slice(rawKey.lastIndexOf(":") + 1) : rawKey;
  const byKey = tabs.find((t) => t.sessionKey === key || t.sessionId === key);
  // Background workers inherit PISHIFT_SESSION_ID. Only the hosted omp PID
  // owns terminal/session chrome for that session; workers publish through
  // the parent's job snapshot instead.
  if (
    byKey &&
    typeof status.pid === "number" &&
    status.pid > 0 &&
    byKey.ompPid !== null &&
    byKey.ompPid !== status.pid
  ) {
    return undefined;
  }
  return byKey;
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

  // The transcript is keyed by omp's own session id, not PISHIFT_SESSION_ID.
  // Backfill matched on the wrong id space before this and always found nothing.
  const ompId = status.ompSessionId?.trim() || null;
  if (ompId && ompId !== tab.ompSessionId) {
    tab.ompSessionId = ompId;
    // `/new` and `/resume` repoint the same tab at a different transcript.
    if (tab.transcriptSubscribed) subscribeTranscript(tab);
  }
  // First sight of a session (startup, `/new`, or a `/resume` typed straight
  // into the terminal) is the only reliable moment to load what that chat
  // already contains — the modal's resume click is just one of those paths.
  if (ompId && ompId !== tab.activityBackfilledKey) {
    void backfillSessionMessages(tab, ompId);
  }
  if (typeof status.pid === "number" && status.pid > 0) {
    tab.ompPid = status.pid;
  }

  // Stream text is UDP-only, so it is absent on the 2 s status-file poll; only
  // apply it when the publication actually carried the field.
  if ("stream" in status) tab.chat?.setStream(status.stream);
  // The job registry is independent from the terminal session lifecycle. Its
  // polling updates must not reset activity chrome or overwrite model/thinking
  // selections with the background worker's context.
  if (isJobLifecycleUpdate(status)) {
    tab.jobs = status.jobs ?? [];
    if (tab === active) todoPanel.setJobs(tab.jobs);
    return;
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
    const prevAskId = tab.pendingAsk?.toolCallId ?? null;
    tab.pendingAsk = status.ask ?? null;
    if (tab.pendingAsk && tab.pendingAsk.toolCallId !== tab.dismissedAskToolCallId) {
      tab.dismissedAskToolCallId = null;
    }
    if (tab.pendingAsk && tab.pendingAsk.toolCallId !== prevAskId) {
      raiseAskAttention(tab, tab.pendingAsk);
    } else if (!tab.pendingAsk) {
      clearAskAttention(tab);
    }
  }
  if ("todo" in status) {
    tab.todo = status.todo ?? null;
  }
  if ("jobs" in status) {
    tab.jobs = status.jobs ?? [];
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
  todoPanel.setJobs(tab.jobs);
}

api.onControlBridgeStatus((status) => {
  applyControlBridgeStatus(status);
});

api.onTranscriptUpdate((snapshot) => {
  const tab = bySession.get(snapshot.ptySessionId);
  tab?.chat?.apply(snapshot);
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
  api.unsubscribeTranscript(id);
  tab.transcriptSubscribed = false;
  tab.sessionId = null;
  tab.sessionKey = null;
  tab.ompSessionId = null;
  tab.ompPid = null;
  tab.suppressDoneSound = true;
  setTabActivity(tab, "idle");
  clearAskSend(tab);
  tab.view?.dispose();
  tab.view = null;
  showNotice(tab, `omp exited (code ${exitCode})`);
  clearStallBanner(tab);
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
    usageModal = new UsageModal(
      () => {
        if (active?.view) active.view.runSlash("/stats");
      },
      () => usageTracker!.refresh(),
    );
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
          const tab = active;
          resetActivityHistory(tab);
          void backfillSessionMessages(tab, sessionId);
          active.view.runSlash(`/resume ${sessionId}`);
          active.view.focus();
        }
      },
      onTriggerResumePicker: () => {
        if (active?.view) {
          resetActivityHistory(active);
          active.view.runSlash(`/resume`);
          active.view.focus();
        }
      },
      onNewChat: () => {
        if (active?.view) {
          resetActivityHistory(active);
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
      defaultViewMode,
      autoExpandTools,
      autoExpandReasoning,
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
      onDefaultViewModeChange: (mode) => {
        defaultViewMode = mode;
        persist();
      },
      onToggleAutoExpandTools: (enabled) => {
        autoExpandTools = enabled;
        for (const tab of tabs) tab.chat?.setAutoExpandTools(enabled);
        persist();
      },
      onToggleAutoExpandReasoning: (enabled) => {
        autoExpandReasoning = enabled;
        for (const tab of tabs) tab.chat?.setAutoExpandReasoning(enabled);
        persist();
      },
      tabLayoutMode,
      onTabLayoutModeChange: (mode) => {
        applyTabLayoutMode(mode);
        persist();
      },
      initialScrollSteps: terminalScrollSteps,
      onScrollStepsChange: (steps) => {
        applyScrollSteps(steps);
        persist();
      },
      pasteMode,
      onPasteModeChange: (mode) => {
        pasteMode = mode;
        persist();
      },
      pasteMarkerStyle,
      onPasteMarkerStyleChange: (style) => {
        pasteMarkerStyle = style;
        persist();
      },
      pasteMarkerPaint,
      onPasteMarkerPaintChange: (paint) => {
        pasteMarkerPaint = paint;
        applyPasteMarkerPaint();
        persist();
      },
      pasteMarkerPulse,
      onTogglePasteMarkerPulse: (enabled) => {
        pasteMarkerPulse = enabled;
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
      usageTracker: usageTrackerSettings,
      usageReports: [...(usageTracker?.currentReports ?? [])],
      settingsSectionCollapsed,
      onUsageTrackerChange: (settings) => {
        usageTrackerSettings = normalizeUsageTrackerSettings(settings);
        usageTracker?.updateSettings(usageTrackerSettings);
        persist();
      },
      onSettingsSectionCollapsedChange: (collapsed) => {
        settingsSectionCollapsed = normalizeSettingsSectionCollapsed(collapsed);
        persist();
      },
      onRefreshUsage: async () => {
        await usageTracker?.refresh();
      },
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
    defaultViewMode,
    autoExpandTools,
    autoExpandReasoning,
    tabLayoutMode,
    scrollSteps: terminalScrollSteps,
    pasteMode,
    pasteMarkerStyle,
    pasteMarkerPaint,
    pasteMarkerPulse,
    doneSoundEnabled,
    doneSoundVolume,
    usageTracker: usageTrackerSettings,
    usageReports: [...(usageTracker?.currentReports ?? [])],
    settingsSectionCollapsed,
  });
  settingsModal.open();
}

todoBtn.addEventListener("click", () => todoPanel.toggle());
recentFoldersBtn.addEventListener("click", () => openRecentFoldersModal());
recentChatsBtn.addEventListener("click", () => openRecentChatsModal());
splitBtn?.addEventListener("click", () => void toggleSplitScreen());
settingsBtn.addEventListener("click", () => openSettingsModal());

panePrimaryEl.addEventListener("mousedown", () => focusPane("primary"), { capture: true });
paneSecondaryEl.addEventListener("mousedown", () => focusPane("secondary"), { capture: true });
panePrimaryEl.addEventListener("focusin", () => focusPane("primary"));
paneSecondaryEl.addEventListener("focusin", () => focusPane("secondary"));

let isDraggingDivider = false;

splitDividerEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  isDraggingDivider = true;
  document.body.classList.add("resizing-split");
  splitDividerEl.classList.add("dragging");
  e.preventDefault();
});

window.addEventListener("mousemove", (e) => {
  if (!isDraggingDivider) return;
  const rect = viewsEl.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = Math.max(0.2, Math.min(0.8, (e.clientX - rect.left) / rect.width));
  splitRatio = ratio;
  viewsEl.style.setProperty("--split-ratio", `${(ratio * 100).toFixed(1)}%`);
});

window.addEventListener("mouseup", () => {
  if (!isDraggingDivider) return;
  isDraggingDivider = false;
  document.body.classList.remove("resizing-split");
  splitDividerEl.classList.remove("dragging");
  primaryTab?.view?.refit();
  secondaryTab?.view?.refit();
  persist();
});

splitDividerEl.addEventListener("dblclick", () => {
  splitRatio = 0.5;
  viewsEl.style.setProperty("--split-ratio", "50%");
  primaryTab?.view?.refit();
  secondaryTab?.view?.refit();
  persist();
});

topMenuBtn?.addEventListener("click", () => {
  if (!topMenu && topMenuBtn) {
    topMenu = new TopMenu(topMenuBtn, {
      onOpenTodo: () => todoPanel.toggle(),
      onOpenSettings: () => openSettingsModal(),
      onToggleSplit: () => void toggleSplitScreen(),
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

document.addEventListener("click", (event) => {
  const anchor = (event.target as HTMLElement | null)?.closest("a");
  if (anchor && anchor.href) {
    try {
      const parsed = new URL(anchor.href);
      if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
        event.preventDefault();
        void api.openExternal(anchor.href);
      }
    } catch {
      // Ignore invalid URLs
    }
  }
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
          // Find is a terminal capability; reverting is exactly the escape hatch
          // the chat view promises, and beats a second, divergent find UI.
          setViewMode(active, "terminal");
          active.view?.toggleSearch();
          return;
        case "u":
          claim();
          setViewMode(active, active.viewMode === "chat" ? "terminal" : "chat");
          return;
        case "tab":
          claim();
          cycleTab(-1);
          return;
        default:
          return;
      }
    }
    if (key === "\\" || ev.code === "Backslash") {
      claim();
      void toggleSplitScreen();
      return;
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
  if (isPasteModeSetting(state.pasteMode)) {
    pasteMode = state.pasteMode;
  }
  if (isPasteMarkerStyle(state.pasteMarkerStyle)) {
    pasteMarkerStyle = state.pasteMarkerStyle;
  }
  if (isPasteMarkerPaint(state.pasteMarkerPaint)) {
    pasteMarkerPaint = state.pasteMarkerPaint;
  }
  if (typeof state.pasteMarkerPulse === "boolean") {
    pasteMarkerPulse = state.pasteMarkerPulse;
  }
  applyPasteMarkerPaint();
  if (state.defaultViewMode === "chat" || state.defaultViewMode === "terminal") {
    defaultViewMode = state.defaultViewMode;
  }
  if (typeof state.autoExpandTools === "boolean") {
    autoExpandTools = state.autoExpandTools;
  }
  if (typeof state.autoExpandReasoning === "boolean") {
    autoExpandReasoning = state.autoExpandReasoning;
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
  applyTabLayoutMode(
    isTabLayoutMode(state.tabLayoutMode) ? state.tabLayoutMode : DEFAULT_TAB_LAYOUT_MODE,
  );
  usageTrackerSettings = normalizeUsageTrackerSettings(state.usageTracker);
  settingsSectionCollapsed = {
    ...DEFAULT_SETTINGS_SECTION_COLLAPSED,
    ...normalizeSettingsSectionCollapsed(state.settingsSectionCollapsed),
  };
  usageTracker?.updateSettings(usageTrackerSettings);
  updateHeaderUsageVisibility();
  void refreshHeaderUsage();
  if (typeof state.splitRatio === "number" && state.splitRatio >= 0.2 && state.splitRatio <= 0.8) {
    splitRatio = state.splitRatio;
    viewsEl.style.setProperty("--split-ratio", `${(splitRatio * 100).toFixed(1)}%`);
  }

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
