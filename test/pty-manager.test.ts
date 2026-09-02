import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Emit, PtyManager } from "../src/main/pty-manager";
import { CH } from "../src/shared/ipc";

/** Deterministic watchdog window; read by pty-manager at module load. */
const STALL_MS = 1000;
const BEL = "\x07";
const MARKER = "\x1b]1337;File=";

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
  /** Chunks handed to the renderer, in order. */
  chunks(): string[];
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
  return {
    id,
    emitted,
    manager,
    chunks: () =>
      emitted.filter((e) => e.channel === CH.ptyData).map((e) => String(e.payload.data)),
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
  it("streams a chunked image without an IPC round trip per chunk", async () => {
    const h = await spawnSession();

    pty.emit("before");
    expect(pty.pauses).toBe(1);
    pty.emit(`${MARKER}inline=1:aGVs`);
    pty.emit("bG8=");
    // Still one pause: the partial sequence buffers instead of pinging the renderer.
    expect(pty.pauses).toBe(1);
    pty.emit(BEL);

    expect(h.chunks()).toEqual(["before", `${MARKER}size=5;inline=1:aGVsbG8=${BEL}`]);
  });

  it("releases a sequence that never terminates instead of swallowing output", async () => {
    const h = await spawnSession();

    // A marker with no terminator: every later byte would queue behind it.
    pty.emit(`${MARKER}inline=1:aGVs`);
    expect(h.chunks()).toEqual([]);

    vi.advanceTimersByTime(600);
    expect(h.chunks()).toEqual([`${MARKER}inline=1:aGVs`]);

    h.manager.ack(h.id);
    pty.emit("after");
    expect(h.chunks()).toEqual([`${MARKER}inline=1:aGVs`, "after"]);
  });

  it("releases a withheld partial marker sooner than a buffered sequence", async () => {
    const h = await spawnSession();

    // A trailing ESC is a marker prefix, so it is withheld — but it is nearly
    // always an ordinary escape sequence split on a chunk boundary, so it is
    // released on the short deadline once the ack lets the child flow again.
    pty.emit("tail\x1b");
    expect(h.chunks()).toEqual(["tail"]);
    h.manager.ack(h.id);

    vi.advanceTimersByTime(100);
    expect(h.chunks()).toEqual(["tail", "\x1b"]);

    // A buffered sequence with a header is a real image mid-stream, so it gets
    // the long deadline rather than the short one.
    h.manager.ack(h.id);
    pty.emit(`${MARKER}inline=1:aGVs`);
    vi.advanceTimersByTime(100);
    expect(h.chunks()).toEqual(["tail", "\x1b"]);
    vi.advanceTimersByTime(500);
    expect(h.chunks()).toEqual(["tail", "\x1b", `${MARKER}inline=1:aGVs`]);
  });

  it("does not flush withheld bytes while the child is paused awaiting an ack", async () => {
    const h = await spawnSession();

    // Text plus the head of an image in one chunk: the text is emitted (pausing
    // the child) and the sequence stays buffered until the ack lets it flow.
    pty.emit(`text${MARKER}inline=1:aGVs`);
    expect(h.chunks()).toEqual(["text"]);
    expect(pty.paused).toBe(true);

    vi.advanceTimersByTime(600);
    expect(h.chunks()).toEqual(["text"]);
  });

  it("resumes the child itself when the renderer never acks", async () => {
    const h = await spawnSession();

    pty.emit("chunk");
    expect(pty.paused).toBe(true);

    vi.advanceTimersByTime(STALL_MS * 2);
    expect(h.emitted.some((e) => e.channel === CH.ptyStalled)).toBe(true);
    expect(pty.paused).toBe(false);

    // A second unacked chunk must recover too, without a duplicate banner.
    pty.emit("more");
    expect(pty.paused).toBe(true);
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(pty.paused).toBe(false);
    expect(h.emitted.filter((e) => e.channel === CH.ptyStalled)).toHaveLength(1);
  });

  it("clears the stall report once a real ack lands", async () => {
    const h = await spawnSession();

    pty.emit("chunk");
    vi.advanceTimersByTime(STALL_MS * 2);
    h.manager.ack(h.id);

    expect(h.emitted.some((e) => e.channel === CH.ptyStallCleared)).toBe(true);
    expect(pty.paused).toBe(false);
  });

  it("stops the flush deadline when the child exits", async () => {
    const h = await spawnSession();

    pty.emit(`${MARKER}inline=1:aGVs`);
    pty.exit(0);
    vi.advanceTimersByTime(2000);

    expect(h.chunks()).toEqual([]);
    expect(h.emitted.some((e) => e.channel === CH.ptyExit)).toBe(true);
  });

  it("reassembles a realistic image stream across arbitrary chunk boundaries", async () => {
    const h = await spawnSession();

    // 300 KB of base64 split the way ConPTY splits: many chunks, boundaries
    // landing inside the marker, the header, and the payload.
    const payload = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAh".repeat(7000);
    const sequence = `${MARKER}inline=1;width=40;height=auto:${payload}${BEL}`;
    const stream = `before\r\n${sequence}after\r\n`;

    let cursor = 0;
    let seed = 12345;
    while (cursor < stream.length) {
      // Deterministic pseudo-random sizes, including boundaries of 1 byte.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const size = 1 + (seed % 4096);
      pty.emit(stream.slice(cursor, cursor + size));
      cursor += size;
      h.manager.ack(h.id);
    }
    vi.advanceTimersByTime(1000);

    const expectedSize = Math.floor((payload.length * 3) / 4);
    expect(h.chunks().join("")).toBe(
      `before\r\n${MARKER}size=${expectedSize};inline=1;width=40;height=auto:${payload}${BEL}after\r\n`,
    );
    expect(h.emitted.some((e) => e.channel === CH.ptyStalled)).toBe(false);
  });
});
