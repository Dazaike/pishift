/**
 * `OSC 1337 ; File=` size injection.
 *
 * omp emits inline images as
 *   ESC ] 1337 ; File = inline=1;width=<cells>;height=auto : <base64> BEL
 * with no `size=` field. `@xterm/addon-image@0.9.0` aborts any IIP sequence that
 * lacks `size=` (`IIPHandler.ts:69`), so every image would be dropped silently.
 * This transformer computes the decoded byte length from the base64 payload and
 * re-emits the sequence with `size=<n>;` prepended to the header.
 *
 * Stream-safe: sequences may be split across arbitrary chunk boundaries.
 */

const MARKER = "\x1b]1337;File=";
const BEL = "\x07";
const ST = "\x1b\\";

/** Hard cap on a single buffered sequence. Beyond this the raw bytes are flushed. */
export const MAX_BUFFER = 32 * 1024 * 1024;

export type IipState = { buf: string };

export function createIipState(): IipState {
  return { buf: "" };
}

/**
 * Longest suffix of `data` (starting at or after `from`) that is a strict prefix
 * of `MARKER`. Such a tail must be withheld: the marker may complete next chunk.
 */
function partialMarkerTail(data: string, from: number): number {
  const max = Math.min(MARKER.length - 1, data.length - from);
  for (let n = max; n > 0; n--) {
    if (data.startsWith(MARKER.slice(0, n), data.length - n)) return n;
  }
  return 0;
}

/** Index just past the terminator of a sequence starting at `from`, or -1. */
function terminatorEnd(data: string, from: number): number {
  for (let i = from; i < data.length; i++) {
    const c = data.charCodeAt(i);
    if (c === 0x07) return i + 1;
    if (c === 0x1b) {
      if (i + 1 >= data.length) return -1;
      if (data[i + 1] === "\\") return i + 2;
    }
  }
  return -1;
}

/** Decoded byte length of a base64 payload, padded or not. */
export function base64ByteLength(payload: string): number {
  let unpadded = 0;
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    if (code <= 0x20 || code === 0x3d /* '=' */) continue;
    unpadded++;
  }
  return Math.floor((unpadded * 3) / 4);
}

/** Rewrite one complete `File=` sequence (terminator included). */
function rewriteSequence(seq: string): string {
  const term = seq.endsWith(BEL) ? BEL : seq.endsWith(ST) ? ST : "";
  if (!term) return seq;
  const body = seq.slice(MARKER.length, seq.length - term.length);
  const colon = body.indexOf(":");
  if (colon < 0) return seq;
  const header = body.slice(0, colon);
  if (/(?:^|;)\s*size=/i.test(header)) return seq;
  const payload = body.slice(colon + 1);
  const size = base64ByteLength(payload);
  return `${MARKER}size=${size};${header}:${payload}${term}`;
}

/**
 * Pass `chunk` through, rewriting any complete IIP sequence. Incomplete trailing
 * sequences are retained in `state` and emitted once the terminator arrives.
 */
export function injectIipSize(state: IipState, chunk: string): string {
  const data = state.buf ? state.buf + chunk : chunk;
  state.buf = "";
  let out = "";
  let i = 0;

  while (i < data.length) {
    const start = data.indexOf(MARKER, i);
    if (start < 0) {
      const keep = partialMarkerTail(data, i);
      out += data.slice(i, data.length - keep);
      if (keep) state.buf = data.slice(data.length - keep);
      return out;
    }
    out += data.slice(i, start);

    const end = terminatorEnd(data, start + MARKER.length);
    if (end < 0) {
      const pending = data.slice(start);
      // Corrupt/oversized sequence: flush raw rather than grow without bound.
      if (pending.length > MAX_BUFFER) return out + pending;
      state.buf = pending;
      return out;
    }
    out += rewriteSequence(data.slice(start, end));
    i = end;
  }
  return out;
}
