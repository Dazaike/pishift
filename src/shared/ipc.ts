/** IPC channel names and payload types shared by main, preload and renderer. */

export const CH = {
  ptySpawn: "pty:spawn",
  ptyWrite: "pty:write",
  ptyResize: "pty:resize",
  ptyAck: "pty:ack",
  ptyKill: "pty:kill",
  ptyData: "pty:data",
  ptyExit: "pty:exit",
  pickDirectory: "app:pick-directory",
  notify: "app:notify",
  saveClipboardImage: "app:save-clipboard-image",
  imagePreview: "app:image-preview",
  readClipboardText: "app:read-clipboard-text",
  loadState: "app:load-state",
  saveState: "app:save-state",
  homeDir: "app:home-dir",
  getModels: "app:get-models",
  getProviderUsage: "app:get-provider-usage",
  controlBridgeStatus: "control-bridge:status",
  readControlBridgeStatus: "control-bridge:read-status",
  setChromeColors: "app:set-chrome-colors",
  openPath: "app:open-path",
  showItemInFolder: "app:show-item-in-folder",
  copyText: "app:copy-text",
} as const;

export type ControlBridgeActivity = "idle" | "working" | "thinking";

export interface ControlBridgeState {
  running: boolean;
  activity: ControlBridgeActivity;
  model: string | null;
  thinkingLevel: string;
  plan: boolean;
  pid: number;
  cwd: string | null;
  /** Host session key (`OMPHIF_SESSION_ID` / ITERM_SESSION_ID suffix). */
  sessionId?: string | null;
  updatedAt: string;
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

export type TabState = { cwd: string; customTitle?: string; colorTag?: string };

export type WindowBounds = { x: number; y: number; width: number; height: number };

import type { ThemeSettings } from "./theme";

export type CustomModelConfig = {
  id: string;
  name: string;
  provider: string;
  iconUrl?: string;
};

export type PersistedState = {
  bounds?: WindowBounds;
  ompPath?: string;
  themeName?: string;
  theme?: Partial<ThemeSettings>;
  favoriteModels?: string[];
  customModels?: CustomModelConfig[];
  showFavoritesOnly?: boolean;
  showUsageInHeader?: boolean;
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
