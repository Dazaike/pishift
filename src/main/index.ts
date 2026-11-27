import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BrowserWindow,
  Notification,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  shell,
} from "electron";

// Disable Windows 11 Fluent/Overlay scrollbars so WebKit custom rounded scrollbars apply.
app.commandLine.appendSwitch("disable-features", "FluentScrollbar,OverlayScrollbar");

import {
  CH,
  OMP_SESSION_ID,
  type DetachTabRequest,
  type ExportSettingsResult,
  type ImagePreview,
  type ImportSettingsResult,
  type KillJobRequest,
  type PersistedState,
  type PtyData,
  type PtyExit,
  type PtyStall,
  type PtyStallCleared,
  type SpawnRequest,
  type SpawnResult,
  type TabState,
} from "../shared/ipc";
import { isSafeExternalUrl } from "../shared/url";
import { loadInstalledModels, loadRecentChats, loadRecentFolders, loadSessionMessages, queryOmpUsage } from "./omp-data";
import { loadSkillCommands } from "./omp-skills";
import { loadJobActivity } from "./job-activity";
import { checkOmpUpdate, performOmpUpdate } from "./omp-updater";
import { PtyManager } from "./pty-manager";
import { SessionLock } from "./session-lock";
import { StateStore } from "./state-store";
import { applyThemeOverrides, getThemeByName } from "../shared/themes";
import { ControlBridgeListener } from "./control-bridge-listener";
import { ElevationCancelledError, cancelPendingElevations, isProcessElevated } from "./elevation";
import { runPtyHost } from "./pty-host";
import { PTY_HOST_FLAG } from "./pty-host-protocol";
import { TranscriptWatcher, readSessionPlan, readTranscriptBlob } from "./transcript";

const DEFAULT_CHROME_BG = "#191b24";
const TEMP_SUBDIR = "pishift";

export function getDefaultCwd(): string {
  if (process.platform === "win32") {
    const tempDir = "C:\\temp";
    try {
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      return tempDir;
    } catch {
      return app.getPath("temp");
    }
  }
  return app.getPath("temp");
}
const windows = new Set<BrowserWindow>();
/** The window whose tabs and bounds are persisted. If it closes first, a surviving window takes over the bounds. */
let primaryWindow: BrowserWindow | null = null;
let lastFocusedWindow: BrowserWindow | null = null;
let store: StateStore;
let lock: SessionLock;
let ptys: PtyManager;
let bridgeListener: ControlBridgeListener | null = null;
let transcripts: TranscriptWatcher | null = null;
/** pty session id -> `webContents.id` of the window whose renderer spawned it; that window alone receives its output. */
const sessionOwner = new Map<string, number>();

function windowByContentsId(id: number): BrowserWindow | null {
  for (const window of windows) {
    if (!window.isDestroyed() && window.webContents.id === id) return window;
  }
  return null;
}

function send(
  channel: string,
  payload: PtyData | PtyExit | PtyStall | PtyStallCleared,
): void {
  const owner = sessionOwner.get(payload.id);
  if (owner === undefined) return;
  windowByContentsId(owner)?.webContents.send(channel, payload);
  if (channel === CH.ptyExit) sessionOwner.delete(payload.id);
}

/** Bridge and transcript updates are keyed by session; each renderer ignores sessions it does not host. */
function broadcast(channel: string, payload: unknown): void {
  for (const window of windows) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

/** Kills only the PTYs spawned by one window (its renderer crashed or it closed). */
function killOwnedSessions(contentsId: number): void {
  const ids: string[] = [];
  for (const [id, owner] of sessionOwner) {
    if (owner === contentsId) ids.push(id);
  }
  for (const id of ids) sessionOwner.delete(id);
  ptys.killSessions(ids);
}

function sanitizeTabState(raw: unknown): TabState | null {
  if (!raw || typeof raw !== "object") return null;
  const tab = raw as Partial<TabState>;
  if (typeof tab.cwd !== "string" || !tab.cwd) return null;
  return {
    cwd: tab.cwd,
    customTitle: typeof tab.customTitle === "string" ? tab.customTitle : undefined,
    colorTag: typeof tab.colorTag === "string" ? tab.colorTag : undefined,
    ompSessionId:
      typeof tab.ompSessionId === "string" && OMP_SESSION_ID.test(tab.ompSessionId) ? tab.ompSessionId : undefined,
    viewMode: tab.viewMode === "chat" || tab.viewMode === "terminal" ? tab.viewMode : undefined,
  };
}

/**
 * `adopt` makes a secondary window that opens exactly that tab (tab tear-off), at the drop point
 * with the primary window's current size. Without it this is the primary window.
 */
function createWindow(opts: { adopt?: TabState; x?: number; y?: number } = {}): BrowserWindow {
  const state = store.get();
  const { bounds, themeName } = state;
  const theme = applyThemeOverrides(getThemeByName(themeName), state.themeOverrides);
  const secondary = opts.adopt !== undefined;
  const size =
    secondary && primaryWindow && !primaryWindow.isDestroyed() ? primaryWindow.getNormalBounds() : bounds;
  const window = new BrowserWindow({
    title: "PiShift",
    width: size?.width ?? 1180,
    height: size?.height ?? 760,
    x: secondary ? opts.x : bounds?.x,
    y: secondary ? opts.y : bounds?.y,
    minWidth: 620,
    minHeight: 380,
    show: false,
    icon: join(__dirname, "../../src/renderer/assets/icons/icon.png"),
    titleBarStyle: "hidden",
    // Caption buttons are drawn in the renderer chrome (native overlay is unstyled).
    backgroundColor: theme.bg,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // Appearance preferences normally arrive after `loadState()` round-trips
      // over IPC. Pass the cached startup values to preload so the first
      // visible frame already matches the user's saved chrome/layout settings.
      additionalArguments: [
        `--pishift-theme=${encodeURIComponent(theme.name)}`,
        `--pishift-theme-overrides=${encodeURIComponent(JSON.stringify(state.themeOverrides?.[theme.name] ?? {}))}`,
        `--pishift-version=${encodeURIComponent(app.getVersion())}`,
        `--pishift-hide-top-labels=${state.hideTopButtonLabels ? "1" : "0"}`,
        `--pishift-hide-bottom-labels=${state.hideBottomButtonLabels ? "1" : "0"}`,
        `--pishift-collapse-top-bar=${state.collapseTopBarToMenu ? "1" : "0"}`,
        `--pishift-show-header-usage=${state.showUsageInHeader ? "1" : "0"}`,
        `--pishift-tab-previews=${state.tabPreviews === false ? "0" : "1"}`,
        `--pishift-high-contrast=${state.highContrast ? "1" : "0"}`,
        `--pishift-window=${secondary ? "secondary" : "primary"}`,
        ...(opts.adopt
          ? [`--pishift-adopt=${encodeURIComponent(Buffer.from(JSON.stringify(opts.adopt)).toString("base64url"))}`]
          : []),
      ],
    },
  });

  // `ready-to-show` can fire after HTML/CSS paints but before the renderer
  // module applies synchronous startup preferences. Waiting for the completed
  // page load guarantees the first visible frame already has those settings.
  window.webContents.once("did-finish-load", () => window.show());

  const emitMaximized = (): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(CH.windowMaximizedChanged, window.isMaximized());
  };
  window.on("maximize", emitMaximized);
  window.on("unmaximize", emitMaximized);

  const persistBounds = (): void => {
    // A torn-off window must not overwrite the saved bounds with its own.
    if (window === primaryWindow && !window.isDestroyed() && !window.isMinimized() && !window.isFullScreen()) {
      store.patch({ bounds: window.getNormalBounds() });
    }
  };
  window.on("resized", persistBounds);
  window.on("moved", persistBounds);
  window.on("close", () => {
    persistBounds();
    store.flush();
  });
  // `webContents.id` is unreadable once the window is destroyed, so capture it for `closed`.
  const contentsId = window.webContents.id;
  window.on("focus", () => {
    lastFocusedWindow = window;
  });
  window.on("closed", () => {
    windows.delete(window);
    if (lastFocusedWindow === window) lastFocusedWindow = null;
    if (primaryWindow === window) primaryWindow = windows.values().next().value ?? null;
    // The renderer's own unload normally kills its PTYs; this covers a window that died without it.
    killOwnedSessions(contentsId);
  });
  // Windows logoff/shutdown ends the session without emitting `before-quit`.
  window.on("session-end", () => {
    store.flush();
    lock.release();
  });

  let lastCrashReload = 0;
  window.webContents.on("render-process-gone", (_e, details) => {
    if (details.reason === "clean-exit") return;
    store.markCrashed("renderer-gone");
    killOwnedSessions(contentsId); // only this window's PTYs: other windows keep theirs
    const now = Date.now();
    if (window.isDestroyed() || now - lastCrashReload < 10_000) return; // never reload-loop
    lastCrashReload = now;
    window.webContents.reload();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
    }
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    // Renderer diagnostics are invisible from the dev terminal otherwise.
    window.webContents.on("console-message", ({ level, message, lineNumber, sourceId }) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${lineNumber})`);
    });
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  windows.add(window);
  if (!secondary) primaryWindow = window;
  return window;
}

/** The window that sent an IPC message; per-window requests (dialogs, caption buttons) must not hit another window. */
function senderWindow(e: { sender: Electron.WebContents }): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(e.sender);
  return window && !window.isDestroyed() ? window : null;
}

function registerIpc(): void {
  ipcMain.handle(CH.ptySpawn, async (e, req: SpawnRequest): Promise<SpawnResult> => {
    const owner = e.sender.id;
    try {
      const appElevated = await isProcessElevated();
      // An already-elevated app needs no helper: every session it spawns inherits its token.
      if (req.elevated === true && !appElevated) {
        const spawned = await ptys.spawnElevated(req);
        if (!windowByContentsId(owner)) {
          ptys.kill(spawned.id); // the window closed while the UAC prompt was up
          return { error: "The window that requested this session was closed." };
        }
        sessionOwner.set(spawned.id, owner);
        return { ...spawned, elevated: true };
      }
      const spawned = ptys.spawn(req);
      sessionOwner.set(spawned.id, owner);
      return { ...spawned, elevated: appElevated };
    } catch (err) {
      if (err instanceof ElevationCancelledError) return { error: err.message, elevationCancelled: true };
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle(CH.isAppElevated, () => isProcessElevated());

  ipcMain.on(CH.ptyWrite, (_e, id: string, data: string) => ptys.write(id, data));
  ipcMain.on(CH.ptyResize, (_e, id: string, cols: number, rows: number) =>
    ptys.resize(id, cols, rows),
  );
  ipcMain.on(CH.ptyAck, (_e, id: string, bytes: number) => ptys.ack(id, bytes));
  ipcMain.on(CH.ptyResumeFlow, (_e, id: string) => ptys.resumeFlow(id));
  ipcMain.on(CH.ptyKill, (_e, id: string) => ptys.kill(id));

  ipcMain.handle(CH.pickDirectory, async (e): Promise<string | null> => {
    const options = {
      properties: ["openDirectory" as const, "createDirectory" as const],
      title: "Choose a workspace folder",
    };
    const win = senderWindow(e);
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? (null) : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(CH.exportSettings, async (e): Promise<ExportSettingsResult> => {
    const options = {
      title: "Export PiShift Settings",
      defaultPath: "pishift-settings.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const win = senderWindow(e);
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };
    const payload = {
      app: "PiShift",
      exportedAt: new Date().toISOString(),
      version: app.getVersion(),
      settings: store.exportSettings(),
    };
    await writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf8");
    return { canceled: false, path: result.filePath };
  });

  ipcMain.handle(CH.importSettings, async (e): Promise<ImportSettingsResult> => {
    const options = {
      title: "Import PiShift Settings",
      properties: ["openFile" as const],
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const win = senderWindow(e);
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const filePath = result.canceled ? undefined : result.filePaths[0];
    if (!filePath) return { canceled: true };
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
      const settings =
        parsed && typeof parsed === "object" && "settings" in parsed ? parsed.settings : parsed;
      store.importSettings(settings);
      return { canceled: false, imported: true };
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.on(CH.notify, (_e, title: string, body: string) => {
    if (!Notification.isSupported()) return;
    new Notification({ title, body }).show();
  });

  // Returning a temp *path* rather than raw bytes is what lets omp's own
  // handleImagePathPaste do the attaching, including its autoResize handling.
  ipcMain.handle(CH.saveClipboardImage, async (): Promise<string | null> => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    const dir = join(app.getPath("temp"), TEMP_SUBDIR);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${randomUUID()}.png`);
    await writeFile(file, image.toPNG());
    return file;
  });

  // Renderer previews: decoding and downscaling here keeps the renderer free of
  // filesystem access and keeps the data URL small enough for a chip.
  ipcMain.handle(
    CH.imagePreview,
    async (_e, path: string, maxSize: number): Promise<ImagePreview | null> => {
      try {
        if (!path) return null;
        let image: Electron.NativeImage | null = null;
        try {
          image = await nativeImage.createThumbnailFromPath(path, {
            width: maxSize,
            height: maxSize,
          });
        } catch {
          image = nativeImage.createFromPath(path);
        }
        if (!image || image.isEmpty()) return null;
        const { width, height } = image.getSize();
        const scale = maxSize / Math.max(width, height);
        const scaled =
          scale < 1
            ? image.resize({
                width: Math.max(1, Math.round(width * scale)),
                height: Math.max(1, Math.round(height * scale)),
                quality: "good",
              })
            : image;
        return { dataUrl: scaled.toDataURL(), width, height };
      } catch {
        return null;
      }
    },
  );

  // Overwrites a dock attachment in place with an annotated PNG (drawn strokes
  // baked over the original), so submission and the thumbnail cache pick up
  // the edited pixels under the same path.
  ipcMain.handle(CH.saveImageEdit, async (_e, path: string, dataUrl: string): Promise<boolean> => {
    const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
    if (!match) return false;
    await writeFile(path, Buffer.from(match[1]!, "base64"));
    return true;
  });

  ipcMain.handle(CH.readClipboardText, () => clipboard.readText());
  ipcMain.handle(CH.loadState, (): PersistedState => store.get());
  ipcMain.on(CH.saveState, (e, next: Partial<PersistedState>) => {
    // Only the primary window owns the tab list and window bounds; a torn-off window's tabs are ephemeral.
    if (senderWindow(e) === primaryWindow) {
      store.patch(next);
      return;
    }
    const settings = { ...next };
    delete settings.tabs;
    delete settings.activeIndex;
    delete settings.bounds;
    store.patch(settings);
  });
  // Respawn-based tab tear-off: the new window starts its own omp resuming the tab's chat, so the
  // caller closes the source tab once this resolves true.
  ipcMain.handle(CH.detachTab, (_e, req: DetachTabRequest): boolean => {
    const adopt = sanitizeTabState(req);
    if (!adopt) return false;
    const coordinate = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
    createWindow({ adopt, x: coordinate(req.x), y: coordinate(req.y) });
    return true;
  });
  ipcMain.on(CH.dismissCrashRecovery, () => store.dismissCrashRecovery());
  ipcMain.handle(CH.homeDir, () => app.getPath("home"));
  ipcMain.handle(CH.defaultCwd, () => getDefaultCwd());
  ipcMain.handle(CH.getModels, () => loadInstalledModels());
  ipcMain.handle(CH.getProviderUsage, () => queryOmpUsage());
  ipcMain.handle(CH.readControlBridgeStatus, () => bridgeListener?.currentStates ?? []);
  ipcMain.handle(CH.checkOmpUpdate, () => checkOmpUpdate(store.ompPath));
  ipcMain.handle(CH.performOmpUpdate, (_e, expectedVersion?: unknown) =>
    performOmpUpdate(store.ompPath, typeof expectedVersion === "string" ? expectedVersion : undefined),
  );
  ipcMain.handle(CH.getRecentFolders, () => loadRecentFolders(store.recentFolders));
  ipcMain.handle(CH.getAppVersion, () => app.getVersion());
  ipcMain.handle(CH.addRecentFolder, (_e, folder: string) => store.addRecentFolder(folder));
  ipcMain.handle(CH.removeRecentFolder, (_e, folder: string) => store.removeRecentFolder(folder));
  ipcMain.on(CH.clearRecentFolders, () => store.clearRecentFolders());
  ipcMain.handle(CH.getRecentChats, (_e, cwd?: string) => loadRecentChats(cwd));
  ipcMain.handle(CH.getSessionMessages, (_e, sessionId: string) => loadSessionMessages(sessionId));
  ipcMain.handle(CH.getSkillCommands, (_e, cwd?: string) => loadSkillCommands(cwd));
  ipcMain.handle(CH.getJobActivity, (_e, req) => loadJobActivity(req));
  ipcMain.handle(
    CH.subscribeTranscript,
    (_e, ptySessionId: string, ompSessionId: string | null, cwd: string | null) =>
      transcripts?.subscribe(ptySessionId, ompSessionId, cwd) ?? null,
  );
  ipcMain.on(CH.unsubscribeTranscript, (_e, ptySessionId: string) => transcripts?.unsubscribe(ptySessionId));
  ipcMain.handle(CH.transcriptBlob, (_e, ref: string, mimeType: string) => readTranscriptBlob(ref, mimeType));
  ipcMain.handle(CH.planText, (_e, ompSessionId: string | null, ref: string) => readSessionPlan(ompSessionId, ref));
  ipcMain.handle(CH.killJob, async (_e, req: KillJobRequest) => {
    try {
      const cancelPath = join(app.getPath("home"), ".omp", "agent", "cancel-job.json");
      await mkdir(dirname(cancelPath), { recursive: true });
      await writeFile(cancelPath, JSON.stringify(req), "utf8");
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.on(
    CH.setChromeColors,
    (e, colors: { background: string; symbol: string }) => {
      const win = senderWindow(e);
      if (!win) return;
      const background = colors?.background || DEFAULT_CHROME_BG;
      try {
        // Caption buttons are custom HTML now; only keep the window shell color in sync.
        win.setBackgroundColor(background);
      } catch {
        // setBackgroundColor unavailable on some hosts
      }
    },
  );

  ipcMain.on(CH.windowMinimize, (e) => {
    senderWindow(e)?.minimize();
  });
  ipcMain.on(CH.windowMaximizeToggle, (e) => {
    const win = senderWindow(e);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(CH.windowClose, (e) => {
    senderWindow(e)?.close();
  });
  ipcMain.handle(CH.windowIsMaximized, (e) => senderWindow(e)?.isMaximized() ?? false);

  ipcMain.on(CH.setTaskbarBusy, (e, busy: boolean) => {
    const win = senderWindow(e);
    if (!win) return;
    try {
      // progress > 1 -> indeterminate marquee; < 0 -> remove the bar entirely.
      win.setProgressBar(busy ? 2 : -1, { mode: busy ? "indeterminate" : "none" });
    } catch {
      // Taskbar progress is unavailable on some hosts/desktop environments.
    }
  });

  ipcMain.handle(CH.openPath, (_e, targetPath: string) => shell.openPath(targetPath));
  ipcMain.handle(CH.showItemInFolder, (_e, targetPath: string) => shell.showItemInFolder(targetPath));
  ipcMain.on(CH.copyText, (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle(CH.openExternal, async (_e, url: string) => {
    if (typeof url !== "string") return false;
    if (isSafeExternalUrl(url)) {
      await shell.openExternal(url);
      return true;
    }
    try {
      const targetPath = fileURLToPath(url);
      if (process.platform === "win32") {
        const explorer = spawn("explorer.exe", [targetPath], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        explorer.once("error", () => {});
        explorer.unref();
        return true;
      }
      return (await shell.openPath(targetPath)) === "";
    } catch {
      return false;
    }
  });
  ipcMain.on(CH.quitApp, () => {
    store.flush();
    app.quit();
  });
  ipcMain.on(CH.relaunchApp, () => {
    store.flush();
    ptys.killAll();
    bridgeListener?.close();
    transcripts?.dispose();
    if (!app.isPackaged) {
      app.relaunch({ args: process.argv.slice(1) });
    } else {
      app.relaunch();
    }
    lock.release(); // app.exit bypasses before-quit
    app.exit(0);
  });
}

async function ensureControlBridgeInstalled(): Promise<void> {
  try {
    const extDir = join(app.getPath("home"), ".omp", "agent", "extensions");
    const targetFile = join(extDir, "control-bridge.ts");
    const roots = [
      join(app.getAppPath(), "extensions"),
      join(__dirname, "../../extensions"),
      join(process.resourcesPath, "extensions"),
      join(process.resourcesPath, "app.asar.unpacked", "extensions"),
    ];
    const companion = join("lib", "usage-guard.ts");
    const root = roots.find((candidate) =>
      existsSync(join(candidate, "control-bridge.ts")) && existsSync(join(candidate, companion)),
    );
    if (!root) throw new Error("Incomplete control-bridge extension bundle");
    const [guard, bridge] = await Promise.all([
      readFile(join(root, companion), "utf-8"),
      readFile(join(root, "control-bridge.ts"), "utf-8"),
    ]);
    await mkdir(join(extDir, "lib"), { recursive: true });
    await writeFile(join(extDir, companion), guard, "utf-8");
    await writeFile(targetFile, bridge, "utf-8");
  } catch (err) {
    console.error("Failed to ensure control-bridge extension is installed:", err);
  }
}

const ptyHostMode = process.argv.includes(PTY_HOST_FLAG);
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const hasLock = ptyHostMode || isDev ? true : app.requestSingleInstanceLock();

if (ptyHostMode) {
  // The elevated copy of the app that hosts exactly one session; it never opens a window or touches app state.
  runPtyHost(process.argv);
} else if (!hasLock) {
  app.quit();
} else {
  if (!isDev) {
    app.on("second-instance", () => {
      const target =
        lastFocusedWindow && !lastFocusedWindow.isDestroyed()
          ? lastFocusedWindow
          : (primaryWindow ?? windows.values().next().value);
      if (!target || target.isDestroyed()) return;
      if (target.isMinimized()) target.restore();
      target.focus();
    });
  }

  void app.whenReady().then(async () => {
    void isProcessElevated(); // warm the cache so the first spawn does not wait on it
    await ensureControlBridgeInstalled();
    nativeTheme.themeSource = "dark";
    store = new StateStore(app.getPath("userData"), getDefaultCwd());
    lock = new SessionLock(app.getPath("userData"));
    if (lock.acquire()) store.markCrashed("unclean-exit");
    ptys = new PtyManager(
      send,
      () => store.ompPath,
      () => bridgeListener?.port ?? null,
      () => store.get().killOmpOnClose !== false,
    );
    bridgeListener = new ControlBridgeListener((channel, payload) => {
      broadcast(channel, payload);
    });
    transcripts = new TranscriptWatcher((snapshot) => broadcast(CH.transcriptUpdate, snapshot));
    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => app.quit());

  // Windows ignores kill signals for ConPTY children; abandoned sessions leak an
  // OpenConsole.exe each, so every session must be torn down explicitly.
  app.on("before-quit", () => {
    cancelPendingElevations();
    ptys.killAll();
    store.flush();
    lock.release();
    bridgeListener?.close();
    transcripts?.dispose();
  });

  app.on("will-quit", () => {
    rmSync(join(app.getPath("temp"), TEMP_SUBDIR), { recursive: true, force: true });
  });
}
