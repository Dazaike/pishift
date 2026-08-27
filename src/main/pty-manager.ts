import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { IPty } from "node-pty";
import { spawn as ptySpawn } from "node-pty";

import {
  CH,
  type PtyData,
  type PtyExit,
  type PtyStall,
  type PtyStallCleared,
  type SpawnRequest,
} from "../shared/ipc";
import { createIipState, injectIipSize, type IipState } from "../shared/iip-size";
import { resolveOmpPath } from "./omp-locate";
import { buildPtyEnv } from "./pty-env";

type Session = {
  pty: IPty;
  iip: IipState;
  cwd: string;
  exited: boolean;
  /** When the PTY was paused awaiting the renderer's ack; null while flowing. */
  pausedAt: number | null;
  /** Reported once per stall, so the renderer is not spammed each poll. */
  stallReported: boolean;
};

export type Emit = (
  channel: string,
  payload: PtyData | PtyExit | PtyStall | PtyStallCleared,
) => void;

const STALL_POLL_MS = 1000;
const DEFAULT_STALL_AFTER_MS = 5000;
/** Overridable so a verification run can force the banner deterministically. */
const STALL_AFTER_MS = (() => {
  const raw = Number(process.env.PISHIFT_STALL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALL_AFTER_MS;
})();

const FORCE_REAP_AFTER_MS = 2000;

/**
 * Owns every hosted omp process. Data flows PTY -> renderer with the xterm.js
 * flow-control handshake carried over IPC: pause on emit, resume on the
 * renderer's write callback, so a fast-streaming turn cannot outrun the parser.
 */
export class PtyManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly emit: Emit,
    private readonly ompPath: () => string | undefined,
  ) {}

  spawn(req: SpawnRequest): { id: string; pid: number } {
    const id = randomUUID();
    const exe = resolveOmpPath(this.ompPath());
    const cwd = existsSync(req.cwd) ? req.cwd : process.env.USERPROFILE || process.cwd();

    const child = ptySpawn(exe, req.resume ? ["--continue"] : [], {
      name: "xterm-256color",
      cols: Math.max(req.cols, 2),
      rows: Math.max(req.rows, 2),
      cwd,
      env: buildPtyEnv(process.env, id),
      useConpty: true,
    });

    const session: Session = {
      pty: child,
      iip: createIipState(),
      cwd,
      exited: false,
      pausedAt: null,
      stallReported: false,
    };
    this.sessions.set(id, session);

    child.onData((data) => {
      child.pause();
      session.pausedAt = Date.now();
      this.emit(CH.ptyData, { id, data: injectIipSize(session.iip, data) });
    });
    child.onExit(({ exitCode }) => {
      session.exited = true;
      this.sessions.delete(id);
      this.emit(CH.ptyExit, { id, exitCode });
    });

    this.ensureStallWatchdog();
    return { id, pid: child.pid };
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session || session.exited) return;
    try {
      session.pty.resize(Math.max(cols, 2), Math.max(rows, 2));
    } catch {
      // The child can exit between the renderer's measurement and this call.
    }
  }

  /** Renderer finished writing the previous chunk: let the PTY flow again. */
  ack(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.pausedAt = null;
    if (session.stallReported) {
      session.stallReported = false;
      this.emit(CH.ptyStallCleared, { id });
    }
    session.pty.resume();
  }

  /** Manual recovery from the stall banner. */
  resumeFlow(id: string): void {
    this.ack(id);
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    const pid = session.pty.pid;
    try {
      // A paused PTY leaves omp blocked writing into a full ConPTY pipe, and
      // tearing that down can block this (main) thread, freezing every window.
      // Draining first lets the child reach a killable state.
      session.pty.resume();
    } catch {
      // Already gone.
    }
    try {
      session.pty.kill();
    } catch {
      // Already gone.
    }
    this.scheduleForceReap(pid);
  }

  /**
   * ConPTY can leave the child (and an OpenConsole.exe) alive after kill().
   * Reap out of process so a wedged child never blocks the main thread.
   * Tracked pids only — never match by image name, since the user runs
   * unrelated omp sessions in other terminals.
   */
  private scheduleForceReap(pid: number): void {
    if (!pid) return;
    const timer = setTimeout(() => {
      try {
        process.kill(pid, 0);
      } catch {
        return; // Exited cleanly.
      }
      if (process.platform === "win32") {
        execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => {});
      } else {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Raced with normal exit.
        }
      }
    }, FORCE_REAP_AFTER_MS);
    timer.unref?.();
  }

  private stallTimer: NodeJS.Timeout | null = null;

  private ensureStallWatchdog(): void {
    if (this.stallTimer) return;
    this.stallTimer = setInterval(() => this.checkStalls(), STALL_POLL_MS);
    this.stallTimer.unref?.();
  }

  private checkStalls(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.exited || session.pausedAt === null || session.stallReported) continue;
      const pausedMs = now - session.pausedAt;
      if (pausedMs < STALL_AFTER_MS) continue;
      session.stallReported = true;
      this.emit(CH.ptyStalled, { id, pausedMs });
    }
    if (this.sessions.size === 0 && this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
  }
  /**
   * Kill every session. Required on quit: Windows ignores the signal argument and
   * an abandoned ConPTY leaks an `OpenConsole.exe` per session.
   */
  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}
