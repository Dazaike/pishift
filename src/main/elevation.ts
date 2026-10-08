import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { userInfo } from "node:os";
import { join } from "node:path";
import { app } from "electron";

import {
  PTY_HOST_FLAG,
  PTY_HOST_PIPE_ARG,
  PTY_HOST_TOKEN_ARG,
  onMessages,
  ptyHostPipePath,
  sendMessage,
  type HostMessage,
} from "./pty-host-protocol";
import type { PtyHandle } from "./pty-handle";

/** Absolute so a PATH entry named `whoami`/`powershell`/`taskkill` can never run in a privileged path. */
export const system32 = (...parts: string[]): string =>
  join(process.env.SystemRoot ?? "C:\\Windows", "System32", ...parts);

/** The user has to read the prompt, find the details and click: allow a couple of minutes. */
const PROMPT_TIMEOUT_MS = 150_000;
/** Once UAC was approved, the helper only has to boot Electron and open the pipe. */
const CONNECT_AFTER_APPROVAL_MS = 20_000;
/** PowerShell exit code for "the user declined the UAC prompt". */
const EXIT_CANCELLED = 3;
/** Win32 ERROR_CANCELLED, raised by ShellExecute when the consent dialog is declined. */
const ERROR_CANCELLED = 1223;

export class ElevationCancelledError extends Error {
  constructor() {
    super("Administrator elevation was cancelled");
    this.name = "ElevationCancelledError";
  }
}

let elevatedProbe: Promise<boolean> | null = null;

/**
 * Whether this process holds a High (or System) integrity token. Read from the token's mandatory
 * label rather than inferred from the account, since an administrator's normal token is Medium.
 */
export function isProcessElevated(): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(process.getuid?.() === 0);
  if (elevatedProbe) return elevatedProbe;
  const { promise, resolve } = Promise.withResolvers<boolean>();
  execFile(system32("whoami.exe"), ["/groups"], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
    resolve(!err && /S-1-16-(12288|16384)\b/.test(stdout));
  });
  elevatedProbe = promise;
  return promise;
}

/** What the elevated host should run; `args` are validated again on the other side. */
export type ElevatedSpawn = {
  exe: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
};

/** Pipe-backed stand-in for node-pty's IPty. */
class RemotePty implements PtyHandle {
  readonly elevated = true;
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number }) => void> = [];
  /** Output that arrived before `PtyManager` attached its listener (the first screen). */
  private backlog: string[] | null = [];
  private exitCode: number | null = null;

  constructor(
    private readonly socket: Socket,
    readonly pid: number,
  ) {
    socket.on("close", () => this.finish(-1));
  }

  handle(msg: HostMessage): void {
    if (msg.t === "data" && typeof msg.d === "string") {
      if (this.backlog) this.backlog.push(msg.d);
      else for (const listener of this.dataListeners) listener(msg.d);
    } else if (msg.t === "exit") {
      this.finish(typeof msg.code === "number" ? msg.code : -1);
    }
  }

  private finish(exitCode: number): void {
    if (this.exitCode !== null) return;
    this.exitCode = exitCode;
    for (const listener of this.exitListeners) listener({ exitCode });
    this.socket.destroy();
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
    if (this.backlog) {
      const pending = this.backlog;
      this.backlog = null;
      for (const data of pending) listener(data);
    }
  }

  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exitListeners.push(listener);
    if (this.exitCode !== null) listener({ exitCode: this.exitCode });
  }

  write(data: string): void {
    sendMessage(this.socket, { t: "write", d: data });
  }

  resize(cols: number, rows: number): void {
    sendMessage(this.socket, { t: "resize", cols, rows });
  }

  pause(): void {
    sendMessage(this.socket, { t: "pause" });
  }

  resume(): void {
    sendMessage(this.socket, { t: "resume" });
  }

  kill(): void {
    sendMessage(this.socket, { t: "kill" });
    // The host reaps the process tree itself (it alone can); this only bounds a host that is wedged.
    setTimeout(() => this.socket.destroy(), 5000).unref();
  }
}

export type HelperListener = {
  pipeId: string;
  token: string;
  /** Settles once the host connected, authenticated and spawned the process. */
  handle: Promise<PtyHandle>;
  fail(err: Error): void;
  /** Re-arm the deadline, e.g. once the user approved UAC and only the host's boot remains. */
  setDeadline(ms: number, message: string): void;
};

const listeners = new Set<(err: Error) => void>();

/**
 * Open the pipe the elevated host will dial. The *app* is the server on purpose: an elevated
 * process can write down to a Medium pipe, but a Medium process cannot open a High one. Only the
 * first connection that presents the secret is adopted, after which the listener closes.
 */
export function listenForHelper(spec: ElevatedSpawn, requireElevated = true): HelperListener {
  const pipeId = randomBytes(16).toString("hex");
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(token);
  const { promise, resolve, reject } = Promise.withResolvers<PtyHandle>();
  const server = createServer();
  let helper: Socket | null = null;
  let remote: RemotePty | null = null;
  let settled = false;
  let timer: NodeJS.Timeout | undefined;

  const fail = (err: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    listeners.delete(fail);
    server.close();
    helper?.destroy();
    reject(err);
  };
  const setDeadline = (ms: number, message: string): void => {
    clearTimeout(timer);
    timer = setTimeout(() => fail(new Error(message)), ms);
  };
  listeners.add(fail);
  setDeadline(PROMPT_TIMEOUT_MS, "Timed out waiting for the administrator prompt");

  const tokenMatches = (candidate: unknown): boolean => {
    if (typeof candidate !== "string") return false;
    const got = Buffer.from(candidate);
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  server.on("error", (err) => fail(err));
  server.on("connection", (conn) => {
    conn.on("error", () => {});
    conn.on("close", () => {
      if (conn === helper && !remote) fail(new Error("The administrator helper disconnected before the session started"));
    });
    if (helper) {
      conn.destroy();
      return;
    }
    onMessages<HostMessage>(conn, (msg) => {
      if (remote) {
        remote.handle(msg);
        return;
      }
      if (conn !== helper) {
        // Anything but a correct hello from an unclaimed connection is a probe; drop it and keep listening.
        if (helper || msg.t !== "hello" || !tokenMatches(msg.token)) {
          conn.destroy();
          return;
        }
        helper = conn;
        server.close();
        if (requireElevated && msg.elevated !== true) {
          fail(new Error("The helper did not start with administrator rights"));
          return;
        }
        if (String(msg.user).toLowerCase() !== userInfo().username.toLowerCase()) {
          fail(
            new Error(
              `Windows elevated the session as a different account (${String(msg.user)}). Per-tab elevation only works for the account you are signed in with.`,
            ),
          );
          return;
        }
        sendMessage(conn, { t: "spawn", ...spec });
        return;
      }
      if (msg.t === "spawned" && typeof msg.pid === "number") {
        remote = new RemotePty(conn, msg.pid);
        settled = true;
        clearTimeout(timer);
        listeners.delete(fail);
        resolve(remote);
      } else if (msg.t === "error") {
        fail(new Error(typeof msg.message === "string" ? msg.message : "The administrator helper failed"));
      }
    });
  });
  server.listen(ptyHostPipePath(pipeId));

  return { pipeId, token, handle: promise, fail, setDeadline };
}

/** Runs in a throwaway PowerShell: ShellExecute's `runas` verb is the supported way to raise UAC. */
export const LAUNCH_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Start-Process -FilePath $env:PISHIFT_ELEV_EXE -ArgumentList $env:PISHIFT_ELEV_ARGS -Verb RunAs -WindowStyle Hidden
} catch {
  $e = $_.Exception
  while ($e -and -not ($e -is [System.ComponentModel.Win32Exception])) { $e = $e.InnerException }
  if ($e -and $e.NativeErrorCode -eq ${ERROR_CANCELLED}) { exit ${EXIT_CANCELLED} }
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 4
}
`;

/** Show the UAC prompt and start the elevated host. Resolves once the user approved. */
export function startElevatedHelper(exe: string, args: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const ps = execFile(
    system32("WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", LAUNCH_SCRIPT],
    {
      windowsHide: true,
      env: { ...process.env, PISHIFT_ELEV_EXE: exe, PISHIFT_ELEV_ARGS: args },
    },
    (err, _stdout, stderr) => {
      if (!err) {
        resolve();
      } else if (err.code === EXIT_CANCELLED) {
        reject(new ElevationCancelledError());
      } else {
        reject(new Error(`Could not start the administrator helper: ${stderr.trim() || err.message}`));
      }
    },
  );
  ps.stdin?.end();
  return promise;
}

/**
 * Start `spec` in an elevated ConPTY. One UAC prompt per call: a standing elevated broker would be
 * reachable by any process of this account, so every elevated tab asks for itself.
 */
export async function launchElevatedPty(spec: ElevatedSpawn): Promise<PtyHandle> {
  if (process.platform !== "win32") throw new Error("Per-tab elevation is only available on Windows");
  const helper = listenForHelper(spec);
  const hostArgs = [
    // Packaged builds are the app; a dev run is `electron <app dir>`.
    ...(app.isPackaged ? [] : [`"${app.getAppPath()}"`]),
    PTY_HOST_FLAG,
    `${PTY_HOST_PIPE_ARG}${helper.pipeId}`,
    `${PTY_HOST_TOKEN_ARG}${helper.token}`,
  ].join(" ");
  startElevatedHelper(process.execPath, hostArgs).then(
    () => helper.setDeadline(CONNECT_AFTER_APPROVAL_MS, "The administrator helper did not start in time"),
    (err: Error) => helper.fail(err),
  );
  return helper.handle;
}

/** Quit path: stop waiting on any UAC prompt that is still open. */
export function cancelPendingElevations(): void {
  for (const fail of [...listeners]) fail(new ElevationCancelledError());
}
