/**
 * Tails omp session transcripts and pushes structured rows to the renderer.
 *
 * omp appends to `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl`
 * as each entry completes. Streaming deltas are never persisted, so this is the
 * complete record of a session up to the last finished entry; in-flight state
 * comes from control-bridge activity telemetry instead.
 *
 * Polling mirrors `ControlBridgeListener`: one shared `setInterval`, unref'd so
 * it never holds the process open, doing at most one `statSync` per subscribed
 * tab per tick.
 */

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildTranscriptRows,
  parseTranscriptLine,
  transcriptRowId,
  type TranscriptNode,
  type TranscriptRow,
  type TranscriptSnapshot,
} from "../shared/transcript";

const SESSIONS_DIR = join(homedir(), ".omp", "agent", "sessions");
const BLOBS_DIR = join(homedir(), ".omp", "agent", "blobs");

/** Matches `ControlBridgeListener.FILE_POLL_MS`; one stat per tab per tick. */
const POLL_MS = 400;
/** Header prefix inspected when resolving a transcript by cwd. */
const HEADER_BYTES = 65536;
/** Cap on how much of a pathological transcript is ever held in memory. */
const MAX_TAIL_BYTES = 32 * 1024 * 1024;
/** Cap on an inlined attachment; larger blobs are dropped rather than shipped over IPC. */
const MAX_BLOB_BYTES = 8 * 1024 * 1024;

const BLOB_REF = /^blob:sha256:([0-9a-f]{64})$/;

interface Subscription {
  readonly ptySessionId: string;
  ompSessionId: string | null;
  cwd: string | null;
  /** Resolved transcript path, or null while the session is still memory-only. */
  path: string | null;
  /** Bytes of `path` already consumed. */
  offset: number;
  /** Trailing fragment of a half-written line, prepended to the next read. */
  partial: string;
  nodes: TranscriptNode[];
  /** Row ids delivered in order; paired with content for append-vs-replace. */
  sentRowIds: string[];
  /** Row content delivered with each id; outcomes can update without a new id. */
  sentRowSignatures: string[];
}

/** Read `[start, end)` of a file as UTF-8, or "" when the read fails. */
function readRange(path: string, start: number, end: number): string {
  const length = end - start;
  if (length <= 0) return "";

  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(length);
    const read = readSync(fd, buf, 0, length, start);
    return buf.toString("utf8", 0, read);
  } catch {
    return "";
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Nothing useful to do if the handle is already gone.
      }
    }
  }
}

/** Every `*.jsonl` under the sessions tree, one level deep. */
function listTranscripts(): string[] {
  const files: string[] = [];
  let subdirs: string[];
  try {
    subdirs = readdirSync(SESSIONS_DIR);
  } catch {
    return files;
  }

  for (const sub of subdirs) {
    const subPath = join(SESSIONS_DIR, sub);
    try {
      if (!statSync(subPath).isDirectory()) continue;
      for (const file of readdirSync(subPath)) {
        if (file.endsWith(".jsonl")) files.push(join(subPath, file));
      }
    } catch {
      // A session directory can vanish or deny access mid-scan; skip it.
    }
  }
  return files;
}

/** The `cwd` recorded in a transcript's `type:"session"` header, or null. */
function headerCwd(path: string): string | null {
  const text = readRange(path, 0, HEADER_BYTES);
  if (!text) return null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as { type?: string; cwd?: string };
      if (obj.type === "session") return typeof obj.cwd === "string" ? obj.cwd : null;
    } catch {
      // A truncated final line in the prefix is expected; keep scanning.
    }
  }
  return null;
}

/**
 * Locate a session's transcript.
 *
 * omp names files `<timestamp>_<sessionId>.jsonl`, so an id match is an exact
 * suffix test. The directory name is omp's own encoding of the cwd and has
 * legacy spellings, so it is scanned rather than reconstructed — a wrong guess
 * would silently render an empty chat.
 *
 * Without an id (a bridge that predates transcript publishing) the newest
 * transcript whose header cwd matches the tab is the best available answer.
 */
function resolveTranscript(ompSessionId: string | null, cwd: string | null): string | null {
  const files = listTranscripts();

  if (ompSessionId) {
    const suffix = `_${ompSessionId}.jsonl`;
    for (const file of files) {
      if (file.endsWith(suffix)) return file;
    }
    return null;
  }

  if (!cwd) return null;
  const wanted = cwd.replace(/[\\/]+$/, "").toLowerCase();

  let best: string | null = null;
  let bestMtime = -1;
  for (const file of files) {
    let mtime: number;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (mtime <= bestMtime) continue;
    const header = headerCwd(file);
    if (!header || header.replace(/[\\/]+$/, "").toLowerCase() !== wanted) continue;
    best = file;
    bestMtime = mtime;
  }
  return best;
}

export class TranscriptWatcher {
  private readonly subs = new Map<string, Subscription>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly send: (snapshot: TranscriptSnapshot) => void) {}

  /**
   * Start (or repoint) a tab's transcript feed and return what is on disk now.
   * The caller renders the returned snapshot; later growth arrives via `send`.
   */
  subscribe(ptySessionId: string, ompSessionId: string | null, cwd: string | null): TranscriptSnapshot {
    const existing = this.subs.get(ptySessionId);
    const sub: Subscription = existing ?? {
      ptySessionId,
      ompSessionId,
      cwd,
      path: null,
      offset: 0,
      partial: "",
      nodes: [],
      sentRowIds: [],
      sentRowSignatures: [],
    };

    if (existing) {
      // A `/resume` or `/new` repoints the same tab at a different transcript.
      if (existing.ompSessionId !== ompSessionId) existing.path = null;
      existing.ompSessionId = ompSessionId;
      existing.cwd = cwd;
      this.reset(existing);
    }

    this.subs.set(ptySessionId, sub);
    this.ensureTimer();
    return this.refresh(sub, true) ?? this.snapshot(sub, true, []);
  }

  unsubscribe(ptySessionId: string): void {
    this.subs.delete(ptySessionId);
    if (this.subs.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.subs.clear();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const sub of this.subs.values()) {
        const snapshot = this.refresh(sub);
        if (snapshot) this.send(snapshot);
      }
    }, POLL_MS);
    this.timer.unref?.();
  }

  private reset(sub: Subscription): void {
    sub.offset = 0;
    sub.partial = "";
    sub.nodes = [];
    sub.sentRowIds = [];
    sub.sentRowSignatures = [];
  }

  private snapshot(sub: Subscription, replace: boolean, rows: TranscriptRow[]): TranscriptSnapshot {
    return {
      ptySessionId: sub.ptySessionId,
      ompSessionId: sub.ompSessionId,
      file: sub.path,
      replace,
      rows,
    };
  }

  /**
   * Consume whatever the transcript grew by and produce an update, or null when
   * nothing changed. Rows are rebuilt rather than appended because a branch or
   * a `reset_boundary` can invalidate rows already delivered.
   */
  private refresh(sub: Subscription, force = false): TranscriptSnapshot | null {
    let forceReplace = force;

    if (!sub.path) {
      const found = resolveTranscript(sub.ompSessionId, sub.cwd);
      if (!found) return sub.sentRowIds.length ? this.emit(sub, true, []) : null;
      sub.path = found;
      this.reset(sub);
      forceReplace = true;
    }

    let size: number;
    try {
      size = statSync(sub.path).size;
    } catch {
      // Deleted or replaced underneath us; fall back to re-resolution next tick.
      sub.path = null;
      return null;
    }

    if (size === sub.offset) return forceReplace ? this.emit(sub, true, []) : null;

    if (size < sub.offset) {
      // Rewritten in place (migration, or a full SessionManager flush).
      this.reset(sub);
      forceReplace = true;
    }

    let start = sub.offset;
    let dropFirstLine = false;
    if (start === 0 && size > MAX_TAIL_BYTES) {
      start = size - MAX_TAIL_BYTES;
      dropFirstLine = true;
    }

    const chunk = readRange(sub.path, start, size);
    sub.offset = size;
    if (!chunk) return forceReplace ? this.emit(sub, true, []) : null;

    const text = sub.partial + chunk;
    const lines = text.split("\n");
    // The last element is either "" (chunk ended on a newline) or a half-written
    // line that will be completed by a later append.
    sub.partial = lines.pop() ?? "";

    for (let i = dropFirstLine ? 1 : 0; i < lines.length; i++) {
      const node = parseTranscriptLine(lines[i].trim());
      if (node) sub.nodes.push(node);
    }

    return this.emit(sub, forceReplace, buildTranscriptRows(sub.nodes));
  }

  /** Diff freshly built rows against what was delivered and pick append vs replace. */
  private emit(sub: Subscription, forceReplace: boolean, rows: TranscriptRow[]): TranscriptSnapshot | null {
    const ids = rows.map(transcriptRowId);
    // Tool results amend the entry that issued the call. Compare the rendered
    // contract too, not just ids, so those outcomes replace their running card.
    const signatures = rows.map((row) => JSON.stringify(row));
    const sent = sub.sentRowIds;
    const sentSignatures = sub.sentRowSignatures;

    let append = !forceReplace && ids.length >= sent.length;
    if (append) {
      for (let i = 0; i < sent.length; i++) {
        if (ids[i] !== sent[i] || signatures[i] !== sentSignatures[i]) {
          append = false;
          break;
        }
      }
    }

    if (append && ids.length === sent.length) return null;

    sub.sentRowIds = ids;
    sub.sentRowSignatures = signatures;
    return append
      ? this.snapshot(sub, false, rows.slice(sent.length))
      : this.snapshot(sub, true, rows);
  }
}

/**
 * Resolve a `blob:sha256:<hash>` transcript attachment to a data URL.
 *
 * The hash pattern is enforced rather than sanitised: it is the only thing
 * keeping a crafted transcript from reading an arbitrary file through this
 * renderer-reachable channel.
 */
export function readTranscriptBlob(ref: string, mimeType: string): string | null {
  const match = BLOB_REF.exec(ref);
  if (!match) return null;

  const path = join(BLOBS_DIR, match[1]);
  try {
    if (!existsSync(path)) return null;
    if (statSync(path).size > MAX_BLOB_BYTES) return null;
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(mimeType) ? mimeType : "image/png";
    return `data:${type};base64,${readFileSync(path).toString("base64")}`;
  } catch {
    return null;
  }
}
