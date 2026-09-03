/** IPC channel names and payload types shared by main, preload and renderer. */

import type { AgentActivity } from "./activity";
import type { PlanMode } from "./plan-mode";
import type {
  PasteMarkerPaint,
  PasteMarkerStyle,
  PasteModeSetting,
} from "./paste-attach";

/** Transcript payloads travel over `CH.transcript*`; the model lives in `./transcript`. */
export type {
  TranscriptEntry,
  TranscriptMarker,
  TranscriptPart,
  TranscriptRow,
  TranscriptSnapshot,
} from "./transcript";

export const CH = {
  ptySpawn: "pty:spawn",
  ptyWrite: "pty:write",
  ptyResize: "pty:resize",
  ptyAck: "pty:ack",
  ptyStalled: "pty:stalled",
  ptyStallCleared: "pty:stall-cleared",
  ptyResumeFlow: "pty:resume-flow",
  ptyKill: "pty:kill",
  ptyData: "pty:data",
  ptyExit: "pty:exit",
  pickDirectory: "app:pick-directory",
  notify: "app:notify",
  saveClipboardImage: "app:save-clipboard-image",
  imagePreview: "app:image-preview",
  saveImageEdit: "app:save-image-edit",
  readClipboardText: "app:read-clipboard-text",
  loadState: "app:load-state",
  saveState: "app:save-state",
  homeDir: "app:home-dir",
  getModels: "app:get-models",
  getProviderUsage: "app:get-provider-usage",
  controlBridgeStatus: "control-bridge:status",
  readControlBridgeStatus: "control-bridge:read-status",
  setChromeColors: "app:set-chrome-colors",
  setTaskbarBusy: "app:set-taskbar-busy",
  openPath: "app:open-path",
  showItemInFolder: "app:show-item-in-folder",
  copyText: "app:copy-text",
  quitApp: "app:quit",
  relaunchApp: "app:relaunch",
  defaultCwd: "app:default-cwd",
  getRecentFolders: "app:get-recent-folders",
  addRecentFolder: "app:add-recent-folder",
  removeRecentFolder: "app:remove-recent-folder",
  clearRecentFolders: "app:clear-recent-folders",
  getRecentChats: "app:get-recent-chats",
  getSessionMessages: "app:get-session-messages",
  getSkillCommands: "app:get-skill-commands",
  getJobActivity: "app:get-job-activity",
  killJob: "app:kill-job",
  openExternal: "app:open-external",
  subscribeTranscript: "transcript:subscribe",
  unsubscribeTranscript: "transcript:unsubscribe",
  transcriptUpdate: "transcript:update",
  transcriptBlob: "transcript:blob",
} as const;

export type ControlBridgeActivity = AgentActivity;

/** Activities the composer glow (and optionally tab indicators) can be colored by. */
export type GlowActivity = Exclude<ControlBridgeActivity, "idle">;

export const GLOW_ACTIVITIES: readonly GlowActivity[] = [
  "waiting",
  "thinking",
  "responding",
  "reading",
  "editing",
  "running",
  "working",
];

export const GLOW_ACTIVITY_LABELS: Record<GlowActivity, string> = {
  waiting: "Waiting",
  thinking: "Thinking",
  responding: "Responding",
  reading: "Reading",
  editing: "Editing",
  running: "Running command",
  working: "Working",
};

export const DEFAULT_ACTIVITY_COLORS: Record<GlowActivity, string> = {
  waiting: "#94a3b8",
  thinking: "#c084fc",
  responding: "#7aa2f7",
  reading: "#38bdf8",
  editing: "#fb923c",
  running: "#4ade80",
  working: "#7aa2f7",
};

export interface PendingAskOption {
  label: string;
  description?: string;
}

export interface PendingAskQuestion {
  id?: string;
  question: string;
  options: PendingAskOption[];
  multi?: boolean;
  recommended?: number;
  header?: string;
}

export interface PendingAsk {
  toolCallId: string;
  questions: PendingAskQuestion[];
}

export interface TodoTask {
  content: string;
  status: string;
}

export interface TodoPhase {
  name: string;
  tasks: TodoTask[];
}

export interface AsyncJob {
  id: string;
  /** `task` | `bash` | `tool` | `command` as reported by omp; treat as open. */
  type: string;
  /** `running` | `completed` | `failed` | `cancelled` as reported by omp. */
  status: string;
  label: string;
  /** Epoch ms; 0 when omp did not report one. */
  startTime: number;
  /** Model ID (e.g. `anthropic/claude-opus-5` or `gemini-3.7-flash`) if known. */
  model?: string;
}

export interface JobActivityEvent {
  type: "user_message" | "assistant_message" | "thinking" | "tool_call" | "tool_result" | "raw_log" | "artifact";
  timestamp?: number;
  text?: string;
  toolName?: string;
  toolIntent?: string;
  toolArgs?: Record<string, unknown> | string;
  toolResult?: string;
  isError?: boolean;
}

export interface JobActivityDetails {
  jobId: string;
  label: string;
  type: string;
  status: string;
  startTime: number;
  model?: string;
  artifactMarkdown?: string;
  events: JobActivityEvent[];
  rawLog?: string;
}

export interface GetJobActivityRequest {
  jobId: string;
  label?: string;
  type?: string;
  status?: string;
  startTime?: number;
  cwd?: string | null;
}
export type ControlBridgeStream = { kind: "text" | "thinking"; text: string };

export interface KillJobRequest {
  jobId: string;
  sessionId?: string | null;
}
export type ControlBridgeUpdateKind = "session" | "jobs";

export interface ControlBridgeState {
  /** Identifies whether this publication is session telemetry or a job lifecycle update. */
  updateKind: ControlBridgeUpdateKind;
  running: boolean;
  activity: ControlBridgeActivity;
  model: string | null;
  thinkingLevel: string;
  /**
   * Native plan tri-state published by the control-bridge extension.
   * Absent when the running bridge predates the tri-state contract; treat a
   * missing value as "no information" rather than "off".
   */
  planMode?: PlanMode;
  ask: PendingAsk | null;
  todo: TodoPhase[] | null;
  /** Absent when the running bridge predates job publishing. */
  jobs?: AsyncJob[];
  pid: number;
  cwd: string | null;
  /** Host session key (`PISHIFT_SESSION_ID` / ITERM_SESSION_ID suffix). */
  sessionId?: string | null;
  /**
   * omp's own session id, naming the on-disk JSONL transcript.
   * Absent when the running bridge predates transcript publishing.
   */
  ompSessionId?: string | null;
  /**
   * Assistant output still being written, rebuilt from omp's `message_update`
   * deltas. UDP-only and never persisted, so it is absent whenever the renderer
   * falls back to polling the status file, and on a bridge predating streaming.
   */
  stream?: ControlBridgeStream | null;
  updatedAt: string;
}

/** Job lifecycle publications must never be applied as terminal session state. */
export function isJobLifecycleUpdate(
  status: Pick<ControlBridgeState, "updateKind">,
): boolean {
  return status.updateKind === "jobs";
}


export type InstalledModel = {
  id: string;
  name: string;
  provider: string;
  description?: string;
  reasoning?: boolean;
  /** Supported effort tokens from models.db `thinking.efforts`. */
  thinkingEfforts?: string[];
  thinkingRequiresEffort?: boolean;
};

export type InstalledModelGroup = {
  provider: string;
  providerName: string;
  models: InstalledModel[];
};

export type ProviderLimit = {
  label: string;
  used: number;
  limit: number;
  remaining: number;
  unit: string;
  usedPercent: number;
  resetsIn?: string;
};

export type ProviderUsageReport = {
  provider: string;
  providerName: string;
  status?: string;
  account?: string;
  limits: ProviderLimit[];
  rawText?: string;
};

export type ProviderUsageStat = {
  provider: string;
  totalRequests: number;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  totalCost: number;
  lastUsed?: number;
  reports?: ProviderUsageReport[];
};

export type SpawnRequest = {
  cwd: string;
  cols: number;
  rows: number;
  resume?: boolean;
};

export type SpawnResult = { id: string; pid: number } | { error: string };

export type PtyData = { id: string; data: string };
export type PtyExit = { id: string; exitCode: number };
export type PtyStall = { id: string; pausedMs: number };
export type PtyStallCleared = { id: string };

export type TabState = { cwd: string; customTitle?: string; colorTag?: string };

export type WindowBounds = { x: number; y: number; width: number; height: number };

import type { ThemeSettings } from "./theme";
import type { TabLayoutMode } from "./tab-layout";
import type { SettingsSectionId, UsageTrackerSettings } from "./usage-tracker";

export type CustomModelConfig = {
  id: string;
  name: string;
  provider: string;
  iconUrl?: string;
};

export interface RecentChatInfo {
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
  mtime: number;
}

/** One user-authored turn, extracted from a session's on-disk transcript. */
export interface SessionMessage {
  text: string;
  at: number;
}

export type PanelPosition = "top-right" | "center" | "top-center" | "bottom-center";

/** Which renderer a tab shows. The PTY runs in both modes. */
export type ViewMode = "terminal" | "chat";

export type PersistedState = {
  bounds?: WindowBounds;
  ompPath?: string;
  themeName?: string;
  theme?: Partial<ThemeSettings>;
  fontFamily?: string;
  /** Terminal zoom (xterm font size in px). */
  fontSize?: number;
  /** Rows the terminal advances per wheel detent. */
  scrollSteps?: number;
  /** How a long dock paste is attached; "ask" shows the chooser. */
  pasteMode?: PasteModeSetting;
  /** Composer marker wording for a collapsed paste. */
  pasteMarkerStyle?: PasteMarkerStyle;
  /** Composer marker paint treatment. */
  pasteMarkerPaint?: PasteMarkerPaint;
  /** Flash the marker when a paste lands. */
  pasteMarkerPulse?: boolean;
  favoriteModels?: string[];
  customModels?: CustomModelConfig[];
  showFavoritesOnly?: boolean;
  showUsageInHeader?: boolean;
  /** User overrides for the composer glow color per activity; unset keys fall back to defaults. */
  activityColors?: Partial<Record<GlowActivity, string>>;
  /** Also color tab busy indicators by activity, not just the composer glow. */
  activityColorsOnTabs?: boolean;
  todoPanelVisible?: boolean;
  todoPanelMode?: "overlay" | "docked";
  recentFolders?: string[];
  hideTopButtonLabels?: boolean;
  hideBottomButtonLabels?: boolean;
  collapseTopBarToMenu?: boolean;
  panelPosition?: PanelPosition;
  /** View mode applied to newly created tabs. */
  defaultViewMode?: ViewMode;
  /** Expand grouped transcript tool activity in Chat View. */
  autoExpandTools?: boolean;
  /** Open persisted thinking blocks in Chat View. */
  autoExpandReasoning?: boolean;
  /** How the tab strip copes with more tabs than the header can show. */
  tabLayoutMode?: TabLayoutMode;
  /** Chime when a session goes from working back to waiting for input. */
  doneSoundEnabled?: boolean;
  /** 0–1 playback volume for the completion chime. */
  doneSoundVolume?: number;
  /** Provider-backed compact quota tracker preferences. */
  usageTracker?: UsageTrackerSettings;
  /** Persisted state of Settings accordion groups. */
  settingsSectionCollapsed?: Partial<Record<SettingsSectionId, boolean>>;
  tabs: TabState[];
  activeIndex: number;
};

/** Downscaled preview of an attachment, produced in the main process. */
export type ImagePreview = { dataUrl: string; width: number; height: number };

export const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp)$/i;

/**
 * Wrap user text as a bracketed paste, applying the same normalisation xterm.js
 * applies on its own paste path (`prepareTextForTerminal`): newlines collapse to
 * CR so nothing is submitted implicitly, and ESC is neutered so pasted content
 * can never be interpreted as an escape sequence.
 */
export function bracketPaste(text: string): string {
  const safe = text.replace(/\r?\n/g, "\r").replace(/\x1b/g, "\u241b");
  return `\x1b[200~${safe}\x1b[201~`;
}

/**
 * Quote a filesystem path for omp's paste tokenizer (`tua()`), which splits on
 * unquoted whitespace. An unquoted `C:\a b.png` would arrive as two broken
 * tokens and the whole drop would degrade to plain text.
 */
export function quotePath(p: string): string {
  return /[\s"']/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p;
}
