import * as dgram from "node:dgram";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlBridgeState } from "../src/shared/ipc";

// `STATUS_DIR` is derived from `homedir()` at module load, so the real
// directory is swapped out before the module is ever imported — these tests
// must never read or write the developer's actual `~/.omp` directory.
const fakeHome = join(tmpdir(), `pishift-cb-test-${process.pid}-${Date.now()}`);

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome };
});

// Dynamic import is required, not stylistic: STATUS_DIR is computed from
// homedir() at module-evaluation time, so the module under test must load
// strictly after vi.mock("node:os") above takes effect — a static import
// would resolve before that mock is guaranteed to apply.
const { ControlBridgeListener, STATUS_DIR } = await import("../src/main/control-bridge-listener");

type ReaderOnly = { readAllStatusFiles(): ControlBridgeState[] };

/** Bypasses the constructor (which binds the production UDP port) — these
 * tests only exercise the pure directory-scan method. */
function reader(): ReaderOnly {
  return Object.create(ControlBridgeListener.prototype) as ReaderOnly;
}

function writeSessionFile(id: string, overrides: Partial<ControlBridgeState> = {}): void {
  mkdirSync(STATUS_DIR, { recursive: true });
  const state: ControlBridgeState = {
    updateKind: "session",
    running: true,
    activity: "idle",
    model: null,
    thinkingLevel: "off",
    ask: null,
    todo: null,
    pid: 1,
    cwd: null,
    sessionId: id,
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
  writeFileSync(join(STATUS_DIR, `${id}.json`), JSON.stringify(state), "utf8");
}

describe("ControlBridgeListener per-session status files", () => {
  beforeEach(() => {
    rmSync(STATUS_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("reads every session's own file, not just the most recently written one", () => {
    // This is the regression case: a single shared status file could only
    // ever surface whichever session wrote last, silently starving every
    // other concurrently running omp session of activity/streaming updates.
    writeSessionFile("session-a", { activity: "thinking", pid: 100 });
    writeSessionFile("session-b", { activity: "responding", pid: 200 });

    const states = reader().readAllStatusFiles();

    expect(states).toHaveLength(2);
    expect(states.map((s) => s.sessionId).sort()).toEqual(["session-a", "session-b"]);
  });

  it("skips a malformed session file without losing the others", () => {
    writeSessionFile("session-good", { activity: "reading" });
    mkdirSync(STATUS_DIR, { recursive: true });
    writeFileSync(join(STATUS_DIR, "session-bad.json"), "{ not json", "utf8");

    const states = reader().readAllStatusFiles();

    expect(states).toHaveLength(1);
    expect(states[0].sessionId).toBe("session-good");
  });

  it("returns an empty array when the status directory does not exist yet", () => {
    expect(reader().readAllStatusFiles()).toEqual([]);
  });
});

describe("ControlBridgeListener ephemeral UDP port", () => {
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("binds an OS-assigned port and broadcasts a datagram sent to it", async () => {
    // Binding port 0 (never a fixed shared port) is exactly what lets a real
    // instance be constructed safely inside a test: there is no longer a
    // single well-known port for two concurrent test runs to fight over.
    const broadcasts: ControlBridgeState[] = [];
    const listener = new ControlBridgeListener((_channel, state) => {
      broadcasts.push(state);
    });

    try {
      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const sender = dgram.createSocket("udp4");
      const state: ControlBridgeState = {
        updateKind: "session",
        running: true,
        activity: "responding",
        model: null,
        thinkingLevel: "off",
        ask: null,
        todo: null,
        pid: 999,
        cwd: null,
        sessionId: "ephemeral-port-test",
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
      try {
        await new Promise<void>((resolve, reject) => {
          sender.send(Buffer.from(JSON.stringify(state)), listener.port ?? 0, "127.0.0.1", (err) =>
            err ? reject(err) : resolve(),
          );
        });
        await vi.waitFor(
          () => expect(broadcasts.some((s) => s.sessionId === "ephemeral-port-test")).toBe(true),
          { timeout: 2000 },
        );
      } finally {
        sender.close();
      }
    } finally {
      listener.close();
    }
  });
});
