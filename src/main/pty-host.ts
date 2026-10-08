import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { homedir, tmpdir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { app } from "electron";
import { spawn as ptySpawn, type IPty } from "node-pty";

import { OMP_SESSION_ID } from "../shared/ipc";
import { isProcessElevated, system32 } from "./elevation";
import {
  PTY_HOST_PIPE_ARG,
  PTY_HOST_PIPE_ID,
  PTY_HOST_TOKEN,
  PTY_HOST_TOKEN_ARG,
  onMessages,
  ptyHostPipePath,
  sendMessage,
  type AppMessage,
} from "./pty-host-protocol";

/** Time between asking the process to die and checking that it did. */
const REAP_AFTER_MS = 1000;
/** Upper bound before this host exits regardless of how teardown went. */
const EXIT_AFTER_MS = 3000;

type SpawnMessage = Extract<AppMessage, { t: "spawn" }>;

const clampDim = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 2), 1000) : 80);

/** The app only ever launches omp, with no arguments or one `--resume=<id>`; nothing else is run elevated. */
function argsAllowed(args: unknown): boolean {
  if (!Array.isArray(args)) return false;
  if (args.length === 0) return true;
  if (args.length !== 1 || typeof args[0] !== "string") return false;
  const match = /^--resume=(.+)$/.exec(args[0]);
  return match !== null && OMP_SESSION_ID.test(match[1] ?? "");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && Object.values(value).every((v) => typeof v === "string");
}

/**
 * Entry point of the elevated copy of PiShift: no window, no state, one ConPTY. It dials the pipe
 * the normal app opened, proves it holds the launch secret, then relays a single omp session.
 */
export function runPtyHost(argv: readonly string[]): void {
  const pipeId = argv.find((arg) => arg.startsWith(PTY_HOST_PIPE_ARG))?.slice(PTY_HOST_PIPE_ARG.length);
  const token = argv.find((arg) => arg.startsWith(PTY_HOST_TOKEN_ARG))?.slice(PTY_HOST_TOKEN_ARG.length);
  if (!pipeId || !PTY_HOST_PIPE_ID.test(pipeId) || !token || !PTY_HOST_TOKEN.test(token)) {
    app.exit(2);
    return;
  }

  // Chromium writes profile files even with no window; keep them out of the user's real userData.
  const scratch = mkdtempSync(join(tmpdir(), "pishift-pty-host-"));
  app.setPath("userData", scratch);
  app.disableHardwareAcceleration();

  let pty: IPty | null = null;
  let spawnRequested = false;
  let tearingDown = false;
  let finished = false;

  const finish = (code: number): void => {
    if (finished) return;
    finished = true;
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // Chromium may still hold files; the directory is disposable.
    }
    app.exit(code);
  };

  /** ConPTY can leave the child and its OpenConsole.exe behind after kill(); only this elevated process may finish the job. */
  const reap = (pid: number): void => {
    setTimeout(() => {
      try {
        process.kill(pid, 0);
      } catch {
        return; // Already gone.
      }
      execFile(system32("taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    }, REAP_AFTER_MS);
  };

  const teardown = (): void => {
    if (tearingDown) return;
    tearingDown = true;
    const child = pty;
    pty = null;
    if (!child) {
      finish(0);
      return;
    }
    try {
      // A paused PTY blocks omp inside its own write; drain first so it can die.
      child.resume();
    } catch {
      // Already gone.
    }
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    reap(child.pid);
    setTimeout(() => finish(0), EXIT_AFTER_MS);
  };

  const socket = connect(ptyHostPipePath(pipeId));
  // If the app goes away for any reason the pipe closes, and an orphaned elevated shell must not outlive it.
  socket.on("error", teardown);
  socket.on("close", teardown);
  socket.on("connect", () => {
    void isProcessElevated().then((elevated) => {
      sendMessage(socket, { t: "hello", token, pid: process.pid, elevated, user: userInfo().username });
    });
  });

  const reject = (message: string): void => {
    sendMessage(socket, { t: "error", message });
    socket.end();
    setTimeout(() => finish(1), REAP_AFTER_MS);
  };

  const startPty = (msg: SpawnMessage): void => {
    if (spawnRequested) return;
    spawnRequested = true;
    if (typeof msg.exe !== "string" || !isAbsolute(msg.exe) || !existsSync(msg.exe)) {
      reject("The omp executable path was rejected by the administrator helper");
      return;
    }
    if (!argsAllowed(msg.args)) {
      reject("The omp arguments were rejected by the administrator helper");
      return;
    }
    if (!isStringRecord(msg.env)) {
      reject("The omp environment was rejected by the administrator helper");
      return;
    }
    try {
      const child = ptySpawn(msg.exe, msg.args, {
        name: "xterm-256color",
        cols: clampDim(msg.cols),
        rows: clampDim(msg.rows),
        cwd: typeof msg.cwd === "string" && existsSync(msg.cwd) ? msg.cwd : homedir(),
        env: msg.env,
        useConpty: true,
        useConptyDll: true,
      });
      pty = child;
      child.onData((d) => sendMessage(socket, { t: "data", d }));
      child.onExit(({ exitCode }) => {
        if (pty === child) pty = null;
        sendMessage(socket, { t: "exit", code: exitCode });
        socket.end();
        setTimeout(() => finish(0), REAP_AFTER_MS * 2);
      });
      sendMessage(socket, { t: "spawned", pid: child.pid });
    } catch (err) {
      reject(err instanceof Error ? err.message : String(err));
    }
  };

  onMessages<AppMessage>(socket, (msg) => {
    switch (msg.t) {
      case "spawn":
        startPty(msg);
        return;
      case "write":
        if (typeof msg.d === "string") pty?.write(msg.d);
        return;
      case "resize":
        try {
          pty?.resize(clampDim(msg.cols), clampDim(msg.rows));
        } catch {
          // The child can exit between the app's measurement and this call.
        }
        return;
      case "pause":
        try {
          pty?.pause();
        } catch {
          // Already gone.
        }
        return;
      case "resume":
        try {
          pty?.resume();
        } catch {
          // Already gone.
        }
        return;
      case "kill":
        teardown();
        return;
    }
  });
}
