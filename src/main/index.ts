import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  type ImagePreview,
  type KillJobRequest,
  type PersistedState,
  type PtyData,
  type PtyExit,
  type PtyStall,
  type PtyStallCleared,
  type SpawnRequest,
  type SpawnResult,
} from "../shared/ipc";
import { isSafeExternalUrl } from "../shared/url";
import { loadInstalledModels, loadRecentChats, loadRecentFolders, loadSessionMessages, queryOmpUsage } from "./omp-data";
import { loadSkillCommands } from "./omp-skills";
import { loadJobActivity } from "./job-activity";
import { PtyManager } from "./pty-manager";
import { StateStore } from "./state-store";
import { ControlBridgeListener } from "./control-bridge-listener";

const DEFAULT_CHROME_BG = "#191b24";
const DEFAULT_CHROME_FG = "#c8cbd9";
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
let win: BrowserWindow | null = null;
let store: StateStore;
let ptys: PtyManager;
let bridgeListener: ControlBridgeListener | null = null;
function send(
  channel: string,
  payload: PtyData | PtyExit | PtyStall | PtyStallCleared,
): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow(): BrowserWindow {
  const { bounds } = store.get();
  const window = new BrowserWindow({
    title: "PiShift",
    width: bounds?.width ?? 1180,
    height: bounds?.height ?? 760,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 620,
    minHeight: 380,
    show: false,
    icon: join(__dirname, "../../src/renderer/assets/icons/icon.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: DEFAULT_CHROME_BG,
      symbolColor: DEFAULT_CHROME_FG,
      height: 38,
    },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  const persistBounds = (): void => {
    if (!window.isDestroyed() && !window.isMinimized() && !window.isFullScreen()) {
      store.patch({ bounds: window.getNormalBounds() });
    }
  };
  window.on("resized", persistBounds);
  window.on("moved", persistBounds);
  window.on("close", () => {
    persistBounds();
    store.flush();
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

  return window;
}

function registerIpc(): void {
  ipcMain.handle(CH.ptySpawn, (_e, req: SpawnRequest): SpawnResult => {
    try {
      return ptys.spawn(req);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.on(CH.ptyWrite, (_e, id: string, data: string) => ptys.write(id, data));
  ipcMain.on(CH.ptyResize, (_e, id: string, cols: number, rows: number) =>
    ptys.resize(id, cols, rows),
  );
  ipcMain.on(CH.ptyAck, (_e, id: string) => ptys.ack(id));
  ipcMain.on(CH.ptyResumeFlow, (_e, id: string) => ptys.resumeFlow(id));
  ipcMain.on(CH.ptyKill, (_e, id: string) => ptys.kill(id));

  ipcMain.handle(CH.pickDirectory, async (): Promise<string | null> => {
    const options = {
      properties: ["openDirectory" as const, "createDirectory" as const],
      title: "Choose a workspace folder",
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? (null) : (result.filePaths[0] ?? null);
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
    (_e, path: string, maxSize: number): ImagePreview | null => {
      const image = nativeImage.createFromPath(path);
      if (image.isEmpty()) return null;
      const { width, height } = image.getSize();
      const scale = maxSize / Math.max(width, height);
      const scaled = image.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: "good",
      });
      return { dataUrl: scaled.toDataURL(), width, height };
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
  ipcMain.on(CH.saveState, (_e, next: Partial<PersistedState>) => store.patch(next));
  ipcMain.handle(CH.homeDir, () => app.getPath("home"));
  ipcMain.handle(CH.defaultCwd, () => getDefaultCwd());
  ipcMain.handle(CH.getModels, () => loadInstalledModels());
  ipcMain.handle(CH.getProviderUsage, () => queryOmpUsage());
  ipcMain.handle(CH.readControlBridgeStatus, () => bridgeListener?.currentState ?? null);
  ipcMain.handle(CH.getRecentFolders, () => loadRecentFolders(store.recentFolders));
  ipcMain.handle(CH.addRecentFolder, (_e, folder: string) => store.addRecentFolder(folder));
  ipcMain.handle(CH.removeRecentFolder, (_e, folder: string) => store.removeRecentFolder(folder));
  ipcMain.on(CH.clearRecentFolders, () => store.clearRecentFolders());
  ipcMain.handle(CH.getRecentChats, (_e, cwd?: string) => loadRecentChats(cwd));
  ipcMain.handle(CH.getSessionMessages, (_e, sessionId: string) => loadSessionMessages(sessionId));
  ipcMain.handle(CH.getSkillCommands, (_e, cwd?: string) => loadSkillCommands(cwd));
  ipcMain.handle(CH.getJobActivity, (_e, req) => loadJobActivity(req));
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
    (_e, colors: { background: string; symbol: string }) => {
      if (!win || win.isDestroyed()) return;
      const background = colors?.background || DEFAULT_CHROME_BG;
      const symbol = colors?.symbol || DEFAULT_CHROME_FG;
      try {
        win.setTitleBarOverlay({ color: background, symbolColor: symbol, height: 38 });
        win.setBackgroundColor(background);
      } catch {
        // setTitleBarOverlay unavailable on some hosts
      }
    },
  );

  ipcMain.on(CH.setTaskbarBusy, (_e, busy: boolean) => {
    if (!win || win.isDestroyed()) return;
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
    if (typeof url === "string" && isSafeExternalUrl(url)) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });
  ipcMain.on(CH.quitApp, () => {
    store.flush();
    app.quit();
  });
  ipcMain.on(CH.relaunchApp, () => {
    store.flush();
    ptys.killAll();
    bridgeListener?.close();
    if (!app.isPackaged) {
      app.relaunch({ args: process.argv.slice(1) });
    } else {
      app.relaunch();
    }
    app.exit(0);
  });
}

async function ensureControlBridgeInstalled(): Promise<void> {
  try {
    const extDir = join(app.getPath("home"), ".omp", "agent", "extensions");
    const targetFile = join(extDir, "control-bridge.ts");
    const candidates = [
      join(app.getAppPath(), "extensions", "control-bridge.ts"),
      join(__dirname, "../../extensions/control-bridge.ts"),
      join(process.resourcesPath, "extensions", "control-bridge.ts"),
      join(process.resourcesPath, "app.asar.unpacked", "extensions", "control-bridge.ts"),
    ];
    let sourcePath: string | null = null;
    for (const c of candidates) {
      try {
        if (existsSync(c)) {
          sourcePath = c;
          break;
        }
      } catch {}
    }
    if (sourcePath) {
      await mkdir(extDir, { recursive: true });
      const content = await readFile(sourcePath, "utf-8");
      await writeFile(targetFile, content, "utf-8");
    }
  } catch (err) {
    console.error("Failed to ensure control-bridge extension is installed:", err);
  }
}

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const hasLock = isDev ? true : app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  if (!isDev) {
    app.on("second-instance", () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    });
  }

  void app.whenReady().then(async () => {
    await ensureControlBridgeInstalled();
    nativeTheme.themeSource = "dark";
    store = new StateStore(app.getPath("userData"), getDefaultCwd());
    ptys = new PtyManager(send, () => store.ompPath);
    bridgeListener = new ControlBridgeListener((channel, payload) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    });
    registerIpc();
    win = createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) win = createWindow();
    });
  });

  app.on("window-all-closed", () => app.quit());

  // Windows ignores kill signals for ConPTY children; abandoned sessions leak an
  // OpenConsole.exe each, so every session must be torn down explicitly.
  app.on("before-quit", () => {
    ptys.killAll();
    store.flush();
    bridgeListener?.close();
  });

  app.on("will-quit", () => {
    rmSync(join(app.getPath("temp"), TEMP_SUBDIR), { recursive: true, force: true });
  });
}
