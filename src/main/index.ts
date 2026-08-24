import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

import {
  CH,
  type ImagePreview,
  type PersistedState,
  type PtyData,
  type PtyExit,
  type SpawnRequest,
  type SpawnResult,
} from "../shared/ipc";
import { loadInstalledModels, queryOmpUsage } from "./omp-data";
import { PtyManager } from "./pty-manager";
import { StateStore } from "./state-store";
import { ControlBridgeListener } from "./control-bridge-listener";

const DEFAULT_CHROME_BG = "#191b24";
const DEFAULT_CHROME_FG = "#c8cbd9";
const TEMP_SUBDIR = "pishift";

let win: BrowserWindow | null = null;
let store: StateStore;
let ptys: PtyManager;
let bridgeListener: ControlBridgeListener | null = null;
function send(channel: string, payload: PtyData | PtyExit): void {
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

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
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
      const scale = Math.min(1, maxSize / Math.max(width, height));
      const scaled =
        scale < 1
          ? image.resize({
              width: Math.max(1, Math.round(width * scale)),
              height: Math.max(1, Math.round(height * scale)),
              quality: "good",
            })
          : image;
      return { dataUrl: scaled.toDataURL(), width, height };
    },
  );

  ipcMain.handle(CH.readClipboardText, () => clipboard.readText());
  ipcMain.handle(CH.loadState, (): PersistedState => store.get());
  ipcMain.on(CH.saveState, (_e, next: Partial<PersistedState>) => store.patch(next));
  ipcMain.handle(CH.homeDir, () => app.getPath("home"));
  ipcMain.handle(CH.getModels, () => loadInstalledModels());
  ipcMain.handle(CH.getProviderUsage, () => queryOmpUsage());
  ipcMain.handle(CH.readControlBridgeStatus, () => bridgeListener?.currentState ?? null);
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

  ipcMain.handle(CH.openPath, (_e, targetPath: string) => shell.openPath(targetPath));
  ipcMain.handle(CH.showItemInFolder, (_e, targetPath: string) => shell.showItemInFolder(targetPath));
  ipcMain.on(CH.copyText, (_e, text: string) => clipboard.writeText(text));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  void app.whenReady().then(() => {
    nativeTheme.themeSource = "dark";
    store = new StateStore(app.getPath("userData"), app.getPath("home"));
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
