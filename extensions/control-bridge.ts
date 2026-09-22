import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";

import * as dgram from "node:dgram";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---8<--- activity-core (source of truth: src/shared/activity.ts) ---8<---
/**
 * Agent activity classification.
 *
 * Everything between the sentinel comments is duplicated verbatim into
 * `extensions/control-bridge.ts`, which is copied standalone into
 * `~/.omp/agent/extensions/` and therefore cannot import from `src/`. The copy
 * drops the `export` keywords and nothing else; `test/activity-sync.test.ts`
 * fails if the two drift. Keep this block dependency-free.
 *
 * Event shapes are omp 18's: `message_update` is forwarded to extensions as
 * `{ type, message, assistantMessageEvent }`, `toolcall_start` / `toolcall_delta`
 * carry the tool name only at `partial.content[contentIndex].name`,
 * `toolcall_end` carries `toolCall.name`, and `tool_execution_*` carry a
 * top-level `toolName` plus `toolCallId`.
 */
type AgentActivity =
  | "idle"
  | "waiting"
  | "thinking"
  | "responding"
  | "reading"
  | "editing"
  | "running"
  | "working";

/** omp 18 `BUILTIN_TOOL_NAMES` plus its `search`/`find` aliases. */
const TOOL_ACTIVITY: Record<string, AgentActivity> = {
  read: "reading",
  grep: "reading",
  glob: "reading",
  search: "reading",
  find: "reading",
  ast_grep: "reading",
  lsp: "reading",
  web_search: "reading",
  inspect_image: "reading",
  security_scan: "reading",
  github: "reading",
  recall: "reading",
  reflect: "reading",
  edit: "editing",
  write: "editing",
  ast_edit: "editing",
  memory_edit: "editing",
  retain: "editing",
  learn: "editing",
  manage_skill: "editing",
  bash: "running",
  eval: "running",
  debug: "running",
  browser: "running",
  computer: "running",
  ask: "working",
  task: "working",
  hub: "working",
  todo: "working",
  checkpoint: "working",
  rewind: "working",
};

/** Highest wins when several tool calls are in flight at once. */
const TOOL_PRIORITY: Record<AgentActivity, number> = {
  running: 4,
  editing: 3,
  reading: 2,
  working: 1,
  thinking: 0,
  responding: 0,
  waiting: 0,
  idle: 0,
};

/** `mcp__server__tool` -> `tool`; `Read`/`fs/read` -> `read`. */
function normalizeToolKey(raw: string): string {
  let name = raw.toLowerCase();
  if (name.startsWith("mcp__")) {
    const sep = name.indexOf("__", 5);
    name = sep === -1 ? name.slice(5) : name.slice(sep + 2);
  }
  const tail = name.split(/[:/.]/).pop() ?? name;
  return tail.replace(/[^a-z0-9_]/g, "");
}

function classifyToolActivity(rawToolName: string): AgentActivity {
  const key = normalizeToolKey(rawToolName);
  const known = TOOL_ACTIVITY[key];
  if (known !== undefined) return known;

  // Unknown or MCP tool: guess from word parts, never from bare substrings
  // ("threading" must not read as "reading").
  if (/(?:^|_)(?:edit|write|patch|apply|create|update|delete|remove|save)(?:_|$)/.test(key)) {
    return "editing";
  }
  if (/(?:^|_)(?:read|grep|glob|search|find|list|view|get|fetch|inspect|query)(?:_|$)/.test(key)) {
    return "reading";
  }
  if (/(?:^|_)(?:bash|sh|shell|cmd|exec|run|repl|eval|python|node|js|terminal)(?:_|$)/.test(key)) {
    return "running";
  }
  return "working";
}

/** `assistantMessageEvent.type` for a forwarded `message_update`, else `event.type`. */
function extractStreamEventType(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  if ("assistantMessageEvent" in event) {
    const inner = event.assistantMessageEvent;
    if (inner && typeof inner === "object" && "type" in inner && typeof inner.type === "string") {
      return inner.type;
    }
  }
  if ("type" in event && typeof event.type === "string") return event.type;
  return undefined;
}

function extractToolName(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;

  // tool_execution_start / _update / _end.
  if ("toolName" in event && typeof event.toolName === "string") return event.toolName;

  // toolcall_end.
  if ("toolCall" in event && event.toolCall && typeof event.toolCall === "object") {
    const call = event.toolCall;
    if ("name" in call && typeof call.name === "string") return call.name;
  }

  // toolcall_start / toolcall_delta: name only exists in the partial message.
  if (
    "partial" in event &&
    event.partial &&
    typeof event.partial === "object" &&
    "contentIndex" in event &&
    typeof event.contentIndex === "number"
  ) {
    const partial = event.partial;
    if ("content" in partial && Array.isArray(partial.content)) {
      const block = partial.content[event.contentIndex];
      if (block && typeof block === "object" && "name" in block && typeof block.name === "string") {
        return block.name;
      }
    }
  }

  if ("assistantMessageEvent" in event) return extractToolName(event.assistantMessageEvent);

  return undefined;
}

/**
 * Resolves omp's event stream to one activity.
 *
 * Precedence: in-flight tool executions (most specific wins) > a tool call whose
 * arguments are still streaming > the assistant's streaming phase > `waiting`.
 * `waiting` is the honest default inside a live turn: the request is out and
 * nothing is streaming yet, which is most of the latency before the first token
 * and the gap after each tool result is submitted. `working` is reserved for
 * events that really are work of an unclassifiable kind (orchestration tools,
 * unknown/MCP tools, a tool call whose name never arrived).
 * Nothing is invented: every field is set from an observed event.
 */
class ActivityTracker {
  private live = false;
  private phase: "thinking" | "responding" | null = null;
  private streamingTool: AgentActivity | null = null;
  private readonly inFlight = new Map<string, AgentActivity>();
  private readonly ended = new Set<string>();

  get activity(): AgentActivity {
    if (!this.live) return "idle";
    let best: AgentActivity | null = null;
    for (const value of this.inFlight.values()) {
      if (best === null || TOOL_PRIORITY[value] > TOOL_PRIORITY[best]) best = value;
    }
    if (best !== null) return best;
    if (this.streamingTool !== null) return this.streamingTool;
    if (this.phase !== null) return this.phase;
    return "waiting";
  }

  private clearForeground(): void {
    this.phase = null;
    this.streamingTool = null;
    this.inFlight.clear();
  }

  /** Session start / switch / shutdown. */
  reset(): void {
    this.live = false;
    this.clearForeground();
    this.ended.clear();
  }

  agentStart(): void {
    this.clearForeground();
    this.live = true;
  }

  /** `willContinue` means omp is looping into another agent run, not finishing. */
  agentEnd(willContinue = false): void {
    for (const toolCallId of this.inFlight.keys()) this.ended.add(toolCallId);
    this.clearForeground();
    this.live = willContinue;
  }

  /** One `message_update`; `type` is `assistantMessageEvent.type`. */
  stream(type: string | undefined, toolName: string | undefined): void {
    this.live = true;
    switch (type) {
      case "thinking_delta":
        this.phase = "thinking";
        this.streamingTool = null;
        break;
      case "thinking_end":
        if (this.phase === "thinking") this.phase = null;
        break;
      case "text_delta":
        this.phase = "responding";
        this.streamingTool = null;
        break;
      case "text_end":
        if (this.phase === "responding") this.phase = null;
        break;
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
        this.phase = null;
        // A tool call is streaming, so this is never `waiting`; an unnamed delta
        // keeps whatever the call was already classified as, else plain work.
        this.streamingTool =
          toolName !== undefined ? classifyToolActivity(toolName) : (this.streamingTool ?? "working");
        break;
    }
  }

  toolStart(toolCallId: string, toolName: string | undefined): void {
    this.live = true;
    this.ended.delete(toolCallId);
    this.inFlight.set(
      toolCallId,
      toolName !== undefined ? classifyToolActivity(toolName) : "working",
    );
  }

  /** `tool_execution_update` — also recovers a live start we never saw. */
  toolUpdate(toolCallId: string, toolName: string | undefined): void {
    if (this.ended.has(toolCallId)) return;
    if (this.inFlight.has(toolCallId)) {
      this.live = true;
      return;
    }
    if (this.live) this.toolStart(toolCallId, toolName);
  }

  toolEnd(toolCallId: string): void {
    this.inFlight.delete(toolCallId);
    this.ended.add(toolCallId);
    // The call that was streaming arguments has finished executing.
    if (this.inFlight.size === 0) this.streamingTool = null;
  }
}
// ---8<--- end activity-core ---8<---

/**
 * Live assistant output, rebuilt from `message_update` deltas.
 *
 * omp only persists a message to the session JSONL once it is complete, so the
 * transcript can never show a reply as it is written. These deltas are the only
 * source of in-progress text. Verified event shapes (omp 18.0.11):
 * `{text,thinking,toolcall}_start` carry `contentIndex`; `*_delta` carry
 * `delta`; `text_end`/`thinking_end` carry the finished `content`.
 *
 * Tool-call argument deltas are ignored: the activity pill already names the
 * running tool, and streaming raw JSON is noise.
 */
const MAX_STREAM_CHARS = 20_000;

function capStream(value: string): string {
  return value.length > MAX_STREAM_CHARS ? value.slice(-MAX_STREAM_CHARS) : value;
}

class StreamBuffer {
  private thinking = "";
  private text = "";

  clear(): void {
    this.thinking = "";
    this.text = "";
  }

  read(): { thinking: string; text: string } | null {
    return this.thinking || this.text ? { thinking: this.thinking, text: this.text } : null;
  }

  /** Apply one `assistantMessageEvent`; returns true when either buffer changed. */
  apply(type: string | undefined, event: unknown): boolean {
    const ev = event && typeof event === "object" ? (event as Record<string, unknown>) : null;

    switch (type) {
      case "text_start":
        this.text = "";
        return true;
      case "thinking_start":
        this.thinking = "";
        return true;

      case "text_delta":
      case "thinking_delta": {
        let nestedDelta = "";
        if (ev && "delta" in ev && ev.delta && typeof ev.delta === "object") {
          if ("text" in ev.delta && typeof ev.delta.text === "string") nestedDelta = ev.delta.text;
          else if ("thinking" in ev.delta && typeof ev.delta.thinking === "string") nestedDelta = ev.delta.thinking;
          else if ("content" in ev.delta && typeof ev.delta.content === "string") nestedDelta = ev.delta.content;
        }
        const direct = ev && typeof ev.delta === "string"
          ? ev.delta
          : ev && typeof ev.text === "string"
            ? ev.text
            : ev && typeof ev.content === "string"
              ? ev.content
              : nestedDelta;
        const contentIndex = ev && typeof ev.contentIndex === "number" ? ev.contentIndex : -1;
        let partial: unknown = null;
        if (ev && "partial" in ev && ev.partial && typeof ev.partial === "object" && "content" in ev.partial) {
          partial = ev.partial.content;
        }
        const items = Array.isArray(partial) ? partial : [];
        let item = contentIndex >= 0 ? items[contentIndex] : null;
        if (!item) {
          for (let i = items.length - 1; i >= 0; i--) {
            const candidate = items[i];
            if (!candidate || typeof candidate !== "object") continue;
            if (
              ("thinking" in candidate && typeof candidate.thinking === "string")
              || ("text" in candidate && typeof candidate.text === "string")
              || ("content" in candidate && typeof candidate.content === "string")
            ) {
              item = candidate;
              break;
            }
          }
        }
        let snapshot = "";
        if (item && typeof item === "object") {
          if ("text" in item && typeof item.text === "string") snapshot = item.text;
          else if ("thinking" in item && typeof item.thinking === "string") snapshot = item.thinking;
          else if ("content" in item && typeof item.content === "string") snapshot = item.content;
        }
        // Providers disagree on what a "delta" is: some send the next few
        // characters, others re-send the whole block each time. A payload that
        // already starts with what is buffered is the block itself and replaces
        // it; anything else is an increment and appends. Guessing wrong here is
        // what made reasoning read "Let me readLet me read the…".
        const current = type === "text_delta" ? this.text : this.thinking;
        const candidate = direct || snapshot;
        let next: string;
        if (current !== "" && candidate.startsWith(current)) {
          if (candidate.length === current.length) return false;
          next = candidate;
        } else if (direct) {
          next = current + direct;
        } else if (snapshot.length > current.length) {
          next = snapshot;
        } else {
          return false;
        }
        if (type === "text_delta") this.text = capStream(next);
        else this.thinking = capStream(next);
        return true;
      }

      case "text_end":
      case "thinking_end": {
        // Authoritative full block; deltas can have been dropped or truncated.
        const content = ev && typeof ev.content === "string" ? ev.content : null;
        if (content === null) return false;
        if (type === "text_end") {
          this.text = capStream(content);
        } else {
          this.thinking = capStream(content);
        }
        return true;
      }
    }
    return false;
  }
}

interface PendingAskOption {
  label: string;
  description?: string;
}

interface PendingAskQuestion {
  id?: string;
  question: string;
  options: PendingAskOption[];
  multi?: boolean;
  recommended?: number;
  header?: string;
}

interface PendingAsk {
  toolCallId: string;
  questions: PendingAskQuestion[];
}

interface TodoTask {
  content: string;
  status: string;
}

interface TodoPhase {
  name: string;
  tasks: TodoTask[];
}

function normalizeTodoPhases(raw: unknown): TodoPhase[] | null {
  if (!Array.isArray(raw)) return null;
  const phases: TodoPhase[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object" || !("name" in p) || typeof p.name !== "string") continue;
    if (!("tasks" in p) || !Array.isArray(p.tasks)) continue;
    const tasks: TodoTask[] = [];
    for (const t of p.tasks) {
      if (!t || typeof t !== "object" || !("content" in t) || typeof t.content !== "string") continue;
      const status = "status" in t && typeof t.status === "string" ? t.status : "pending";
      tasks.push({ content: t.content, status });
    }
    phases.push({ name: p.name, tasks });
  }
  return phases;
}

export class AuthoritativeSnapshotCache<T> {
  private snapshot: T[] = [];

  read(reader: () => T[] | null): T[] {
    let next: T[] | null;
    try {
      next = reader();
    } catch {
      return this.snapshot;
    }
    if (next !== null) this.snapshot = next;
    return this.snapshot;
  }

  reset(): void {
    this.snapshot = [];
  }
}

interface AsyncJob {
  id: string;
  type: string;
  status: string;
  label: string;
  startTime: number;
  model?: string;
}

/** omp's ExtensionContext type may predate getAsyncJobSnapshot; access it structurally. */
interface AsyncJobSnapshotLike {
  running?: unknown;
  recent?: unknown;
}

function normalizeJobs(raw: unknown, cap: number): AsyncJob[] {
  if (!Array.isArray(raw)) return [];
  const out: AsyncJob[] = [];
  for (const j of raw) {
    if (!j || typeof j !== "object") continue;
    const type = "type" in j && typeof j.type === "string" ? j.type : "job";
    // Filter out regular bash jobs: only show task / subagent jobs matching /jobs
    if (type === "bash") continue;
    const id = "id" in j && typeof j.id === "string" ? j.id : "";
    if (!id) continue;
    const rawModel =
      ("model" in j && typeof j.model === "string" && j.model) ||
      ("resolvedModel" in j && typeof j.resolvedModel === "string" && j.resolvedModel) ||
      undefined;
    out.push({
      id,
      type,
      status: "status" in j && typeof j.status === "string" ? j.status : "running",
      label: "label" in j && typeof j.label === "string" ? j.label : id,
      startTime: "startTime" in j && typeof j.startTime === "number" ? j.startTime : 0,
      ...(rawModel ? { model: rawModel } : {}),
    });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Running jobs first, then the most recent finished ones. `null` means the
 * registry is temporarily unavailable; an empty array is authoritative.
 */
function readAvailableJobs(ctx: ExtensionContext): AsyncJob[] | null {
  const withJobs = ctx as ExtensionContext & {
    getAsyncJobSnapshot?: (opts?: { recentLimit?: number }) => AsyncJobSnapshotLike | null;
  };
  if (typeof withJobs.getAsyncJobSnapshot !== "function") return null;
  const snap = withJobs.getAsyncJobSnapshot({ recentLimit: 5 });
  if (!snap) return null;
  return [...normalizeJobs(snap.running, 24), ...normalizeJobs(snap.recent, 5)];
}

/**
 * Native plan tri-state. Kept identical to `src/shared/plan-mode.ts`; this
 * file cannot import from `src/` because it is copied standalone into
 * `~/.omp/agent/extensions/`.
 */
type PlanMode = "off" | "on" | "paused";

/** Subset of omp's session manager used to derive plan mode and locate the transcript. */
interface SessionManagerLike {
  getLeafId?: () => string | undefined;
  getBranch?: () => unknown[] | undefined;
  getSessionId?: () => string | undefined;
}

type BridgeUpdateKind = "session" | "jobs";

interface LiveStep {
  id: string;
  name: string;
  subject: string | null;
  running: boolean;
  isError: boolean;
  /** Tail of the payload still being streamed, so a write shows its contents. */
  preview: string | null;
}

/** Cap: a runaway loop must not grow an unbounded datagram. */
const MAX_LIVE_STEPS = 40;
/** Enough of an argument object to find its path or command, never the payload. */
const MAX_ARG_HEAD = 400;
/** Payload tail kept for the live preview; a datagram, not a file buffer. */
const MAX_PREVIEW_CHARS = 1600;
/** Lines sent per call: the view shows five and scrolls back through the rest. */
const MAX_PREVIEW_LINES = 16;

/**
 * Decode the tail of a half-written JSON string value into displayable text.
 * The fragment is arbitrary — it can end mid-escape — so a dangling backslash
 * is dropped rather than producing a stray character.
 */
function decodeArgTail(raw: string): string {
  return raw
    .replace(/\\$/, "")
    .replace(/\\u[0-9a-fA-F]{0,4}$/, "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * The last few lines of the payload a call is writing. Derived from the raw
 * argument tail because the JSON is not parseable until the call completes —
 * which is precisely the stretch worth showing.
 *
 * Only content-carrying calls qualify. A command has no payload to watch: its
 * arguments *are* the subject, already on the row, and echoing them into a
 * file-edit panel claimed an edit that never happened.
 */
function previewFromArgTail(toolName: string, raw: string): string | null {
  if (classifyToolActivity(toolName) !== "editing") return null;
  const marker = /"(?:content|patch|new_str|newText|text|body)"\s*:\s*"/.exec(raw);
  // Before the payload key arrives there is nothing to show; the raw argument
  // head is JSON plumbing, not file content.
  if (!marker && !/^[\s\S]*\\n/.test(raw)) return null;
  const payload = marker ? raw.slice(marker.index + marker[0].length) : raw;
  const decoded = decodeArgTail(payload).replace(/"\s*[,}]\s*$/, "");
  const lines = decoded.split("\n").filter((line, index, all) => line !== "" || index !== all.length - 1);
  if (!lines.length) return null;
  const shown = lines.slice(-MAX_PREVIEW_LINES).join("\n").trimEnd();
  return shown === "" ? null : shown;
}

/** Argument names that say what a call is about, most specific first. */
const SUBJECT_KEYS = [
  "path",
  "file",
  "filePath",
  "file_path",
  "filename",
  "target",
  "command",
  "cmd",
  "pattern",
  "query",
  "url",
  "input",
  "name",
];

/**
 * What a call is *about*, taken from its arguments: the path being edited, the
 * command being run, the pattern being searched. Without it a live row could
 * only say "Editing", which the activity pill already says.
 *
 * Arguments reach this both as an object and as raw JSON text, depending on
 * whether the call has finished streaming, so both are handled.
 */
function extractStepSubject(args: unknown): string | null {
  if (typeof args === "string") return subjectFromPartialArgs(args);
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  for (const key of SUBJECT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return clipSubject(value);
  }
  return null;
}

/** Trim a subject to one line that fits a chat row. */
function clipSubject(value: string): string | null {
  const line = value.split("\n")[0].trim();
  if (line === "") return null;
  return line.length > 120 ? `${line.slice(0, 119)}\u2026` : line;
}

/**
 * The tool call whose arguments are streaming right now, read out of the
 * in-progress message block. omp writes a big file by streaming its arguments
 * for many seconds *before* `tool_execution_start` fires, so execution events
 * alone leave that whole stretch looking idle.
 *
 * `delta` is the raw argument-JSON fragment that just arrived. The block itself
 * often carries no parsed arguments at all while they are still being written,
 * so the fragments are the only place the path or command can be found.
 */
function extractStreamingCall(
  event: unknown,
): { id: string; name: string; args: string; delta: string } | null {
  if (!event || typeof event !== "object") return null;
  const ev = event as Record<string, unknown>;
  const partial = ev.partial && typeof ev.partial === "object" ? (ev.partial as Record<string, unknown>) : null;
  const items = partial && Array.isArray(partial.content) ? (partial.content as Record<string, unknown>[]) : [];
  if (!items.length) return null;
  const index = typeof ev.contentIndex === "number" && ev.contentIndex >= 0 ? ev.contentIndex : items.length - 1;
  const block = items[index];
  if (!block || typeof block !== "object") return null;

  const name = typeof block.name === "string" ? block.name : "";
  if (name === "") return null;
  const id =
    typeof block.id === "string"
      ? block.id
      : typeof block.toolCallId === "string"
        ? block.toolCallId
        : `stream:${index}`;
  const args =
    typeof block.arguments === "string"
      ? block.arguments
      : typeof block.args === "string"
        ? block.args
        : block.args && typeof block.args === "object"
          ? JSON.stringify(block.args)
          : "";
  const delta =
    typeof ev.delta === "string"
      ? ev.delta
      : ev.delta && typeof ev.delta === "object" && typeof (ev.delta as Record<string, unknown>).text === "string"
        ? ((ev.delta as Record<string, unknown>).text as string)
        : "";
  return { id, name, args, delta };
}

/**
 * Pull a subject out of *half-written* argument JSON. The text is not parseable
 * yet — that is the whole point of showing it — so the first complete key/value
 * pair is matched directly.
 */
function subjectFromPartialArgs(text: string): string | null {
  const match = new RegExp(`"(?:${SUBJECT_KEYS.join("|")})"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
  if (!match) return null;
  return clipSubject(match[1].replace(/\\(.)/g, "$1"));
}

interface BridgeState {
  /**
   * Job registry polling is independent of the terminal session lifecycle.
   * Consumers must keep job updates out of session/model/thinking state.
   */
  updateKind: BridgeUpdateKind;
  running: boolean;
  activity: AgentActivity;
  thinkingLevel: string;
  planMode: PlanMode;
  ask: PendingAsk | null;
  todo: TodoPhase[] | null;
  jobs: AsyncJob[];
  pid: number;
  cwd: string | null;
  /** Matches host `PISHIFT_SESSION_ID` so multi-tab chrome can route activity. */
  sessionId: string | null;
  /**
   * omp's own session id — locates the on-disk JSONL transcript under
   * `~/.omp/agent/sessions/`. Null on hosts without `getSessionId()`.
   */
  ompSessionId: string | null;
  /**
   * Assistant output still being written: independent thinking and text
   * buffers. UDP-only and never persisted to the status file: it is worthless
   * a moment later, and a stale copy on disk would be read back as live.
   */
  stream: { thinking: string; text: string } | null;
  /**
   * Tool calls of the current turn, in execution order. omp only writes a call
   * to the transcript when its message persists, so this is the only way a UI
   * can show an edit or a command while it is actually running. UDP-only for
   * the same reason as `stream`.
   */
  steps: LiveStep[];
}

/**
 * One file per `PISHIFT_SESSION_ID`, not a single shared file: concurrent omp
 * sessions (two PiShift instances, or two tabs) used to clobber each other's
 * durable status here with last-writer-wins. PiShift's `pty-manager.ts`
 * deletes each session's file when its PTY exits.
 */
const STATUS_DIR = join(
  homedir(),
  ".omp",
  "agent",
  "runtime-status",
);

const CANCEL_REQUEST_FILE = join(
  homedir(),
  ".omp",
  "agent",
  "cancel-job.json",
);

const UDP_HOST = "127.0.0.1";
/** Used only when the host predates per-instance port negotiation. */
const FALLBACK_UDP_PORT = 37991;
const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  off: (ThinkingLevel?.Off ?? "off") as ThinkingLevel,

  auto: (ThinkingLevel?.Auto ?? "auto") as ThinkingLevel,

  min: (ThinkingLevel?.Minimal ?? "minimal") as ThinkingLevel,
  minimal: (ThinkingLevel?.Minimal ?? "minimal") as ThinkingLevel,

  low: (ThinkingLevel?.Low ?? "low") as ThinkingLevel,

  med: (ThinkingLevel?.Medium ?? "medium") as ThinkingLevel,
  medium: (ThinkingLevel?.Medium ?? "medium") as ThinkingLevel,

  high: (ThinkingLevel?.High ?? "high") as ThinkingLevel,

  xhigh: (ThinkingLevel?.XHigh ?? "xhigh") as ThinkingLevel,
  xhi: (ThinkingLevel?.XHigh ?? "xhigh") as ThinkingLevel,

  max: (ThinkingLevel?.Max ?? "max") as ThinkingLevel,
};

function normalizeAskOptions(raw: unknown): PendingAskOption[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingAskOption[] = [];
  for (const o of raw) {
    if (typeof o === "string") {
      out.push({ label: o });
      continue;
    }
    if (o && typeof o === "object" && "label" in o && typeof o.label === "string") {
      const option: PendingAskOption = { label: o.label };
      if ("description" in o && typeof o.description === "string") {
        option.description = o.description;
      }
      out.push(option);
    }
  }
  return out;
}

function normalizeAskQuestions(raw: unknown): PendingAskQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingAskQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object" || !("question" in q) || typeof q.question !== "string") continue;
    const options = "options" in q ? normalizeAskOptions(q.options) : [];
    if (options.length === 0) continue;
    const question: PendingAskQuestion = { question: q.question, options };
    if ("id" in q && typeof q.id === "string") question.id = q.id;
    if ("multi" in q) question.multi = q.multi === true;
    if ("recommended" in q && typeof q.recommended === "number") question.recommended = q.recommended;
    if ("header" in q && typeof q.header === "string") question.header = q.header;
    out.push(question);
  }
  return out;
}

export default function controlBridge(pi: ExtensionAPI) {
  const sessionId = process.env.PISHIFT_SESSION_ID?.trim() || null;
  if (!sessionId) return;
  const statusFile = join(STATUS_DIR, `${sessionId}.json`);
  const envPort = process.env.PISHIFT_CONTROL_BRIDGE_PORT?.trim();
  const udpPort =
    envPort && /^\d+$/.test(envPort) ? Number(envPort) : FALLBACK_UDP_PORT;

  let activity: AgentActivity = "idle";
  const tracker = new ActivityTracker();
  const stream = new StreamBuffer();
  /** Tool calls of the running turn; the transcript owns them once it persists. */
  let liveSteps: LiveStep[] = [];
  /** Head (for the subject) and tail (for the preview) of each streaming call's arguments. */
  const streamingArgs = new Map<string, { head: string; tail: string }>();
  const jobSnapshots = new AuthoritativeSnapshotCache<AsyncJob>();
  let lastActivityPublish = 0;
  let pendingDurable = false;
  let activityPublishPending = false;
  let running = false;
  let planMode: PlanMode = "off";
  let planLeafId: string | null = null;
  let publishedPlanMode: PlanMode | null = null;
  let pendingAsk: PendingAsk | null = null;
  let todoState: TodoPhase[] | null = null;
  let publishedJobsSig = "";

  let udp: dgram.Socket | undefined;
  let heartbeatStarted = false;

  function getUdp(): dgram.Socket {
    if (!udp) {
      udp = dgram.createSocket("udp4");
      udp.unref();
    }

    return udp;
  }
  function checkAndExecuteCancel(ctx: ExtensionContext): void {
    if (!existsSync(CANCEL_REQUEST_FILE)) return;
    try {
      const raw = readFileSync(CANCEL_REQUEST_FILE, "utf8");
      const req = JSON.parse(raw) as { jobId?: string; sessionId?: string; timestamp?: number };
      if (!req || !req.jobId) return;

      if (req.sessionId && req.sessionId !== sessionId) return;

      const targetId = req.jobId.trim();

      const withSession = ctx as unknown as {
        session?: { asyncJobManager?: { cancel: (id: string) => boolean } };
        asyncJobManager?: { cancel: (id: string) => boolean };
        sessionManager?: { session?: { asyncJobManager?: { cancel: (id: string) => boolean } } };
      };

      const mgr =
        withSession.session?.asyncJobManager ??
        withSession.asyncJobManager ??
        withSession.sessionManager?.session?.asyncJobManager;

      if (mgr && typeof mgr.cancel === "function") {
        mgr.cancel(targetId);
      }

      if (typeof ctx.invokeTool === "function") {
        void ctx.invokeTool("hub", { op: "cancel", ids: [targetId] });
      }

      try {
        unlinkSync(CANCEL_REQUEST_FILE);
      } catch {}

      publish(ctx, true, "jobs");
    } catch {}
  }


  /**
   * Derive plan mode the way omp itself does: walk the current branch back to
   * the newest `mode_change` entry. No extension API exposes plan state, and
   * `/plan` emits no extension event, so this scan (leaf-id gated) is the only
   * truthful source. Returns the last known value if `sessionManager` is
   * missing rather than fabricating "off".
   */
  function readPlanMode(ctx: ExtensionContext): PlanMode {
    // omp's public ExtensionContext type omits sessionManager's shape, but the
    // TUI always supplies these two methods; nothing else is touched.
    const withSession = ctx as ExtensionContext & { sessionManager?: SessionManagerLike };
    const sm = withSession.sessionManager;
    if (!sm || typeof sm.getBranch !== "function") return planMode;

    const leaf = typeof sm.getLeafId === "function" ? (sm.getLeafId() ?? null) : null;
    if (leaf !== null && leaf === planLeafId) return planMode;

    let next: PlanMode = "off";
    const branch = sm.getBranch() ?? [];
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (!entry || typeof entry !== "object") continue;
      if (!("type" in entry) || entry.type !== "mode_change") continue;
      const mode = "mode" in entry ? entry.mode : undefined;
      next = mode === "plan" ? "on" : mode === "plan_paused" ? "paused" : "off";
      break;
    }
    planLeafId = leaf;
    planMode = next;
    return next;
  }

  /** omp's session id, or null when the host predates `sessionManager.getSessionId()`. */
  function readOmpSessionId(ctx: ExtensionContext): string | null {
    try {
      const sm = (ctx as ExtensionContext & { sessionManager?: SessionManagerLike }).sessionManager;
      const id = sm && typeof sm.getSessionId === "function" ? sm.getSessionId() : undefined;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    } catch {
      return null;
    }
  }

  function makeState(ctx: ExtensionContext, updateKind: BridgeUpdateKind): BridgeState {
    const model = ctx.models.current();
    const thinking = pi.getThinkingLevel();
    const currentPlanMode = readPlanMode(ctx);
    const currentSessionId = sessionId;

    return {
      updateKind,
      running,
      activity,
      model: model
        ? `${model.provider}/${model.id}`
        : null,
      thinkingLevel: thinking
        ? String(thinking)
        : "off",
      planMode: currentPlanMode,
      ask: pendingAsk,
      todo: todoState,
      jobs: jobSnapshots.read(() => readAvailableJobs(ctx)),
      pid: process.pid,
      cwd: ctx.cwd ?? null,
      sessionId: currentSessionId,
      ompSessionId: readOmpSessionId(ctx),
      stream: stream.read(),
      steps: liveSteps,
      updatedAt: new Date().toISOString(),
    };
  }

  function publish(
    ctx: ExtensionContext,
    sendUdp = true,
    updateKind: BridgeUpdateKind = "session",
    writeFile = true,
  ) {
    if (!ctx || !ctx.hasUI) return;
    const state = makeState(ctx, updateKind);
    publishedPlanMode = state.planMode;
    publishedJobsSig = state.jobs.map((j) => `${j.id}:${j.status}`).join("|");
    const json = JSON.stringify(state);

    if (writeFile) {
      mkdirSync(dirname(statusFile), {
        recursive: true,
      });

      // Pretty JSON makes manual inspection less miserable. `stream` and `steps`
      // are omitted: the file is the backstop for durable state, and a stale
      // copy of in-flight work on disk would be read back as live.
      const { stream: _stream, steps: _steps, ...durableState } = state;
      writeFileSync(
        statusFile,
        JSON.stringify(durableState, null, 2),
        "utf8",
      );
    }


    if (sendUdp) {
      try {
        const socket = getUdp();

        socket.send(
          Buffer.from(json),
          udpPort,
          UDP_HOST,
        );
      } catch {
        // UDP telemetry should never break OMP.
      }
    }
  }

  /** Coalesced activity publish: never faster than 120 ms, never drops the last state. */
  const ACTIVITY_MIN_INTERVAL_MS = 120;

  /**
   * Publish when the activity classification *or* the live stream text moved.
   * Streaming alone skips the status-file write: nothing durable changed, and a
   * response emits one of these every 120 ms.
   */
  function syncActivity(ctx: ExtensionContext, streamOnly = false) {
    if (!ctx || !ctx.hasUI) return;
    const next = tracker.activity;
    const durable = next !== activity;
    if (!durable && !streamOnly) return;
    activity = next;
    if (durable) pendingDurable = true;

    const flush = (): void => {
      const writeFile = pendingDurable;
      pendingDurable = false;
      publish(ctx, true, "session", writeFile);
    };

    const now = Date.now();
    // Idle ends the turn; publish it immediately so the glow stops on time.
    if (next === "idle" || now - lastActivityPublish >= ACTIVITY_MIN_INTERVAL_MS) {
      lastActivityPublish = now;
      flush();
      return;
    }
    if (activityPublishPending) return;
    activityPublishPending = true;
    ctx.setTimeout(
      () => {
        activityPublishPending = false;
        lastActivityPublish = Date.now();
        flush();
      },
      ACTIVITY_MIN_INTERVAL_MS - (now - lastActivityPublish),
    );
  }

  function toolCallKey(event: unknown, toolName: string | undefined): string {
    if (event && typeof event === "object" && "toolCallId" in event && typeof event.toolCallId === "string") {
      return event.toolCallId;
    }
    return toolName ?? "unknown";
  }

  /**
   * Record (or refine) the call whose arguments are still streaming. Returns
   * whether anything a consumer can see actually changed, so a delta that adds
   * nothing new does not cost a datagram.
   *
   * Two windows are kept per call, never the whole payload: the head, where the
   * subject (`path`, `command`, …) lives, and a short tail, which is the file
   * contents currently being written. The tail is what makes a write look alive
   * instead of a name with a spinner next to it.
   */
  function upsertStreamingStep(call: { id: string; name: string; args: string; delta: string }): boolean {
    const seen = streamingArgs.get(call.id) ?? { head: "", tail: "" };
    const head =
      call.args.length > seen.head.length
        ? call.args.slice(0, MAX_ARG_HEAD)
        : (seen.head + call.delta).slice(0, MAX_ARG_HEAD);
    const rawTail = (call.args.length > seen.tail.length ? call.args : seen.tail + call.delta);
    const tail = rawTail.length > MAX_PREVIEW_CHARS ? rawTail.slice(-MAX_PREVIEW_CHARS) : rawTail;
    streamingArgs.set(call.id, { head, tail });

    const subject = subjectFromPartialArgs(head);
    const preview = previewFromArgTail(call.name, tail);
    const existing = liveSteps.find((step) => step.id === call.id);
    if (existing) {
      const changed = (subject !== null && subject !== existing.subject) || preview !== existing.preview;
      if (!changed) return false;
      if (subject !== null) existing.subject = subject;
      existing.preview = preview;
      return true;
    }
    liveSteps.push({ id: call.id, name: call.name, subject, running: true, isError: false, preview });
    if (liveSteps.length > MAX_LIVE_STEPS) liveSteps = liveSteps.slice(-MAX_LIVE_STEPS);
    return true;
  }

  function showCurrent(ctx: ExtensionContext) {
    if (!ctx || !ctx.hasUI) return;
    publish(ctx);
  }

  function setThinking(
    level: ThinkingLevel,
    ctx: ExtensionContext,
  ) {
    if (!ctx || !ctx.hasUI) return;
    // false = session-only, don't rewrite your global default.
    pi.setThinkingLevel(level, false);

    publish(ctx);
  }

  // --------------------------------------------------
  // /m command
  // --------------------------------------------------

  pi.registerCommand("m", {
    description:
      "Show/set model and thinking level",

    handler: async (args, ctx) => {
      if (!ctx || !ctx.hasUI) return;
      const rawTokens = args
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      // /m or /m status
      if (rawTokens.length === 0 || (rawTokens.length === 1 && rawTokens[0].toLowerCase() === "status")) {
        showCurrent(ctx);
        return;
      }

      let targetModelSpec: string | undefined;
      let targetThinking: ThinkingLevel | undefined;

      let idx = 0;
      while (idx < rawTokens.length) {
        const token = rawTokens[idx];
        const lower = token.toLowerCase();

        if (lower === "status") {
          idx++;
          continue;
        }

        if (lower === "plan" || lower.startsWith("plan:") || lower.startsWith("plan=")) {
          // No extension API can enter or exit plan mode; pretending otherwise
          // is what made the desktop button lie.
          ctx.ui.notify(
            "Plan mode can only be toggled by /plan (Alt+Shift+P) or the PiShift plan button.",
            "warning",
          );
          idx +=
            lower === "plan" &&
            /^(on|off|true|false|1|0)$/.test(rawTokens[idx + 1]?.toLowerCase() ?? "")
              ? 2
              : 1;
          continue;
        }

        const maybeThinking = THINKING_LEVELS[lower];
        if (maybeThinking !== undefined) {
          targetThinking = maybeThinking;
          idx++;
          continue;
        }

        // Otherwise treat as model spec
        targetModelSpec = token;
        idx++;
      }

      // Switch model first so thinking gets clamped against NEW model
      if (targetModelSpec) {
        const model = ctx.models.resolve(targetModelSpec);

        if (!model) {
          ctx.ui.notify(
            `Model not found: ${targetModelSpec}`,
            "error",
          );
          return;
        }

        const success = await pi.setModel(model);

        if (!success) {
          ctx.ui.notify(
            `Could not switch to ${model.provider}/${model.id}. Check authentication.`,
            "error",
          );
          return;
        }
      }

      if (targetThinking !== undefined) {
        pi.setThinkingLevel(targetThinking, false);
      }

      publish(ctx);
      showCurrent(ctx);
    },
  });

  // --------------------------------------------------
  // Direct thinking keybinds
  // --------------------------------------------------

  const shortcuts = [
    ["alt+0", (ThinkingLevel?.Off ?? "off") as ThinkingLevel],
    ["alt+1", (ThinkingLevel?.Minimal ?? "minimal") as ThinkingLevel],
    ["alt+2", (ThinkingLevel?.Low ?? "low") as ThinkingLevel],
    ["alt+3", (ThinkingLevel?.Medium ?? "medium") as ThinkingLevel],
    ["alt+4", (ThinkingLevel?.High ?? "high") as ThinkingLevel],
    ["alt+5", (ThinkingLevel?.XHigh ?? "xhigh") as ThinkingLevel],
    ["alt+6", (ThinkingLevel?.Max ?? "max") as ThinkingLevel],
  ] as const;

  for (const [key, level] of shortcuts) {
    pi.registerShortcut(key, {
      description: `Set thinking to ${level}`,

      handler: (ctx) => {
        if (!ctx || !ctx.hasUI) return;
        setThinking(level, ctx);
      },
    });
  }

  // --------------------------------------------------
  // State/event bridge
  // --------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx || !ctx.hasUI) return;
    running = true;
    activity = "idle";
    tracker.reset();
    stream.clear();
    liveSteps = [];
    streamingArgs.clear();
    jobSnapshots.reset();

    planLeafId = null;
    publish(ctx);

    // Heartbeat so consumers can distinguish
    // "OMP is alive but idle" from a stale file.
    if (!heartbeatStarted) {
      heartbeatStarted = true;

      ctx.setInterval(() => {
        // Always UDP: file-only heartbeats left the desktop UI stuck on idle
        // when a datagram was dropped mid-turn.
        publish(ctx, true);
      }, 2500);

      // `/plan` fires no extension event, so poll the session branch. The
      // leaf-id cache in readPlanMode makes an idle tick one cheap call.
      ctx.setInterval(() => {
        checkAndExecuteCancel(ctx);
        if (readPlanMode(ctx) !== publishedPlanMode) {
          publish(ctx, true);
          return;
        }
        const sig = jobSnapshots
          .read(() => readAvailableJobs(ctx))
          .map((j) => `${j.id}:${j.status}`)
          .join("|");
        if (sig !== publishedJobsSig) publish(ctx, true, "jobs");
      }, 250);
    }
  });

  pi.on("session_switch", async (_event, ctx) => {
    if (!ctx || !ctx.hasUI) return;
    activity = "idle";
    tracker.reset();
    stream.clear();
    liveSteps = [];
    streamingArgs.clear();
    jobSnapshots.reset();
    pendingAsk = null;
    todoState = null;
    planLeafId = null;
    publish(ctx);
  });

  pi.on(
    "before_agent_start",
    async (_event, ctx) => {
      if (!ctx || !ctx.hasUI) return;
      tracker.agentStart();
      stream.clear();
      liveSteps = [];
      streamingArgs.clear();
      syncActivity(ctx);
    },
  );

  pi.on("agent_start", async (_event, ctx) => {
    if (!ctx || !ctx.hasUI) return;
    tracker.agentStart();
    // Last turn's text is now in the transcript; the live row must not repeat it.
    stream.clear();
    liveSteps = [];
    streamingArgs.clear();
    syncActivity(ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    if (!ctx || !ctx.hasUI) return;
    const type = extractStreamEventType(event);
    tracker.stream(type, extractToolName(event));
    const inner =
      event && typeof event === "object" && "assistantMessageEvent" in event
        ? event.assistantMessageEvent
        : event;
    // Deltas only. The in-progress `message` that rides along with this event
    // runs ahead of them, and mixing the two replayed every block from zero on
    // top of itself ("The user wantsThe user wants…").
    const streamChanged = stream.apply(type, inner);
    // A tool call is visible long before it executes: its arguments stream in.
    // Recording it here is what makes a large write show up at all.
    let stepsChanged = false;
    if (type === "toolcall_start" || type === "toolcall_delta" || type === "toolcall_end") {
      const call = extractStreamingCall(inner);
      if (call) stepsChanged = upsertStreamingStep(call);
    }
    // `ctx.setTimeout` does not run until an agent turn yields. Deferring
    // deltas through it therefore turns streaming into an end-of-turn update.
    // Each changed local UDP packet is cheap and is the only truthful way to
    // paint reasoning and text as they are produced.
    syncActivity(ctx);
    if (stepsChanged || (streamChanged && stream.read())) publish(ctx, true, "session", false);
  });

  pi.on(
    "tool_execution_start",
    async (event, ctx) => {
      if (!ctx || !ctx.hasUI) return;
      const toolName = extractToolName(event);
      const key = toolCallKey(event, toolName);
      tracker.toolStart(key, toolName);
      const args =
        event && typeof event === "object"
          ? ("args" in event ? event.args : "arguments" in event ? event.arguments : undefined)
          : undefined;
      // The row may already exist from the argument-streaming phase, under the
      // id of its message block. Adopt it instead of opening a second row for
      // the same call.
      const streamed = liveSteps.find((step) => step.id !== key && step.name === toolName && step.running);
      const target = liveSteps.find((step) => step.id === key) ?? streamed;
      const subject = extractStepSubject(args);
      if (target) {
        target.id = key;
        target.running = true;
        if (subject) target.subject = subject;
        // Arguments are complete now, so the streaming tail stops being news.
        target.preview = null;
      } else {
        liveSteps.push({ id: key, name: toolName ?? "tool", subject, running: true, isError: false, preview: null });
        if (liveSteps.length > MAX_LIVE_STEPS) liveSteps = liveSteps.slice(-MAX_LIVE_STEPS);
      }
      syncActivity(ctx, true);

      if (
        event &&
        typeof event === "object" &&
        "toolName" in event &&
        event.toolName === "ask" &&
        "toolCallId" in event &&
        typeof event.toolCallId === "string"
      ) {
        let questions = normalizeAskQuestions(
          args && typeof args === "object" && "questions" in args ? args.questions : undefined,
        );
        if (questions.length === 0 && args && typeof args === "object") {
          // Also support single-question arguments format { question, options, id, multi, recommended }
          questions = normalizeAskQuestions([args]);
        }
        if (questions.length > 0) {
          pendingAsk = { toolCallId: event.toolCallId, questions };
          publish(ctx);
        }
      }
    },
  );

  pi.on("tool_execution_update", async (event, ctx) => {
    if (!ctx || !ctx.hasUI) return;
    const toolName = extractToolName(event);
    tracker.toolUpdate(toolCallKey(event, toolName), toolName);
    syncActivity(ctx);
  });

  pi.on(
    "tool_execution_end",
    async (event, ctx) => {
      if (!ctx || !ctx.hasUI) return;
      const endedKey = toolCallKey(event, extractToolName(event));
      tracker.toolEnd(endedKey);
      const ended = liveSteps.find((step) => step.id === endedKey);
      if (ended) {
        ended.running = false;
        ended.isError =
          Boolean(event) && typeof event === "object" && "isError" in event && event.isError === true;
      }
      syncActivity(ctx, true);
      if (
        pendingAsk &&
        event &&
        typeof event === "object" &&
        "toolCallId" in event &&
        event.toolCallId === pendingAsk.toolCallId
      ) {
        pendingAsk = null;
        publish(ctx);
      }

      if (
        event &&
        typeof event === "object" &&
        "toolName" in event &&
        event.toolName === "todo" &&
        "result" in event &&
        event.result &&
        typeof event.result === "object" &&
        "details" in event.result &&
        event.result.details &&
        typeof event.result.details === "object" &&
        "phases" in event.result.details
      ) {
        const phases = normalizeTodoPhases(event.result.details.phases);
        if (phases) {
          todoState = phases;
          publish(ctx);
        }
      }
    },
  );

  pi.on("agent_end", async (event, ctx) => {
    if (!ctx || !ctx.hasUI) return;
    pendingAsk = null;
    const willContinue =
      Boolean(event) && typeof event === "object" && "willContinue" in event && event.willContinue === true;
    tracker.agentEnd(willContinue);
    // omp has persisted the message by now; the transcript owns it from here.
    stream.clear();
    liveSteps = [];
    streamingArgs.clear();
    syncActivity(ctx, true);
  });

  pi.on(
    "session_shutdown",
    async (_event, ctx) => {
      if (!ctx || !ctx.hasUI) return;

      running = false;
      activity = "idle";
      tracker.reset();
      stream.clear();
      liveSteps = [];
      streamingArgs.clear();

      publish(ctx);

      try {
        udp?.close();
      } catch {
        // Already closed.
      }
    },
  );
}
