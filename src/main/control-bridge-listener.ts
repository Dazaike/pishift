import * as dgram from "node:dgram";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CH, type ControlBridgeState } from "../shared/ipc";

const STATUS_FILE = join(homedir(), ".omp", "agent", "runtime-status.json");
const UDP_HOST = "127.0.0.1";
const UDP_PORT = 37991;

export class ControlBridgeListener {
  private socket: dgram.Socket | null = null;
  private lastState: ControlBridgeState | null = null;

  constructor(private readonly broadcast: (channel: string, payload: ControlBridgeState) => void) {
    this.lastState = this.readStatusFile();
    this.startUdpListener();
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
        this.lastState = parsed;
        return parsed;
      }
    } catch {
      // Best effort reading
    }
    return null;
  }

  private startUdpListener(): void {
    try {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

      socket.on("message", (msg) => {
        try {
          const raw = msg.toString("utf8");
          const state = JSON.parse(raw) as ControlBridgeState;
          if (state && typeof state.activity === "string") {
            this.lastState = state;
            this.broadcast(CH.controlBridgeStatus, state);
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

  close(): void {
    try {
      this.socket?.close();
      this.socket = null;
    } catch {
      // Ignore
    }
  }
}
