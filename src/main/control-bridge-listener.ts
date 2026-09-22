import * as dgram from "node:dgram";
import { existsSync, readFileSync, readdirSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CH, type ControlBridgeState } from "../shared/ipc";

/**
 * One file per `PISHIFT_SESSION_ID` instead of a single shared file: a single
 * `runtime-status.json` meant concurrent omp sessions (e.g. two PiShift
 * instances, or two tabs) clobbered each other's durable status with
 * last-writer-wins, so whichever tab's poll landed last silently stomped every
 * other session's state out of existence. `pty-manager.ts` deletes each
 * session's file on PTY exit.
 */
export const STATUS_DIR = join(homedir(), ".omp", "agent", "runtime-status");
const UDP_HOST = "127.0.0.1";
/** Poll as a backstop when UDP is dropped. */
const FILE_POLL_MS = 400;

/**
 * Dedupe key for a published status. Every field the renderer acts on must be
 * in here: an omp-side `/resume` changes nothing but `ompSessionId` (same pid,
 * same session id, still idle), so leaving it out swallowed the broadcast and
 * the chat view kept rendering the previous transcript until the next keystroke
 * moved `running`. Same for `cwd`, which only a `/move` changes.
 */
export function controlBridgeFingerprint(state: ControlBridgeState): string {
  return [
    state.sessionId ?? "",
    state.ompSessionId ?? "",
    state.cwd ?? "",
    state.pid ?? 0,
    state.updateKind,
    state.activity ?? "",
    state.running ? "1" : "0",
    state.model ?? "",
    state.thinkingLevel ?? "",
    state.planMode ?? "",
    state.ask?.toolCallId ?? "",
    state.todo ? JSON.stringify(state.todo) : "",
    state.jobs ? state.jobs.map((j) => `${j.id}:${j.status}`).join(",") : "",
    // Stream deltas leave all durable status unchanged, but must still reach
    // the renderer while a reply is being written.
    state.stream ? `thinking:${state.stream.thinking}\ntext:${state.stream.text}` : "",
    // Live tool calls change nothing durable either, but a started or finished
    // edit has to reach the chat view while it is still running.
    state.steps
      ? state.steps.map((s) => `${s.id}:${s.name}:${s.subject ?? ""}:${s.running ? 1 : 0}:${s.isError ? 1 : 0}`).join(",")
      : "",
    // Intentionally omit updatedAt — heartbeats must not spam identical activity.
  ].join("|");
}

export class ControlBridgeListener {
  private socket: dgram.Socket | null = null;
  private boundPort: number | null = null;
  private watcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Last state per session — multiple omp tabs must not clobber each other. */
  private readonly bySession = new Map<string, ControlBridgeState>();
  private readonly fingerprintBySession = new Map<string, string>();

  constructor(private readonly broadcast: (channel: string, payload: ControlBridgeState) => void) {
    this.ingestAll(true);
    this.startUdpListener();
    this.startFileWatch();
  }

  /** The ephemeral port this instance's UDP socket bound to, or `null` before
   * the async bind resolves (or if it never could). Threaded into spawned omp
   * processes via `PISHIFT_CONTROL_BRIDGE_PORT`. */
  get port(): number | null {
    return this.boundPort;
  }

  /** Every currently known session's last-published state — one per active omp
   * process, unlike the old single-file design which could only ever surface
   * whichever session wrote most recently. */
  get currentStates(): ControlBridgeState[] {
    this.ingestAll(false);
    return Array.from(this.bySession.values());
  }

  /** Reads and parses every per-session status file, skipping anything malformed
   * or mid-write rather than letting one bad file sink the rest. */
  readAllStatusFiles(): ControlBridgeState[] {
    const states: ControlBridgeState[] = [];
    try {
      if (!existsSync(STATUS_DIR)) return states;
      for (const name of readdirSync(STATUS_DIR)) {
        if (!name.endsWith(".json")) continue;
        try {
          const raw = readFileSync(join(STATUS_DIR, name), "utf8");
          const parsed = JSON.parse(raw) as ControlBridgeState;
          if (parsed && typeof parsed.running === "boolean") states.push(parsed);
        } catch {
          // Best effort reading
        }
      }
    } catch {
      // Best effort reading
    }
    return states;
  }

  close(): void {
    try {
      this.socket?.close();
      this.socket = null;
    } catch {
      // Ignore
    }
    try {
      this.watcher?.close();
      this.watcher = null;
    } catch {
      // Ignore
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private sessionKey(state: ControlBridgeState): string {
    const raw = state.sessionId?.trim();
    if (raw) {
      return raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
    }
    if (typeof state.pid === "number" && state.pid > 0) return `pid:${state.pid}`;
    const cwd = (state.cwd || "").replace(/[\\/]+$/, "").toLowerCase();
    return cwd ? `cwd:${cwd}` : "unknown";
  }

  private fingerprint(state: ControlBridgeState): string {
    return controlBridgeFingerprint(state);
  }

  private emitState(state: ControlBridgeState, force = false): void {
    const key = this.sessionKey(state);
    const fp = this.fingerprint(state);
    if (!force && this.fingerprintBySession.get(key) === fp) return;

    this.fingerprintBySession.set(key, fp);
    this.bySession.set(key, state);
    this.broadcast(CH.controlBridgeStatus, state);
  }

  private ingestAll(force = false): void {
    for (const state of this.readAllStatusFiles()) this.emitState(state, force);
  }

  private startFileWatch(): void {
    try {
      this.watcher = watch(STATUS_DIR, { persistent: false }, () => {
        this.ingestAll(false);
      });
      this.watcher.on("error", () => {
        // Directory may not exist yet; polling covers that.
      });
    } catch {
      // watch can fail if the directory is missing; polling still works once it appears.
    }

    this.pollTimer = setInterval(() => this.ingestAll(false), FILE_POLL_MS);
    if (typeof this.pollTimer === "object" && "unref" in this.pollTimer) {
      this.pollTimer.unref();
    }
  }

  /**
   * Binds an OS-assigned ephemeral port instead of the legacy fixed 37991: a
   * shared fixed port meant a second local PiShift instance (e.g. a dev build
   * running alongside the installed app) either failed to bind at all, or —
   * worse, with `reuseAddr` — silently stole the other instance's datagrams.
   * The bound port is threaded to each spawned omp process via
   * `PISHIFT_CONTROL_BRIDGE_PORT` (see `pty-env.ts`), so every instance gets
   * its own private channel and none of them ever contend for one port.
   */
  private startUdpListener(): void {
    try {
      const socket = dgram.createSocket({ type: "udp4" });

      socket.on("message", (msg) => {
        try {
          const raw = msg.toString("utf8");
          const state = JSON.parse(raw) as ControlBridgeState;
          if (state && typeof state.activity === "string") {
            this.emitState(state);
          }
        } catch {
          // Ignore malformed datagrams
        }
      });

      socket.on("error", (err) => {
        console.warn("[control-bridge-listener] UDP socket notice:", err.message);
        socket.close();
        if (this.socket === socket) this.socket = null;
      });

      socket.bind(0, UDP_HOST, () => {
        this.boundPort = socket.address().port;
        console.log(`[control-bridge-listener] Listening on ${UDP_HOST}:${this.boundPort}`);
      });

      this.socket = socket;
    } catch (err) {
      console.warn("[control-bridge-listener] Failed to bind UDP socket:", err);
    }
  }
}
