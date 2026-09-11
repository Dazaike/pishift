import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Emit, PtyManager } from "../src/main/pty-manager";
import { CH } from "../src/shared/ipc";

/** Deterministic watchdog window; read by pty-manager at module load. */
const STALL_MS = 1000;

/** Stands in for node-pty's IPty, recording the flow-control calls. */
class FakePty {
  readonly pid = 4242;
  paused = false;
  pauses = 0;
  resumes = 0;
  private dataListener: ((data: string) => void) | null = null;
  private exitListener: ((e: { exitCode: number }) => void) | null = null;

  onData(fn: (data: string) => void): void {
    this.dataListener = fn;
  }
  onExit(fn: (e: { exitCode: number }) => void): void {
    this.exitListener = fn;
  }
  write(): void {}
  resize(): void {}
  pause(): void {
    this.paused = true;
    this.pauses++;
  }
  resume(): void {
    this.paused = false;
    this.resumes++;
  }
  kill(): void {}

  /** Deliver a chunk the way ConPTY would. */
  emit(data: string): void {
    this.dataListener?.(data);
  }
  exit(code: number): void {
    this.exitListener?.({ exitCode: code });
  }
}

let pty: FakePty;

vi.mock("node-pty", () => ({ spawn: (): FakePty => pty }));
vi.mock("../src/main/omp-locate", () => ({ resolveOmpPath: (): string => "omp.exe" }));

type Emitted = { channel: string; payload: Record<string, unknown> };

type Harness = {
  id: string;
  emitted: Emitted[];
  manager: PtyManager;
  pauseBytes: number;
  resumeBytes: number;
  /** Chunks handed to the renderer, in order. */
  chunks(): string[];
  /** Ack everything emitted so far, the way the renderer does per chunk. */
  ackAll(): void;
};

async function spawnSession(): Promise<Harness> {
  process.env.PISHIFT_STALL_MS = String(STALL_MS);
  vi.resetModules();
  // Dynamic by necessity: the watchdog window is captured from the environment
  // at module load, so the module must be re-evaluated after the env is set.
  const mod = await import("../src/main/pty-manager");
  const emitted: Emitted[] = [];
  const emit: Emit = (channel, payload) =>
    emitted.push({ channel, payload: payload as unknown as Record<string, unknown> });
  const manager = new mod.PtyManager(emit, () => undefined);
  const { id } = manager.spawn({ cwd: process.cwd(), cols: 80, rows: 24 });
  let acked = 0;
  const chunks = (): string[] =>
    emitted.filter((e) => e.channel === CH.ptyData).map((e) => String(e.payload.data));
  return {
    id,
    emitted,
    manager,
    pauseBytes: mod.PAUSE_BYTES,
    resumeBytes: mod.RESUME_BYTES,
    chunks,
    ackAll: () => {
      const all = chunks();
      for (; acked < all.length; acked++) manager.ack(id, all[acked]!.length);
    },
  };
}

beforeEach(() => {
  pty = new FakePty();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PISHIFT_STALL_MS;
});

describe("PtyManager flow control", () => {
  it("forwards each ordinary output chunk immediately", async () => {
    const h = await spawnSession();

    pty.emit("before");
    pty.emit("\x1b]1337;File=inline=1:aGVsbG8=\x07");
    pty.emit("after");

    expect(h.chunks()).toEqual([
      "before",
      "\x1b]1337;File=inline=1:aGVsbG8=\x07",
      "after",
    ]);
    expect(pty.pauses).toBe(0);
  });

  it("pauses only once the unacked backlog crosses the watermark", async () => {
    const h = await spawnSession();

    pty.emit("x".repeat(h.pauseBytes - 1));
    expect(pty.paused).toBe(false);

    pty.emit("y");
    expect(pty.paused).toBe(true);
    expect(pty.pauses).toBe(1);
  });

  it("resumes once acks drain the backlog under the low watermark", async () => {
    const h = await spawnSession();

    pty.emit("x".repeat(h.pauseBytes));
    expect(pty.paused).toBe(true);

    // Partial drain: still far above the resume watermark.
    h.manager.ack(h.id, h.pauseBytes - h.resumeBytes - 1);
    expect(pty.paused).toBe(true);

    h.manager.ack(h.id, 1);
    expect(pty.paused).toBe(false);
    expect(pty.resumes).toBe(1);
  });


  it("resumes the child itself when the renderer never acks", async () => {
    const h = await spawnSession();

    pty.emit("x".repeat(h.pauseBytes));
    expect(pty.paused).toBe(true);

    vi.advanceTimersByTime(STALL_MS * 2);
    expect(h.emitted.some((e) => e.channel === CH.ptyStalled)).toBe(true);
    expect(pty.paused).toBe(false);

    // A second unacked backlog must recover too, without a duplicate banner.
    pty.emit("x".repeat(h.pauseBytes));
    expect(pty.paused).toBe(true);
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(pty.paused).toBe(false);
    expect(h.emitted.filter((e) => e.channel === CH.ptyStalled)).toHaveLength(1);
  });

  it("clears the stall report once a real ack lands", async () => {
    const h = await spawnSession();

    pty.emit("x".repeat(h.pauseBytes));
    vi.advanceTimersByTime(STALL_MS * 2);
    h.manager.ack(h.id, h.pauseBytes);

    expect(h.emitted.some((e) => e.channel === CH.ptyStallCleared)).toBe(true);
    expect(pty.paused).toBe(false);
  });

});
