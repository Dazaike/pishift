import { describe, expect, it } from "vitest";
import { ControlBridgeListener } from "../src/main/control-bridge-listener";
import { CH, type ControlBridgeState } from "../src/shared/ipc";

type ListenerInternals = {
  bySession: Map<string, ControlBridgeState>;
  fingerprintBySession: Map<string, string>;
  lastState: ControlBridgeState | null;
  broadcast: (channel: string, payload: ControlBridgeState) => void;
  emitState(state: ControlBridgeState, force?: boolean): void;
};

const base: ControlBridgeState = {
  updateKind: "session",
  running: true,
  activity: "responding",
  model: "openai-codex/gpt-5.6-terra",
  thinkingLevel: "high",
  ask: null,
  todo: null,
  pid: 42,
  cwd: "C:\\repo",
  sessionId: "stream-test",
  updatedAt: "2026-09-01T20:00:00.000Z",
};

describe("ControlBridgeListener stream dispatch", () => {
  it("broadcasts changing stream text even when durable status is unchanged", () => {
    const broadcasts: ControlBridgeState[] = [];
    // Avoid the constructor: this test exercises the emission contract without
    // binding the application's production UDP port.
    const listener = Object.create(ControlBridgeListener.prototype) as ListenerInternals;
    listener.bySession = new Map();
    listener.fingerprintBySession = new Map();
    listener.lastState = null;
    listener.broadcast = (channel, state) => {
      expect(channel).toBe(CH.controlBridgeStatus);
      broadcasts.push(state);
    };

    listener.emitState(base);
    listener.emitState({ ...base });
    listener.emitState({ ...base, stream: { kind: "text", text: "partial reply" } });

    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[1].stream).toEqual({ kind: "text", text: "partial reply" });
  });

  it("broadcasts an omp-side resume, which changes only the omp session id", () => {
    const broadcasts: ControlBridgeState[] = [];
    const listener = Object.create(ControlBridgeListener.prototype) as ListenerInternals;
    listener.bySession = new Map();
    listener.fingerprintBySession = new Map();
    listener.lastState = null;
    listener.broadcast = (_channel, state) => {
      broadcasts.push(state);
    };

    // Idle, same pid, same PISHIFT_SESSION_ID: `/resume` moves nothing else.
    const idle: ControlBridgeState = { ...base, running: false, activity: "idle", ompSessionId: "omp-old" };
    listener.emitState(idle);
    listener.emitState({ ...idle });
    listener.emitState({ ...idle, ompSessionId: "omp-new" });
    listener.emitState({ ...idle, ompSessionId: "omp-new", cwd: "C:\\other" });

    expect(broadcasts.map((state) => state.ompSessionId)).toEqual(["omp-old", "omp-new", "omp-new"]);
    expect(broadcasts[2].cwd).toBe("C:\\other");
  });
});
