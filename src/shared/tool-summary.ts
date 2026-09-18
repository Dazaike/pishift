/**
 * Turns raw tool calls into short, human-readable activity lines.
 *
 * Chat Mode prints tool work at two densities, so the phrasing has to exist
 * independently of the DOM that shows it. Keeping this pure also makes the
 * awkward parts — patch parsing, malformed payloads — testable under vitest's
 * node environment instead of through DOM assertions.
 */

import { classifyToolActivity, normalizeToolKey } from "./activity";
import type { TranscriptPart } from "./transcript";

export type ToolPart = Extract<TranscriptPart, { kind: "tool" }>;

/**
 * How much tool activity Chat Mode prints. Persisted as `toolDensity`.
 * Density decides only what starts expanded — never the visual container.
 */
export type ToolDensity = "compact" | "detailed";

export const TOOL_DENSITIES: readonly ToolDensity[] = ["compact", "detailed"];

export function isToolDensity(value: unknown): value is ToolDensity {
  return typeof value === "string" && (TOOL_DENSITIES as readonly string[]).includes(value);
}

/** Bucket used when counting a burst. */
export type ToolActionKind = "edit" | "read" | "search" | "run" | "other";

export interface ToolAction {
  kind: ToolActionKind;
  /** Leading word, rendered bold: "Edited", "Ran", "Read", "Searched", "Used"… */
  verb: string;
  /** Muted subject after the verb: file name, intent, pattern, or tool name. */
  subject: string;
  /** Monospace tail: the shell command, or null. */
  detail: string | null;
  /** Line counts when the payload states them outright, else null. */
  added: number | null;
  removed: number | null;
  /** Verbatim added lines for the detailed diff, capped at MAX_DIFF_LINES. */
  addedLines: string[];
  /** Inclusive line spans the patch replaced; the old text is never in the payload. */
  removedRanges: Array<[number, number]>;
  running: boolean;
  isError: boolean;
  /** Originating call, so a row can still expose the raw payload on expand. */
  part: ToolPart;
}

/** Longest raw payload echoed into a raw-text expansion. */
const RAW_RESULT_CHARS = 4000;

/**
 * Lightweight, developer-facing rendering of one action: what ran, which file
 * and line range it touched, and the content it actually wrote or read. Used by
 * Compact's "Show Raw Text on Expand"; the polished body renders the same
 * action. Tool acknowledgements ("Successfully wrote 35 bytes") are dropped —
 * the point of the raw view is the payload, not the harness chatter.
 */
export function rawToolText(action: ToolAction): string {
  const args = parseArgs(action.part);
  const target = typeof args.path === "string" ? args.path : action.subject;
  const out: string[] = [`${action.verb} ${target}`.trim()];

  const range = lineRange(typeof args.path === "string" ? args.path : "");
  if (range) out.push(range);
  const counts: string[] = [];
  if (action.removed) counts.push(`-${action.removed}`);
  if (action.added) counts.push(`+${action.added}`);
  if (counts.length) out.push(`${counts.join(" ")} lines`);

  switch (action.kind) {
    case "run": {
      const command = typeof args.command === "string" ? args.command : null;
      if (command) out.push("", command);
      pushBody(out, action.part.result);
      break;
    }
    case "edit": {
      // Only the change itself: removals are a count (the patch carries new
      // text only), additions are the literal lines.
      out.push("");
      if (action.removed) out.push(`- ${action.removed} lines replaced`);
      for (const line of action.addedLines) out.push(`+ ${line}`);
      const content = typeof args.content === "string" ? args.content : null;
      if (!action.removed && !action.addedLines.length && content) pushBody(out, content);
      break;
    }
    default:
      // Read/search/other: the content that came back is the interesting part;
      // a write echoes what it wrote, which its result never contains.
      pushBody(out, typeof args.content === "string" ? args.content : action.part.result);
  }

  return out.join("\n");
}

function pushBody(out: string[], body: string | null): void {
  if (body === null || body === "") return;
  out.push("", body.length > RAW_RESULT_CHARS ? `${body.slice(0, RAW_RESULT_CHARS)}\n\u2026 (truncated)` : body);
}

/** Plural noun per bucket, used by the activity header. */
const KIND_NOUNS: Record<ToolActionKind, [string, string]> = {
  edit: ["edit", "edits"],
  read: ["read", "reads"],
  search: ["search", "searches"],
  run: ["command", "commands"],
  other: ["tool call", "tool calls"],
};

/**
 * Header summary for an activity section: `1 read`, `2 edits, 1 command`.
 * Thinking is not a tool, so it never appears here — an all-thinking sequence
 * returns an empty string and the header shows nothing.
 */
export function activitySummary(kinds: readonly ToolActionKind[]): string {
  const order: ToolActionKind[] = ["edit", "read", "search", "run", "other"];
  const counts = new Map<ToolActionKind, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return order
    .filter((kind) => counts.has(kind))
    .map((kind) => {
      const n = counts.get(kind) ?? 0;
      const [one, many] = KIND_NOUNS[kind];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(", ");
}

/** `src/foo.ts:24-61` -> `Lines 24\u201361`; omp read selectors carry the range. */
function lineRange(path: string): string | null {
  const match = /:(\d+)-(\d+)\s*$/.exec(path.trim());
  return match ? `Lines ${match[1]}\u2013${match[2]}` : null;
}

/**
 * `Lines 12\u201349` for a read: from the path selector when omp was given one,
 * else from the line numbers the reader itself printed. Null when the payload
 * carries no numbering (a URL fetch, a directory listing).
 */
export function readRangeLabel(action: ToolAction): string | null {
  const args = parseArgs(action.part);
  const selector = lineRange(typeof args.path === "string" ? args.path : "");
  if (selector) return selector;

  const result = action.part.result;
  if (!result) return null;
  let first: string | null = null;
  let last: string | null = null;
  for (const line of result.split("\n")) {
    const match = /^\s*(\d+)[:|]/.exec(line);
    if (!match) continue;
    if (first === null) first = match[1];
    last = match[1];
  }
  return first !== null && last !== null && first !== last ? `Lines ${first}\u2013${last}` : null;
}

/**
 * omp rewrites an older read's result to `[Superseded by …]` once the same file
 * is read again, so the stale copy stops costing context. That placeholder is a
 * note about the transcript, not file content, and must not render as one.
 */
export function isSupersededResult(result: string | null): boolean {
  return result !== null && /^\s*\[Superseded by [^\]]*\]\s*$/.test(result);
}

/** Added lines kept per action; a large patch must not bloat every row. */
export const MAX_DIFF_LINES = 200;

const SUBJECT_CLIP = 48;
const COMMAND_CLIP = 72;

/** `src/foo.ts:50-200` -> `foo.ts`; omp paths carry read selectors. */
function fileName(raw: string): string {
  const segment = raw.trim().split(/[\\/]/).pop() ?? raw;
  const selector = segment.indexOf(":");
  return selector > 0 ? segment.slice(0, selector) : segment;
}

/** `mcp__chrome_devtools__list_pages` -> `list pages`. */
function displayName(raw: string): string {
  return normalizeToolKey(raw).replace(/_/g, " ");
}

/** One malformed payload must not blank a transcript, so parsing never throws. */
function parseArgs(part: ToolPart): Record<string, unknown> {
  if (!part.args) return {};
  try {
    const parsed: unknown = JSON.parse(part.args);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
}

function makeAction(
  part: ToolPart,
  kind: ToolActionKind,
  verb: string,
  subject: string,
  detail: string | null = null,
): ToolAction {
  return {
    kind,
    verb,
    subject,
    detail,
    added: null,
    removed: null,
    addedLines: [],
    removedRanges: [],
    running: part.result === null,
    isError: part.isError,
    part,
  };
}

const FALLBACK: Record<string, { kind: ToolActionKind; verb: string }> = {
  editing: { kind: "edit", verb: "Edited" },
  reading: { kind: "read", verb: "Read" },
  running: { kind: "run", verb: "Ran" },
  working: { kind: "other", verb: "Used" },
};

/** One action per edited file (a patch may touch several); otherwise exactly one. */
export function summarizeToolPart(part: ToolPart): ToolAction[] {
  const key = normalizeToolKey(part.name);
  const args = parseArgs(part);
  const name = displayName(part.name);
  const intent = str(part.intent);
  const fallbackSubject = intent ?? name;

  switch (key) {
    case "edit":
      return summarizeEdit(part, args, fallbackSubject);

    case "write": {
      const path = str(args.path);
      const action = makeAction(part, "edit", "Wrote", path ? fileName(path) : fallbackSubject);
      if (typeof args.content === "string") {
        // A write is an all-green diff: the content it wrote is the change, so
        // the row shows the same evidence an edit does instead of raw JSON.
        const lines = args.content.replace(/\n$/, "").split("\n");
        action.added = lines.length;
        action.addedLines = lines.slice(0, MAX_DIFF_LINES);
      }
      return [action];
    }

    case "ast_edit": {
      const paths = Array.isArray(args.paths)
        ? args.paths.filter((entry): entry is string => typeof entry === "string")
        : [];
      const first = paths.length ? fileName(paths[0]) : fallbackSubject;
      const subject = paths.length > 1 ? `${first} +${paths.length - 1} more` : first;
      return [makeAction(part, "edit", "Edited", subject)];
    }

    case "bash": {
      const command = str(args.command);
      const subject = intent ?? str(args.i) ?? "command";
      const detail = command ? clip(command.split("\n")[0], COMMAND_CLIP) : null;
      return [makeAction(part, "run", "Ran", subject, detail)];
    }

    case "read": {
      const path = str(args.path);
      return [makeAction(part, "read", "Read", path ? fileName(path) : fallbackSubject)];
    }

    case "grep": {
      const pattern = str(args.pattern);
      const path = str(args.path);
      return [makeAction(
        part,
        "search",
        "Searched",
        pattern ? clip(pattern, SUBJECT_CLIP) : fallbackSubject,
        path ? fileName(path) : null,
      )];
    }

    case "glob": {
      const target = str(args.path) ?? str(args.pattern);
      return [makeAction(part, "search", "Globbed", target ? clip(target, SUBJECT_CLIP) : fallbackSubject)];
    }

    case "web_search": {
      const query = str(args.query);
      return [makeAction(part, "search", "Searched the web", query ? clip(query, SUBJECT_CLIP) : fallbackSubject)];
    }

    case "lsp": {
      const target = str(args.symbol) ?? str(args.file) ?? str(args.action);
      return [makeAction(part, "read", "Inspected", target ? clip(target, SUBJECT_CLIP) : fallbackSubject)];
    }

    case "task":
      return [makeAction(part, "other", "Delegated", intent ?? "subagents")];

    case "todo":
      return [makeAction(part, "other", "Planned", intent ?? str(args.op) ?? name)];

    default: {
      const { kind, verb } = FALLBACK[classifyToolActivity(part.name)] ?? FALLBACK.working;
      return [makeAction(part, kind, verb, fallbackSubject)];
    }
  }
}

/**
 * Patch sections of omp's hashline language. The payload carries the new text
 * only, so `added` is exact while `removed` can only be counted from explicit
 * `N.=M` ranges — block ops never state their span and are not guessed at.
 */
function summarizeEdit(
  part: ToolPart,
  args: Record<string, unknown>,
  fallbackSubject: string,
): ToolAction[] {
  const input = typeof args.input === "string" ? args.input : "";
  const actions: ToolAction[] = [];
  let current: ToolAction | null = null;

  for (const raw of input.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const header = /^\[(.+?)#[0-9A-Fa-f]{4}\]$/.exec(line.trim());
    if (header) {
      current = makeAction(part, "edit", "Edited", fileName(header[1]));
      current.added = 0;
      current.removed = 0;
      actions.push(current);
      continue;
    }
    if (!current) continue;

    if (line.startsWith("+")) {
      current.added = (current.added ?? 0) + 1;
      if (current.addedLines.length < MAX_DIFF_LINES) current.addedLines.push(line.slice(1));
      continue;
    }

    const range = /^(?:PUT|CUT)\s+(\d+)\.=(\d+)/.exec(line);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
        current.removed = (current.removed ?? 0) + (to - from + 1);
        // The payload never carries the old text, so the line span is the only
        // honest thing a removal row can name.
        current.removedRanges.push([from, to]);
      }
      continue;
    }

    if (/^MV\s/.test(line)) current.verb = "Moved";
    else if (/^REM\s*$/.test(line)) current.verb = "Deleted";
  }

  if (!actions.length) return [makeAction(part, "edit", "Edited", fallbackSubject)];
  return actions;
}

export function summarizeToolParts(parts: readonly ToolPart[]): ToolAction[] {
  const actions: ToolAction[] = [];
  for (const part of parts) actions.push(...summarizeToolPart(part));
  return actions;
}

