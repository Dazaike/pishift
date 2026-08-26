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
    const id = "id" in j && typeof j.id === "string" ? j.id : "";
    if (!id) continue;
    out.push({
      id,
      type: "type" in j && typeof j.type === "string" ? j.type : "job",
      status: "status" in j && typeof j.status === "string" ? j.status : "running",
      label: "label" in j && typeof j.label === "string" ? j.label : id,
      startTime: "startTime" in j && typeof j.startTime === "number" ? j.startTime : 0,
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

/** Subset of omp's session manager used to derive plan mode. */
interface SessionManagerLike {
  getLeafId?: () => string | undefined;
  getBranch?: () => unknown[] | undefined;
}

type BridgeUpdateKind = "session" | "jobs";

interface BridgeState {
  /**
   * Job registry polling is independent of the terminal session lifecycle.
   * Consumers must keep job updates out of session/model/thinking state.
   */
  updateKind: BridgeUpdateKind;
  running: boolean;
  activity: AgentActivity;
  model: string | null;
  thinkingLevel: string;
  planMode: PlanMode;
  ask: PendingAsk | null;
  todo: TodoPhase[] | null;
  jobs: AsyncJob[];
  pid: number;
  cwd: string | null;
  /** Matches host `OMPHIF_SESSION_ID` so multi-tab chrome can route activity. */
  sessionId: string | null;
  updatedAt: string;
}

const STATUS_FILE = join(
  homedir(),
  ".omp",
  "agent",
  "runtime-status.json",
);

const CANCEL_REQUEST_FILE = join(
  homedir(),
  ".omp",
  "agent",
  "cancel-job.json",
);

const UDP_HOST = "127.0.0.1";
const UDP_PORT = 37991;
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
  const sessionId = process.env.OMPHIF_SESSION_ID?.trim() || null;
  if (!sessionId) return;

  let activity: AgentActivity = "idle";
  const tracker = new ActivityTracker();
  const jobSnapshots = new AuthoritativeSnapshotCache<AsyncJob>();
  let lastActivityPublish = 0;
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
      updatedAt: new Date().toISOString(),
    };
  }

  function publish(
    ctx: ExtensionContext,
    sendUdp = true,
    updateKind: BridgeUpdateKind = "session",
  ) {
    if (!ctx || !ctx.hasUI) return;
    const state = makeState(ctx, updateKind);
    publishedPlanMode = state.planMode;
    publishedJobsSig = state.jobs.map((j) => `${j.id}:${j.status}`).join("|");
    const json = JSON.stringify(state);

    mkdirSync(dirname(STATUS_FILE), {
      recursive: true,
    });

    // Pretty JSON makes manual inspection less miserable.
    writeFileSync(
      STATUS_FILE,
      JSON.stringify(state, null, 2),
      "utf8",
    );


    if (sendUdp) {
      try {
        const socket = getUdp();

        socket.send(
          Buffer.from(json),
          UDP_PORT,
          UDP_HOST,
        );
      } catch {
        // UDP telemetry should never break OMP.
      }
    }
  }

  /** Coalesced activity publish: never faster than 120 ms, never drops the last state. */
  const ACTIVITY_MIN_INTERVAL_MS = 120;

  function syncActivity(ctx: ExtensionContext) {
    if (!ctx || !ctx.hasUI) return;
    const next = tracker.activity;
    if (next === activity) return;
    activity = next;

    const now = Date.now();
    // Idle ends the turn; publish it immediately so the glow stops on time.
    if (next === "idle" || now - lastActivityPublish >= ACTIVITY_MIN_INTERVAL_MS) {
      lastActivityPublish = now;
      publish(ctx, true);
      return;
    }
    if (activityPublishPending) return;
    activityPublishPending = true;
    ctx.setTimeout(
      () => {
        activityPublishPending = false;
        lastActivityPublish = Date.now();
        publish(ctx, true);
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
      syncActivity(ctx);
    },
  );

  pi.on("agent_start", async (_event, ctx) => {
    if (!ctx || !ctx.hasUI) return;
    tracker.agentStart();
    syncActivity(ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    if (!ctx || !ctx.hasUI) return;
    tracker.stream(extractStreamEventType(event), extractToolName(event));
    syncActivity(ctx);
  });

  pi.on(
    "tool_execution_start",
    async (event, ctx) => {
      if (!ctx || !ctx.hasUI) return;
      const toolName = extractToolName(event);
      tracker.toolStart(toolCallKey(event, toolName), toolName);
      syncActivity(ctx);

      if (
        event &&
        typeof event === "object" &&
        "toolName" in event &&
        event.toolName === "ask" &&
        "toolCallId" in event &&
        typeof event.toolCallId === "string"
      ) {
        const args = "args" in event ? event.args : ("arguments" in event ? event.arguments : undefined);
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
      tracker.toolEnd(toolCallKey(event, extractToolName(event)));
      syncActivity(ctx);
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
    syncActivity(ctx);
  });

  pi.on(
    "session_shutdown",
    async (_event, ctx) => {
      if (!ctx || !ctx.hasUI) return;

      running = false;
      activity = "idle";
      tracker.reset();

      publish(ctx);

      try {
        udp?.close();
      } catch {
        // Already closed.
      }
    },
  );
}
