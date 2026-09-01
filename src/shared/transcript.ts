/**
 * omp session transcript model.
 *
 * omp appends one JSON object per line to
 * `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl`. Entries
 * form an append-only *tree* keyed by `id`/`parentId`, so file order is not the
 * conversation: the displayed conversation is the parent chain walked back from
 * the newest entry. Branches created by `/branch` therefore fall away on their
 * own once the leaf moves.
 *
 * Shared between main (which tails the file) and renderer (which draws it) so a
 * single contract governs both, and so the parse is unit-testable under vitest's
 * node environment.
 */

export type TranscriptRole = "user" | "assistant" | "tool";

export type TranscriptPart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "image"; src: string; mimeType: string }
  /**
   * One tool invocation *and* its outcome. The call and its result arrive as
   * separate transcript entries; they are merged here so the view shows one
   * card per tool instead of two. `result === null` means still running.
   */
  | {
      kind: "tool";
      callId: string | null;
      name: string;
      intent: string | null;
      args: string;
      result: string | null;
      isError: boolean;
    };

export interface TranscriptEntry {
  /** omp entry id; stable dedupe key for incremental rendering. */
  id: string;
  role: TranscriptRole;
  /** Epoch ms, or 0 when the entry carried no usable timestamp. */
  at: number;
  /** Assistant model name when the entry recorded one. */
  model: string | null;
  parts: TranscriptPart[];
}

export interface TranscriptMarker {
  id: string;
  /** "compaction" renders a summary divider; "reset" renders a `/clear` divider. */
  kind: "compaction" | "reset";
  at: number;
  text: string;
}

export type TranscriptRow =
  | { type: "entry"; entry: TranscriptEntry }
  | { type: "marker"; marker: TranscriptMarker };

export interface TranscriptSnapshot {
  /** PiShift PTY session id this snapshot belongs to. */
  ptySessionId: string;
  /** Resolved omp session id, or null when none was published or discovered. */
  ompSessionId: string | null;
  /** Absolute JSONL path, or null while the session is still memory-only. */
  file: string | null;
  /** true = replace everything rendered; false = append `rows` after the last rendered row. */
  replace: boolean;
  rows: TranscriptRow[];
}

/** Assistant/user/toolResult payload as omp writes it. */
interface RawMessage {
  role?: unknown;
  model?: unknown;
  toolName?: unknown;
  toolCallId?: unknown;
  isError?: unknown;
  content?: unknown;
}

/** One `message.content[]` element; the union is discriminated by `type`. */
interface RawPart {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  data?: unknown;
  mimeType?: unknown;
  id?: unknown;
  name?: unknown;
  intent?: unknown;
  arguments?: unknown;
}

/**
 * A parsed JSONL entry that participates in the session tree.
 *
 * Kept as the tailer's unit of accumulation: re-parsing the whole file on every
 * poll tick would cost thousands of `JSON.parse` calls per second in the main
 * process, so lines are parsed once and rows are rebuilt from the nodes.
 */
export interface TranscriptNode {
  type: string;
  id: string;
  parentId: string | null;
  timestamp?: string | number;
  message?: RawMessage;
  customType?: string;
  summary?: string;
  shortSummary?: string;
}

/**
 * Parse one JSONL line into a tree node, or null when the line is unusable.
 *
 * Returns null for malformed JSON, for the fixed-width `type:"title"` slot omp
 * reserves at the head of the file, for the `type:"session"` header (it carries
 * the session id rather than conversation content), and for anything lacking an
 * `id` — such an entry can never be reached by a parent-chain walk.
 */
export function parseTranscriptLine(line: string): TranscriptNode | null {
  if (!line) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }

  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== "string" || type === "title" || type === "session") return null;
  if (typeof obj.id !== "string" || !obj.id) return null;

  const message = obj.message && typeof obj.message === "object"
    ? obj.message as RawMessage
    : undefined;

  return {
    type,
    id: obj.id,
    parentId: typeof obj.parentId === "string" ? obj.parentId : null,
    timestamp: typeof obj.timestamp === "string" || typeof obj.timestamp === "number"
      ? obj.timestamp
      : undefined,
    message,
    customType: typeof obj.customType === "string" ? obj.customType : undefined,
    summary: typeof obj.summary === "string" ? obj.summary : undefined,
    shortSummary: typeof obj.shortSummary === "string" ? obj.shortSummary : undefined,
  };
}

function entryTime(node: TranscriptNode): number {
  if (typeof node.timestamp === "number") return Number.isFinite(node.timestamp) ? node.timestamp : 0;
  if (typeof node.timestamp !== "string") return 0;
  const ms = Date.parse(node.timestamp);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Join the text of every `content[]` part, tolerating a bare-string `content`. */
function joinContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const chunks: string[] = [];
  for (const part of content as RawPart[]) {
    if (part && typeof part.text === "string" && part.text) chunks.push(part.text);
  }
  return chunks.join("\n");
}

function userParts(content: unknown): TranscriptPart[] {
  if (typeof content === "string") {
    return content ? [{ kind: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const parts: TranscriptPart[] = [];
  for (const part of content as RawPart[]) {
    if (!part) continue;
    if (part.type === "image" && typeof part.data === "string" && part.data) {
      parts.push({
        kind: "image",
        src: part.data,
        mimeType: typeof part.mimeType === "string" && part.mimeType ? part.mimeType : "image/png",
      });
    } else if (typeof part.text === "string" && part.text) {
      parts.push({ kind: "text", text: part.text });
    }
  }
  return parts;
}

function assistantParts(content: unknown, results: ToolResults | null): TranscriptPart[] {
  if (typeof content === "string") {
    return content ? [{ kind: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const parts: TranscriptPart[] = [];
  for (const part of content as RawPart[]) {
    if (!part) continue;

    if (part.type === "thinking") {
      // The payload lives in `thinking`, never in `text`.
      if (typeof part.thinking === "string" && part.thinking) {
        parts.push({ kind: "thinking", text: part.thinking });
      }
      continue;
    }

    if (part.type === "toolCall") {
      let args = "";
      try {
        args = part.arguments === undefined ? "" : JSON.stringify(part.arguments, null, 2) ?? "";
      } catch {
        args = "";
      }
      const callId = typeof part.id === "string" ? part.id : null;
      const outcome = callId ? results?.get(callId) : undefined;
      parts.push({
        kind: "tool",
        callId,
        name: typeof part.name === "string" && part.name ? part.name : "tool",
        intent: typeof part.intent === "string" && part.intent ? part.intent : null,
        args,
        // Absent while the tool is still executing; the next poll fills it in.
        result: outcome ? outcome.text : null,
        isError: outcome ? outcome.isError : false,
      });
      continue;
    }

    if (typeof part.text === "string" && part.text) parts.push({ kind: "text", text: part.text });
  }
  return parts;
}

/** Map a `type:"message"` node to a display entry, or null when it carries nothing to show. */
function messageEntry(node: TranscriptNode, results: ToolResults | null): TranscriptEntry | null {
  const msg = node.message;
  if (!msg) return null;

  const at = entryTime(node);
  const role = msg.role;

  if (role === "user") {
    const parts = userParts(msg.content);
    return parts.length ? { id: node.id, role: "user", at, model: null, parts } : null;
  }

  if (role === "assistant") {
    const parts = assistantParts(msg.content, results);
    if (!parts.length) return null;
    return {
      id: node.id,
      role: "assistant",
      at,
      model: typeof msg.model === "string" && msg.model ? msg.model : null,
      parts,
    };
  }

  if (role === "toolResult") {
    return {
      id: node.id,
      role: "tool",
      at,
      model: null,
      parts: [{
        kind: "tool",
        callId: typeof msg.toolCallId === "string" ? msg.toolCallId : null,
        name: typeof msg.toolName === "string" && msg.toolName ? msg.toolName : "tool",
        intent: null,
        args: "",
        result: joinContentText(msg.content),
        isError: msg.isError === true,
      }],
    };
  }

  return null;
}

/** Tool outcomes indexed by `toolCallId`, so a call can absorb its own result. */
type ToolResults = Map<string, { text: string; isError: boolean }>;

/**
 * Index every tool result in the chain, and note which calls claim one.
 *
 * A result whose call is absent (compaction dropped it, or the chain starts
 * mid-turn) still has to render, so the claimed set is tracked separately
 * rather than inferred from the map.
 */
function indexToolResults(chain: readonly TranscriptNode[]): {
  results: ToolResults;
  claimed: Set<string>;
} {
  const results: ToolResults = new Map();
  const claimed = new Set<string>();

  for (const node of chain) {
    const msg = node.message;
    if (node.type !== "message" || !msg) continue;

    if (msg.role === "toolResult" && typeof msg.toolCallId === "string") {
      results.set(msg.toolCallId, {
        text: joinContentText(msg.content),
        isError: msg.isError === true,
      });
      continue;
    }

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content as RawPart[]) {
        if (part && part.type === "toolCall" && typeof part.id === "string") claimed.add(part.id);
      }
    }
  }

  return { results, claimed };
}

/**
 * Consecutive tool-only assistant messages are one uninterrupted piece of
 * activity, not separate conversational turns. Collapse them into a single
 * entry so the renderer can present one expandable tool group.
 *
 * Keep the first entry id: it is stable while more tool calls and outcomes
 * arrive. The watcher compares row content as well as ids, so a completed tool
 * still replaces this row with its final state.
 */
function groupToolOnlyEntries(rows: TranscriptRow[]): TranscriptRow[] {
  const grouped: TranscriptRow[] = [];

  for (const row of rows) {
    if (
      row.type === "entry"
      && row.entry.role === "assistant"
      && row.entry.parts.length > 0
      && row.entry.parts.every((part) => part.kind === "tool")
    ) {
      const previous = grouped[grouped.length - 1];
      if (
        previous?.type === "entry"
        && previous.entry.role === "assistant"
        && previous.entry.parts.every((part) => part.kind === "tool")
      ) {
        previous.entry.parts.push(...row.entry.parts);
        continue;
      }
    }
    grouped.push(row);
  }

  return grouped;
}

/**
 * Walk the parent chain back from the newest node, newest-last.
 *
 * A `Set` of visited ids bounds the walk: a truncated or corrupt file can
 * contain a `parentId` cycle, and an unguarded walk would hang the poll tick.
 */
function parentChain(nodes: readonly TranscriptNode[]): TranscriptNode[] {
  if (!nodes.length) return [];

  const byId = new Map<string, TranscriptNode>();
  for (const node of nodes) byId.set(node.id, node);

  const chain: TranscriptNode[] = [];
  const seen = new Set<string>();
  let cursor: TranscriptNode | undefined = nodes[nodes.length - 1];

  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  chain.reverse();
  return chain;
}

/**
 * Build display rows from parsed nodes.
 *
 * Two entries are deliberately never rendered on their own:
 * - `custom`/`tool_execution_start`, because the assistant's `toolCall` part
 *   already names the tool, its intent and its arguments;
 * - a `toolResult` whose call is in the same chain, because the result is
 *   folded into that call's card. One tool, one card.
 */
export function buildTranscriptRows(nodes: readonly TranscriptNode[]): TranscriptRow[] {
  const chain = parentChain(nodes);

  // `/clear` writes a reset boundary; everything before the newest one is gone
  // from the model's context and must not be shown as if it were still live.
  let start = 0;
  let reset: TranscriptNode | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].type === "reset_boundary") {
      reset = chain[i];
      start = i + 1;
      break;
    }
  }

  const rows: TranscriptRow[] = [];
  if (reset) {
    rows.push({
      type: "marker",
      marker: { id: reset.id, kind: "reset", at: entryTime(reset), text: "Context cleared" },
    });
  }

  const { results, claimed } = indexToolResults(chain);

  for (let i = start; i < chain.length; i++) {
    const node = chain[i];

    if (node.type === "message") {
      const callId = node.message?.toolCallId;
      // Folded into the call's card above; rendering it again would double up.
      if (node.message?.role === "toolResult" && typeof callId === "string" && claimed.has(callId)) {
        continue;
      }
      const entry = messageEntry(node, results);
      if (entry) rows.push({ type: "entry", entry });
      continue;
    }

    if (node.type === "compaction") {
      rows.push({
        type: "marker",
        marker: {
          id: node.id,
          kind: "compaction",
          at: entryTime(node),
          text: node.shortSummary || node.summary || "Context compacted",
        },
      });
    }
  }

  return groupToolOnlyEntries(rows);
}

/** Row identity, used to decide whether an update can append instead of replace. */
export function transcriptRowId(row: TranscriptRow): string {
  return row.type === "entry" ? row.entry.id : row.marker.id;
}
