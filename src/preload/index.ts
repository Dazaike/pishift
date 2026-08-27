import { contextBridge, ipcRenderer, webUtils } from "electron";
import { release } from "node:os";

import {
  CH,
  type ControlBridgeState,
  type GetJobActivityRequest,
  type ImagePreview,
  type InstalledModelGroup,
  type JobActivityDetails,
  type KillJobRequest,
  type PersistedState,
  type ProviderUsageReport,
  type PtyData,
  type PtyExit,
  type PtyStall,
  type PtyStallCleared,
  type RecentChatInfo,
  type SessionMessage,
  type SpawnRequest,
  type SpawnResult,
} from "../shared/ipc";
import type { SlashCommand } from "../shared/slash-commands";

const api = {
  spawn: (req: SpawnRequest): Promise<SpawnResult> => ipcRenderer.invoke(CH.ptySpawn, req),
  write: (id: string, data: string): void => ipcRenderer.send(CH.ptyWrite, id, data),
  resize: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send(CH.ptyResize, id, cols, rows),
  ack: (id: string): void => ipcRenderer.send(CH.ptyAck, id),
  kill: (id: string): void => ipcRenderer.send(CH.ptyKill, id),
  resumeFlow: (id: string): void => ipcRenderer.send(CH.ptyResumeFlow, id),

  // xterm needs ConPTY compat flags: without them a row increase replaces rows
  // instead of pulling scrollback back into the viewport, losing output.
  windowsPty:
    process.platform === "win32"
      ? {
          backend: "conpty" as const,
          buildNumber: Number.parseInt(release().split(".")[2] ?? "", 10) || 0,
        }
      : undefined,

  onData: (fn: (payload: PtyData) => void): void => {
    ipcRenderer.on(CH.ptyData, (_e, payload: PtyData) => fn(payload));
  },
  onExit: (fn: (payload: PtyExit) => void): void => {
    ipcRenderer.on(CH.ptyExit, (_e, payload: PtyExit) => fn(payload));
  },
  onStalled: (fn: (payload: PtyStall) => void): void => {
    ipcRenderer.on(CH.ptyStalled, (_e, payload: PtyStall) => fn(payload));
  },
  onStallCleared: (fn: (payload: PtyStallCleared) => void): void => {
    ipcRenderer.on(CH.ptyStallCleared, (_e, payload: PtyStallCleared) => fn(payload));
  },

  onControlBridgeStatus: (fn: (state: ControlBridgeState) => void): void => {
    ipcRenderer.on(CH.controlBridgeStatus, (_e, state: ControlBridgeState) => fn(state));
  },
  readControlBridgeStatus: (): Promise<ControlBridgeState | null> =>
    ipcRenderer.invoke(CH.readControlBridgeStatus),

  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(CH.pickDirectory),
  notify: (title: string, body: string): void => ipcRenderer.send(CH.notify, title, body),
  saveClipboardImage: (): Promise<string | null> =>
    ipcRenderer.invoke(CH.saveClipboardImage),
  readClipboardText: (): Promise<string> => ipcRenderer.invoke(CH.readClipboardText),
  imagePreview: (path: string, maxSize: number): Promise<ImagePreview | null> =>
    ipcRenderer.invoke(CH.imagePreview, path, maxSize),
  saveImageEdit: (path: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke(CH.saveImageEdit, path, dataUrl),
  loadState: (): Promise<PersistedState> => ipcRenderer.invoke(CH.loadState),
  saveState: (next: Partial<PersistedState>): void => ipcRenderer.send(CH.saveState, next),
  homeDir: (): Promise<string> => ipcRenderer.invoke(CH.homeDir),
  defaultCwd: (): Promise<string> => ipcRenderer.invoke(CH.defaultCwd),
  getModels: (): Promise<InstalledModelGroup[]> => ipcRenderer.invoke(CH.getModels),
  getProviderUsage: (): Promise<ProviderUsageReport[]> => ipcRenderer.invoke(CH.getProviderUsage),
  getRecentFolders: (): Promise<string[]> => ipcRenderer.invoke(CH.getRecentFolders),
  addRecentFolder: (folder: string): Promise<string[]> => ipcRenderer.invoke(CH.addRecentFolder, folder),
  removeRecentFolder: (folder: string): Promise<string[]> => ipcRenderer.invoke(CH.removeRecentFolder, folder),
  clearRecentFolders: (): void => ipcRenderer.send(CH.clearRecentFolders),
  getRecentChats: (cwd?: string): Promise<RecentChatInfo[]> => ipcRenderer.invoke(CH.getRecentChats, cwd),
  getSessionMessages: (sessionId: string): Promise<SessionMessage[]> =>
    ipcRenderer.invoke(CH.getSessionMessages, sessionId),
  getSkillCommands: (cwd?: string): Promise<SlashCommand[]> =>
    ipcRenderer.invoke(CH.getSkillCommands, cwd),
  getJobActivity: (req: GetJobActivityRequest): Promise<JobActivityDetails | null> =>
    ipcRenderer.invoke(CH.getJobActivity, req),
  killJob: (req: KillJobRequest): Promise<boolean> =>
    ipcRenderer.invoke(CH.killJob, req),
  setChromeColors: (background: string, symbol: string): void =>
    ipcRenderer.send(CH.setChromeColors, { background, symbol }),
  setTaskbarBusy: (busy: boolean): void => ipcRenderer.send(CH.setTaskbarBusy, busy),
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke(CH.openPath, targetPath),
  showItemInFolder: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke(CH.showItemInFolder, targetPath),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(CH.openExternal, url),
  copyText: (text: string): void => ipcRenderer.send(CH.copyText, text),
  quitApp: (): void => ipcRenderer.send(CH.quitApp),
  relaunchApp: (): void => ipcRenderer.send(CH.relaunchApp),
  // `File.path` was removed in Electron 32; this is the only way to recover the
  // on-disk path of a dropped file. Returns "" for in-memory Files.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
};

export type OmphifApi = typeof api;

contextBridge.exposeInMainWorld("omphif", api);
