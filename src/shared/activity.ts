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
export type AgentActivity =
  | "idle"
  | "waiting"
  | "thinking"
  | "responding"
  | "reading"
  | "editing"
  | "running"
  | "working";

/** omp 18 `BUILTIN_TOOL_NAMES` plus its `search`/`find` aliases. */
export const TOOL_ACTIVITY: Record<string, AgentActivity> = {
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

export function classifyToolActivity(rawToolName: string): AgentActivity {
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
export function extractStreamEventType(event: unknown): string | undefined {
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

export function extractToolName(event: unknown): string | undefined {
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
export class ActivityTracker {
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
