import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
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
import { STATUS_DIR } from "./control-bridge-listener";
import { resolveOmpPath } from "./omp-locate";
import { buildPtyEnv } from "./pty-env";

type Session = {
  id: string;
  pty: IPty;
  cwd: string;
  exited: boolean;
  /** Bytes emitted to the renderer that have not been acked yet. */
  pending: number;
  /** Whether the child is paused because `pending` crossed the high watermark. */
  paused: boolean;
  /** When the backlog pause began; null while flowing. */
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
 * Backlog watermarks for the renderer handshake. Pausing after every chunk cost
 * one IPC round trip per write, so a renderer busy for a few frames left omp
 * blocked inside its own stdout write — event loop stopped, spinner frozen,
 * keystrokes ignored. Data now flows freely until the unacked backlog is
 * genuinely large, then pauses until the renderer has drained most of it.
 */
export const PAUSE_BYTES = 2_097_152;
export const RESUME_BYTES = 524_288;


/**
 * Owns every hosted omp process. Data flows PTY -> renderer with a watermarked
 * flow-control handshake carried over IPC: the child keeps streaming while the
 * renderer's unacked backlog stays under `PAUSE_BYTES`, and only then pauses
 * until acks bring it back under `RESUME_BYTES`, so a fast-streaming turn
 * cannot outrun the parser without throttling every ordinary chunk.
 */
export class PtyManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly emit: Emit,
    private readonly ompPath: () => string | undefined,
    private readonly controlBridgePort: () => number | null,
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
      env: buildPtyEnv(process.env, id, this.controlBridgePort()),
      useConpty: true,
      useConptyDll: process.platform === "win32",
    });

    const session: Session = {
      id,
      pty: child,
      cwd,
      exited: false,
      pending: 0,
      paused: false,
      pausedAt: null,
      stallReported: false,
    };
    this.sessions.set(id, session);

    child.onData((data) => this.emitChunk(session, data));
    child.onExit(({ exitCode }) => {
      session.exited = true;
      this.sessions.delete(id);
      // Best effort: leaves nothing behind for control-bridge-listener to ever
      // mistake for a still-running session.
      try {
        unlinkSync(join(STATUS_DIR, `${id}.json`));
      } catch {
        // No status file was ever written for this session — nothing to clean up.
      }
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

  /**
   * Renderer consumed `bytes` of a previously emitted chunk. Resume the child
   * once the backlog has drained back under the low watermark; a stall banner
   * clears with the first ack that gets there.
   */
  ack(id: string, bytes: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.pending = Math.max(0, session.pending - (Number.isFinite(bytes) ? bytes : 0));
    if (session.stallReported) {
      // The renderer is alive again, whatever the watchdog had to do meanwhile.
      session.stallReported = false;
      this.emit(CH.ptyStallCleared, { id });
    }
    if (session.paused && session.pending <= RESUME_BYTES) this.resume(session);
  }

  /**
   * Hand a chunk to the renderer, pausing the child only once its unacked
   * backlog crosses the high watermark.
   */
  private emitChunk(session: Session, data: string): void {
    session.pending += data.length;
    this.emit(CH.ptyData, { id: session.id, data });
    if (!session.paused && session.pending >= PAUSE_BYTES) {
      session.paused = true;
      session.pausedAt = Date.now();
      session.pty.pause();
    }
  }

  /** Let the child flow again. Banner state is owned by `ack`/`checkStalls`. */
  private resume(session: Session): void {
    session.paused = false;
    session.pausedAt = null;
    try {
      session.pty.resume();
    } catch {
      // The child can exit between the ack and this call.
    }
  }

  /** Manual recovery from the stall banner: drop the backlog and flow again. */
  resumeFlow(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.pending = 0;
    this.resume(session);
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

  /**
   * A paused child is blocked writing into a full ConPTY buffer, which also
   * stops it reading input — so a lost or late ack freezes the whole session,
   * typing included. Report it once, then resume regardless: xterm.js still
   * protects itself (it discards past its 50 MB watermark and throws, which the
   * renderer answers with an ack), so unmetered flow is strictly better than a
   * dead session waiting on a click.
   */
  private checkStalls(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.exited || !session.paused || session.pausedAt === null) continue;
      const pausedMs = now - session.pausedAt;
      if (pausedMs < STALL_AFTER_MS) continue;
      // The banner is announced once per episode; the recovery below runs on
      // every stall, so a renderer that never acks still gets served.
      if (!session.stallReported) {
        session.stallReported = true;
        this.emit(CH.ptyStalled, { id, pausedMs });
      }
      // The backlog is written off: acks for it may never arrive, and keeping
      // the count would re-pause on the very next chunk.
      session.pending = 0;
      this.resume(session);
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
