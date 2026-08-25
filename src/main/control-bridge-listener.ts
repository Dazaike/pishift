import * as dgram from "node:dgram";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CH, type ControlBridgeState } from "../shared/ipc";

const STATUS_FILE = join(homedir(), ".omp", "agent", "runtime-status.json");
const UDP_HOST = "127.0.0.1";
const UDP_PORT = 37991;
/** Poll as a backstop when UDP is dropped. */
const FILE_POLL_MS = 400;

export class ControlBridgeListener {
  private socket: dgram.Socket | null = null;
  private watcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Last state per session — multiple omp tabs must not clobber each other. */
  private readonly bySession = new Map<string, ControlBridgeState>();
  private readonly fingerprintBySession = new Map<string, string>();
  private lastState: ControlBridgeState | null = null;

  constructor(private readonly broadcast: (channel: string, payload: ControlBridgeState) => void) {
    this.ingestFile(true);
    this.startUdpListener();
    this.startFileWatch();
  }

  get currentState(): ControlBridgeState | null {
    return this.lastState ?? this.readStatusFile();
  }

  readStatusFile(): ControlBridgeState | null {
    try {
      if (!existsSync(STATUS_FILE)) return null;
      const raw = readFileSync(STATUS_FILE, "utf8");
      const parsed = JSON.parse(raw) as ControlBridgeState;
      if (parsed && typeof parsed.running === "boolean") {
        return parsed;
      }
    } catch {
      // Best effort reading
    }
    return null;
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
    return [
      state.sessionId ?? "",
      state.pid ?? 0,
      state.activity ?? "",
      state.running ? "1" : "0",
      state.model ?? "",
      state.thinkingLevel ?? "",
      state.planMode ?? "",
      state.ask?.toolCallId ?? "",
      state.todo ? JSON.stringify(state.todo) : "",
      // Intentionally omit updatedAt — heartbeats must not spam identical activity.
    ].join("|");
  }

  private emitState(state: ControlBridgeState, force = false): void {
    const key = this.sessionKey(state);
    const fp = this.fingerprint(state);
    if (!force && this.fingerprintBySession.get(key) === fp) return;

    this.fingerprintBySession.set(key, fp);
    this.bySession.set(key, state);
    this.lastState = state;
    this.broadcast(CH.controlBridgeStatus, state);
  }

  private ingestFile(force = false): void {
    const state = this.readStatusFile();
    if (state) this.emitState(state, force);
  }

  private startFileWatch(): void {
    try {
      this.watcher = watch(STATUS_FILE, { persistent: false }, () => {
        this.ingestFile(false);
      });
      this.watcher.on("error", () => {
        // File may not exist yet; polling covers that.
      });
    } catch {
      // watch can fail if the file is missing; polling still works once it appears.
    }

    this.pollTimer = setInterval(() => this.ingestFile(false), FILE_POLL_MS);
    if (typeof this.pollTimer === "object" && "unref" in this.pollTimer) {
      this.pollTimer.unref();
    }
  }

  private startUdpListener(): void {
    try {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

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
      });

      socket.bind(UDP_PORT, UDP_HOST, () => {
        console.log(`[control-bridge-listener] Listening on ${UDP_HOST}:${UDP_PORT}`);
      });

      this.socket = socket;
    } catch (err) {
      console.warn("[control-bridge-listener] Failed to bind UDP socket:", err);
    }
  }
}
