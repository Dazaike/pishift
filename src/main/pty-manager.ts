import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { IPty } from "node-pty";
import { spawn as ptySpawn } from "node-pty";

import { CH, type PtyData, type PtyExit, type SpawnRequest } from "../shared/ipc";
import { createIipState, injectIipSize, type IipState } from "../shared/iip-size";
import { resolveOmpPath } from "./omp-locate";
import { buildPtyEnv } from "./pty-env";

type Session = {
  pty: IPty;
  iip: IipState;
  cwd: string;
  exited: boolean;
};

export type Emit = (channel: string, payload: PtyData | PtyExit) => void;

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

    const session: Session = { pty: child, iip: createIipState(), cwd, exited: false };
    this.sessions.set(id, session);

    child.onData((data) => {
      child.pause();
      this.emit(CH.ptyData, { id, data: injectIipSize(session.iip, data) });
    });

    child.onExit(({ exitCode }) => {
      session.exited = true;
      this.sessions.delete(id);
      this.emit(CH.ptyExit, { id, exitCode });
    });

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
    this.sessions.get(id)?.pty.resume();
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    try {
      session.pty.kill();
    } catch {
      // Already gone.
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
