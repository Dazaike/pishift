import type { Socket } from "node:net";

/**
 * Wire protocol between PiShift and the per-tab elevated PTY host.
 *
 * An elevated process cannot be a child of the normal app, so for one tab the app launches a
 * second copy of itself through UAC (`PTY_HOST_FLAG`). That copy owns the ConPTY + omp and relays
 * the session over a named pipe the *normal* app created: a High-integrity client can open a
 * Medium-integrity pipe, but not the other way round. Messages are newline-delimited JSON.
 */

/** Turns a PiShift executable into the elevated PTY host instead of a normal app instance. */
export const PTY_HOST_FLAG = "--pishift-pty-host";
/** 128-bit hex suffix of the pipe name; the app owns `\\.\pipe\pishift-pty-<id>`. */
export const PTY_HOST_PIPE_ARG = "--pishift-pty-pipe=";
/** 256-bit hex secret the host must present first; guards the window before it connects. */
export const PTY_HOST_TOKEN_ARG = "--pishift-pty-token=";

export const PTY_HOST_PIPE_ID = /^[0-9a-f]{32}$/;
export const PTY_HOST_TOKEN = /^[0-9a-f]{64}$/;

export const ptyHostPipePath = (id: string): string => `\\\\.\\pipe\\pishift-pty-${id}`;

/** Host -> app. */
export type HostMessage =
  | { t: "hello"; token: string; pid: number; elevated: boolean; user: string }
  | { t: "spawned"; pid: number }
  | { t: "error"; message: string }
  | { t: "data"; d: string }
  | { t: "exit"; code: number };

/** App -> host. */
export type AppMessage =
  | {
      t: "spawn";
      exe: string;
      args: string[];
      cwd: string;
      cols: number;
      rows: number;
      env: Record<string, string>;
    }
  | { t: "write"; d: string }
  | { t: "resize"; cols: number; rows: number }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "kill" };

export function sendMessage(socket: Socket, msg: HostMessage | AppMessage): void {
  if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(msg)}\n`);
}

/**
 * Decode newline-delimited JSON. UTF-8 sequences split across socket chunks are reassembled by
 * `setEncoding`; unparsable lines are dropped rather than trusted.
 */
export function onMessages<T extends { t: string }>(socket: Socket, handler: (msg: T) => void): void {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed === "object" && parsed !== null && "t" in parsed && typeof parsed.t === "string") {
        handler(parsed as T);
      }
    }
  });
}
