/**
 * Stylized conversation view rendered over the terminal.
 *
 * Presentation only: the PTY keeps running underneath and every input path
 * (dock composer, ask sheets, slash menu) is untouched, so reverting to the raw
 * terminal is instant and lossless. Content comes from omp's own on-disk
 * transcript via `TranscriptWatcher`, never from scraping the terminal buffer.
 */

import {
  GLOW_ACTIVITY_LABELS,
  type ControlBridgeActivity,
  type ControlBridgeStep,
  type ControlBridgeStream,
  type GlowActivity,
  type PendingAsk,
} from "../shared/ipc";
import { classifyToolActivity } from "../shared/activity";
import type { AskAnswer } from "../shared/ask-keys";
import { formatElapsed } from "../shared/elapsed";
import { renderMarkdown } from "../shared/markdown";
import type { PlanMode } from "../shared/plan-mode";
import type { TranscriptEntry, TranscriptPart, TranscriptRow, TranscriptSnapshot } from "../shared/transcript";
import {
  activitySummary,
  isSupersededResult,
  rawToolText,
  readRangeLabel,
  summarizeToolParts,
  type ToolAction,
  type ToolActionKind,
  type ToolDensity,
  type ToolPart,
} from "../shared/tool-summary";
import { ActivityOrb } from "./activity-orb";
import { ChatInlineAsk } from "./chat-inline-ask";
import type { PlanReviewAction } from "./plan-review-modal";

/** Rows kept in the DOM; older rows load on demand rather than all at once. */
const WINDOW_ROWS = 400;
/** A result longer than this is clipped — the terminal remains the full record. */
const MAX_RESULT_CHARS = 20_000;
/** Distance from the bottom still counted as "following the conversation". */
const PIN_SLACK_PX = 40;
/** How long a finished reply stays on screen while the transcript tail catches up. */
const LIVE_SETTLE_MS = 3000;

export const MIN_CHAT_ZOOM = 0.75;
export const MAX_CHAT_ZOOM = 1.75;
export const DEFAULT_CHAT_ZOOM = 1;
const CHAT_ZOOM_STEP = 0.1;

export function clampChatZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CHAT_ZOOM;
  return Math.min(MAX_CHAT_ZOOM, Math.max(MIN_CHAT_ZOOM, Math.round(zoom * 100) / 100));
}

/**
 * One-line glimpse of a thinking block, used as its collapsed `<details>`
 * summary so compact density still shows real content instead of a bare
 * "Thought" label — `.chat-summary-text` handles the visual cutoff via CSS
 * ellipsis, so this only flattens the text, it does not pick a length.
 *
 * Emphasis markers are stripped rather than rendered: the summary is one plain
 * line, and leaving them in printed `**Planning…**` on screen.
 */
function thinkingPreview(text: string): string {
  const collapsed = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed || "Thought";
}

/**
 * Whether two reasoning texts are the same thought. Equality is not enough: the
 * bridge caps its buffer and keeps the tail, so the live copy of a long thought
 * is a window into the persisted one rather than a byte-identical twin.
 */
function sameReasoning(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (left === "" || right === "") return false;
  return left === right || left.includes(right) || right.includes(left);
}

export interface ChatViewHooks {
  copyText(text: string): void;
  openExternal(url: string): void;
  /** Resolve a local attachment path to a preview data URL, or null when unavailable. */
  resolveLocalImage(path: string): Promise<string | null>;
  /** Resolve a `blob:sha256:…` attachment to a data URL, or null when unavailable. */
  resolveBlob(ref: string, mimeType: string): Promise<string | null>;
  openImage(src: string): void;
  onRevertToTerminal(): void;
  /** Drop a starter prompt into the composer so the user can edit or send it. */
  onStarterPrompt(text: string): void;
  /** Inline plan review card action; main routes it through the terminal key sequences. */
  onPlanAction(action: PlanReviewAction): void;
}

/** Plan display state for the inline chat UI; driven by main's tab state. */
export interface ChatPlanState {
  mode: PlanMode;
  pending: boolean;
  reviewOpen: boolean;
  contextStats?: string;
  compacting: boolean;
  planFile: string | null;
  /** Exact contents of the session-local plan artifact, if the host resolved it. */
  planText: string | null;
}

/** Max assistant excerpt chars shown in the inline review card. */
const PLAN_EXCERPT_CHARS = 4000;

export type ChatEmptyReason = "loading" | "no-session" | "empty";

/** Session facts shown on the landing screen of an empty chat. */
export interface ChatSessionMeta {
  model: string | null;
  cwd: string | null;
  /** Distinct MCP server names currently exposing tools to this session. */
  mcpServers: string[];
  /** MCP server names that failed to connect. */
  mcpFailed: string[];
}

const EMPTY_TEXT: Record<ChatEmptyReason, string> = {
  loading: "Reading session transcript\u2026",
  "no-session": "Ask anything to start this chat.",
  empty: "Ask anything to start this chat.",
};

const STARTER_PROMPTS: readonly string[] = [
  "Explain what this project does and how it is structured.",
  "Review my uncommitted changes and flag anything risky.",
  "Find and fix the failing tests in this repo.",
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Running and failed need a marker; a finished call is obvious without one. */
function stateGlyph(running: boolean, isError: boolean): string {
  return running ? "\u2026" : isError ? "\u2716" : "";
}

/** Full shell command for a detailed run card; null when the payload lacks one. */
function runCommand(part: ToolPart): string | null {
  if (!part.args) return null;
  try {
    const parsed: unknown = JSON.parse(part.args);
    if (!parsed || typeof parsed !== "object" || !("command" in parsed)) return null;
    const command = parsed.command;
    return typeof command === "string" && command.trim() !== "" ? command : null;
  } catch {
    return null;
  }
}


/**
 * Markdown blocks of a partially written reply. Blank lines separate blocks,
 * except inside a fence — a half-typed code block must stay one unit or the
 * renderer would emit a stray paragraph for each of its lines.
 */
function splitMarkdownBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      current.push(line);
      continue;
    }
    if (!fenced && line.trim() === "") {
      if (current.length) blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

/**
 * Grow a delta backwards to its word start so a lone "." never becomes its own
 * box. A delta that already begins at a boundary needs no growth — extending it
 * would re-animate the word before it, which the reader finished reading.
 */
function wordExtendedCount(text: string, added: number): number {
  let start = Math.max(0, text.length - added);
  if (start > 0 && /\s/.test(text[start])) return added;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  return text.length - start;
}

/**
 * Wrap the last `count` characters of a freshly rendered block in animated
 * spans so only the new words fade in. Code blocks are skipped: an inline-block
 * span inside a `pre` would disturb its whitespace.
 */
function markStreamTail(host: HTMLElement, count: number): void {
  if (count <= 0) return;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text && !node.parentElement?.closest("pre, code")) texts.push(node);
    node = walker.nextNode();
  }

  let remaining = count;
  for (let i = texts.length - 1; i >= 0 && remaining > 0; i--) {
    const text = texts[i];
    const value = text.data;
    const take = Math.min(remaining, value.length);
    remaining -= take;
    const tail = take === value.length ? text : text.splitText(value.length - take);
    if (tail.data.trim() === "") continue;

    // One span per word, whitespace left as plain text between them: an
    // inline-block collapses the spaces at its own edges, which ran the last
    // words of a streaming reply together ("must be false" -> "mustbefalse").
    const pieces = document.createDocumentFragment();
    for (const token of tail.data.split(/(\s+)/)) {
      if (token === "") continue;
      if (/^\s+$/.test(token)) {
        pieces.append(document.createTextNode(token));
        continue;
      }
      const span = document.createElement("span");
      span.className = "chat-stream-new";
      span.textContent = token;
      pieces.append(span);
    }
    tail.replaceWith(pieces);
  }
}


/** One continuous execution sequence (thinking + tool steps) under one header. */
interface ActivityGroup {
  readonly node: HTMLDetailsElement;
  /** The `<summary>` row; hosts the live orb while this sequence is the tail. */
  readonly head: HTMLElement;
  readonly steps: HTMLDivElement;
  readonly count: HTMLSpanElement;
  n: number;
  /** Tool buckets in this sequence; thinking steps are deliberately absent. */
  readonly kinds: ToolActionKind[];
  /** First and last transcript timestamps in this sequence, for its duration. */
  startedAt: number | null;
  endedAt: number | null;
}

/** Row-walk state: the speaker run in progress and the open activity section. */
interface BuildCtx {
  key: string | null;
  activity: ActivityGroup | null;
}

export class ChatView {
  readonly el: HTMLDivElement;

  private readonly scroll: HTMLDivElement;
  private readonly zoomWrap: HTMLDivElement;
  private readonly rowsEl: HTMLDivElement;
  private readonly loadEarlier: HTMLButtonElement;
  private readonly inflight: HTMLDivElement;
  private readonly askSlot: HTMLDivElement;
  private readonly askCard: ChatInlineAsk;
  private readonly inflightStack: HTMLSpanElement;
  private inflightLabel: HTMLSpanElement;
  private readonly inflightElapsed: HTMLSpanElement;
  private readonly jumpLatest: HTMLButtonElement;
  private readonly empty: HTMLDivElement;
  private readonly emptyText: HTMLParagraphElement;
  private readonly emptyMeta: HTMLDivElement;

  /** Inline review card at the conversation tail; visible during plan review. */
  private readonly planReview: HTMLDivElement;
  /** Last plan state pushed by main; null until the first sync. */
  private lastPlan: ChatPlanState | null = null;
  /** JSON key of `lastPlan`; skips redundant DOM work on repeat syncs. */
  private lastPlanKey: string | null = null;
  private pendingUser: HTMLDivElement | null = null;

  /** Every row known for this session, including those windowed out of the DOM. */
  private rows: TranscriptRow[] = [];
  /** Index into `rows` of the oldest row currently in the DOM. */
  private windowStart = 0;
  private pinned = true;
  private activity: ControlBridgeActivity = "idle";
  private activitySince: number | null = null;
  private ticker: number | null = null;
  /** Live turn wrapper: execution activity followed by the streaming Agent card. */
  private readonly live: HTMLDivElement;
  private readonly liveActivity: ActivityGroup;
  /** Streaming reasoning, shown outside the Activity box while it is still being written. */
  private readonly liveThought: HTMLDivElement;
  private readonly liveThoughtText: HTMLDivElement;
  private thoughtStep: HTMLDetailsElement | null = null;
  /** Text of that step, so a persisted `Thought` row can supersede it exactly. */
  private thoughtStepText = "";
  /** Source of each markdown block in the band, 1:1 with its children. */
  private thoughtBlocks: string[] = [];
  /** Live tool rows by tool-call id, so a finishing call updates its own row. */
  private readonly liveStepRows = new Map<string, HTMLElement>();
  /** Pending tail-scroll frame, so a burst of deltas costs one layout, not many. */
  private scrollFrame: number | null = null;
  /** Section forced open to show live work, and the state to restore afterwards. */
  private reopenGroup: { node: HTMLDetailsElement; open: boolean } | null = null;
  /** Reasoning the transcript already shows, so the band never repeats it. */
  private persistedThinking: string[] = [];
  /** Reply text the transcript already shows, so its echo cannot re-open the live card. */
  private persistedText: string[] = [];
  private readonly liveAgent: HTMLDivElement;
  private readonly liveBody: HTMLDivElement;
  private liveStale = false;
  private liveTimer: number | null = null;
  /** Content already handed to a persisted row; a matching stream echo must not re-show the wrapper. */
  private handoff: { thinking: string; text: string } | null = null;
  /** Latched so a 1 Hz elapsed tick never restarts the label animation. */
  private activityLabel = "";
  private toolDensity: ToolDensity = "compact";
  private collapseReasoningOnReply = false;
  /** Whether live reasoning opens while the agent is still generating it. */
  private autoShowLiveThinking = true;
  /** Compact only: manual expansion shows literal payload text, not the card. */
  private rawTextOnExpand = false;
  /** Compact only: activity sections start open instead of collapsed. */
  private autoExpandActivity = false;
  /** Latched per turn so the fold happens once, not on every text delta. */
  private reasoningCollapsedForTurn = false;
  private currentZoom = DEFAULT_CHAT_ZOOM;
  private onZoomChange: ((zoom: number) => void) | null = null;
  /** Group key of the last row appended to the live window, so a fresh append continues the same run. */
  private tailGroupKey: string | null = null;
  /** Activity section still open at the tail, so an appended row continues it. */
  private tailActivity: ActivityGroup | null = null;
  /** Live animated orb, parked in the tail activity header while a turn runs. */
  private readonly orb = new ActivityOrb();

  constructor(private readonly hooks: ChatViewHooks) {
    this.el = el("div", "chat-view");

    this.scroll = el("div", "chat-scroll");
    this.loadEarlier = el("button", "chat-load-earlier");
    this.loadEarlier.type = "button";
    this.loadEarlier.hidden = true;
    this.rowsEl = el("div", "chat-rows");
    this.live = el("div", "chat-live");
    this.live.hidden = true;
    this.liveActivity = this.buildActivityGroup(
      { id: "live", role: "assistant", at: 0, model: null, parts: [] },
      false,
    );
    // Live reasoning has its own band now, so the sequence no longer has to be
    // forced open to be useful: it follows the same density rule as persisted rows.
    this.liveActivity.node.open = this.expandByDefault;
    // No steps yet: an empty `ACTIVITY` header would duplicate the persisted one.
    this.liveActivity.node.hidden = true;
    this.liveThought = el("div", "chat-live-thought");
    this.liveThought.hidden = true;
    this.liveThoughtText = el("div", "chat-md chat-live-thought-text");
    this.liveThought.append(this.liveThoughtText);
    this.liveAgent = el("div", "chat-row chat-assistant");
    this.liveAgent.hidden = true;
    const liveHead = el("div", "chat-head");
    liveHead.append(el("span", "chat-who", "Agent"));
    this.liveBody = el("div", "chat-md chat-live-text-body");
    this.liveAgent.append(liveHead, this.liveBody);
    this.live.append(this.liveActivity.node, this.liveThought, this.liveAgent);

    this.inflight = el("div", "chat-inflight");
    this.inflight.hidden = true;
    this.inflightStack = el("span", "chat-inflight-stack");
    this.inflightLabel = el("span", "chat-inflight-label");
    this.inflightStack.append(this.inflightLabel);
    this.inflightElapsed = el("span", "chat-inflight-elapsed");
    this.inflight.append(this.inflightStack, this.inflightElapsed);
    this.planReview = el("div", "chat-plan-review");
    this.planReview.hidden = true;
    this.zoomWrap = el("div", "chat-zoom-wrap");
    this.askSlot = el("div", "chat-ask-slot");
    this.askSlot.hidden = true;
    this.askCard = new ChatInlineAsk();
    this.askSlot.append(this.askCard.el);
    this.zoomWrap.append(this.loadEarlier, this.rowsEl, this.live, this.inflight, this.planReview, this.askSlot);
    this.scroll.append(this.zoomWrap);

    this.jumpLatest = el("button", "chat-jump-latest", "Jump to latest");
    this.jumpLatest.type = "button";
    this.jumpLatest.hidden = true;

    this.empty = el("div", "chat-empty");
    const landing = el("div", "chat-landing");
    landing.append(el("div", "chat-landing-mark", "\u03c0"));
    landing.append(el("h2", "chat-landing-title", "What are we building?"));
    this.emptyText = el("p", "chat-empty-text", EMPTY_TEXT.loading);
    landing.append(this.emptyText);

    this.emptyMeta = el("div", "chat-landing-meta");
    landing.append(this.emptyMeta);

    const prompts = el("div", "chat-landing-prompts");
    for (const prompt of STARTER_PROMPTS) {
      const button = el("button", "chat-landing-prompt", prompt);
      button.type = "button";
      button.addEventListener("click", () => this.hooks.onStarterPrompt(prompt));
      prompts.append(button);
    }
    landing.append(prompts);

    const revert = el("button", "chat-empty-action", "Show terminal");
    revert.type = "button";
    revert.addEventListener("click", () => this.hooks.onRevertToTerminal());
    landing.append(revert);
    this.empty.append(landing);

    this.el.append(this.scroll, this.jumpLatest, this.empty);

    this.scroll.addEventListener("scroll", () => {
      this.pinned = this.scroll.scrollHeight - this.scroll.scrollTop - this.scroll.clientHeight < PIN_SLACK_PX;
      this.jumpLatest.hidden = this.pinned;
    });
    this.jumpLatest.addEventListener("click", () => {
      this.pinned = true;
      this.jumpLatest.hidden = true;
      this.scroll.scrollTo({ top: this.scroll.scrollHeight, behavior: "smooth" });
    });
    this.loadEarlier.addEventListener("click", () => this.showEarlier());
    this.scroll.addEventListener(
      "wheel",
      (ev) => {
        if (!ev.ctrlKey) return;
        ev.preventDefault();
        if (ev.deltaY < 0) this.zoomIn();
        else this.zoomOut();
      },
      { passive: false },
    );

    // Markdown links must open in the user's browser; letting the renderer
    // navigate would replace the whole app window.
    this.el.addEventListener("click", (ev) => {
      const anchor = (ev.target as HTMLElement | null)?.closest("a.md-link") as HTMLAnchorElement | null;
      if (!anchor) return;
      ev.preventDefault();
      this.hooks.openExternal(anchor.href);
    });
  }

  setZoomChangeHandler(cb: (zoom: number) => void): void {
    this.onZoomChange = cb;
  }

  getZoom(): number {
    return this.currentZoom;
  }

  /** Applies a zoom factor without notifying the change handler — used to sync in a persisted or sibling-tab value. */
  applyPersistedZoom(zoom: number): void {
    this.currentZoom = clampChatZoom(zoom);
    this.zoomWrap.style.zoom = String(this.currentZoom);
  }

  zoomIn(): void {
    this.setZoom(this.currentZoom + CHAT_ZOOM_STEP);
  }

  zoomOut(): void {
    this.setZoom(this.currentZoom - CHAT_ZOOM_STEP);
  }

  resetZoom(): void {
    this.setZoom(DEFAULT_CHAT_ZOOM);
  }

  private setZoom(zoom: number): void {
    const next = clampChatZoom(zoom);
    if (next === this.currentZoom) return;
    this.applyPersistedZoom(next);
    this.onZoomChange?.(next);
  }

  mount(parent: HTMLElement): void {
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
  }

  unmount(): void {
    this.el.remove();
  }

  setActive(active: boolean): void {
    this.el.classList.toggle("active", active);
    // A tab switch back into chat must land at the newest turn, not wherever
    // the scroll happened to sit when the tab was left.
    if (active && this.pinned) this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  apply(snapshot: TranscriptSnapshot): void {
    // An empty replacement never means "the conversation is gone": the watcher
    // emits one whenever it re-resolves a transcript that has not been written
    // yet (late `ompSessionId`, `/resume`, a file replaced underneath it).
    // Only an explicit `clearTranscript()` from a real session switch clears.
    if (snapshot.replace && !snapshot.rows.length && this.rows.length) return;

    const hasAssistant = snapshot.rows.some((row) => row.type === "entry" && row.entry.role === "assistant");
    const hasUser = snapshot.rows.some((row) => row.type === "entry" && row.entry.role === "user");

    // The real user row is about to render, so the optimistic echo must go
    // first — otherwise the same prompt shows twice.
    if (hasUser || snapshot.replace) this.clearPendingUser();

    if (snapshot.replace) {
      this.rows = snapshot.rows.slice();
      this.rebuild();
    } else if (snapshot.rows.length) {
      this.rows.push(...snapshot.rows);
      this.appendRows(snapshot.rows);
      if (this.lastPlan?.reviewOpen) this.renderPlan();
    }

    // A persisted sequence may have just appeared, which is what decides whether
    // the live one is a duplicate header or the turn's only one.
    if (!this.live.hidden) this.syncLiveActivity();

    // The persisted row now renders below the live row. Pull the live row out of
    // layout flow immediately so the visible text lands exactly where the static
    // row is — no double card, no scroll jump — then release it after its
    // blur-in animation has had time to finish.
    if (hasAssistant) {
      // The transcript now owns this reasoning. The bridge keeps its buffer
      // until the next turn starts, so without this the band paints the same
      // thought again beside the `Thought` row that just landed. The text is
      // taken from the rows themselves, not from the live buffer: the two can
      // differ by trailing whitespace, and an exact-match guard then fails.
      for (const row of snapshot.rows) {
        if (row.type !== "entry" || row.entry.role !== "assistant") continue;
        for (const part of row.entry.parts) {
          if (part.kind === "text") {
            this.markTextShown(part.text);
            continue;
          }
          if (part.kind !== "thinking") continue;
          this.markThinkingShown(part.text);
          // The transcript's own `Thought` row now shows this reasoning, so the
          // one folded from the live turn is a duplicate sitting right above it.
          // Matched on overlap, not equality: the live buffer can be a slid
          // window of the same thought rather than a byte-identical copy.
          if (this.thoughtStep !== null && sameReasoning(this.thoughtStepText, part.text)) {
            this.thoughtStep.remove();
            this.thoughtStep = null;
            this.thoughtStepText = "";
            this.syncLiveActivity();
          }
        }
      }
      this.markThinkingShown(this.renderedThinking);
    }
    if (hasAssistant && !this.live.hidden) {
      this.handoff = { thinking: this.renderedThinking, text: this.renderedText };
      this.live.classList.add("chat-live-handoff");
      this.clearLiveTimer();
      this.liveTimer = window.setTimeout(() => this.clearLive(), LIVE_SETTLE_MS);
    } else if (hasAssistant) {
      this.clearLive();
    }
    if (this.rows.length) {
      this.empty.hidden = true;
    } else {
      this.setEmptyReason(snapshot.file ? "empty" : "no-session");
    }
  }

  /**
   * Plan display state pushed by main. The inline card reads its excerpt from
   * the transcript rows, so new assistant rows refresh it while a review is open.
   */
  setPlanState(state: ChatPlanState): void {
    const key = JSON.stringify(state);
    if (key === this.lastPlanKey && this.lastPlan) return;
    this.lastPlanKey = key;
    this.lastPlan = { ...state };
    this.renderPlan();
  }

  /** Newest assistant text in the full row list; the plan body when reviewing. */
  private planExcerpt(maxChars: number = PLAN_EXCERPT_CHARS): string | null {
    const texts: string[] = [];
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];
      if (row.type !== "entry" || row.entry.role !== "assistant") continue;
      for (const part of row.entry.parts) {
        if (part.kind === "text" && part.text.trim() !== "") texts.push(part.text);
      }
    }
    if (!texts.length) return null;
    // Newest-first collection above; restore reading order before joining.
    const joined = texts.reverse().join("\n\n").trim();
    if (!joined) return null;
    if (joined.length <= maxChars) return joined;
    const cut = joined.lastIndexOf("\n", maxChars);
    const head = (cut > maxChars / 2 ? joined.slice(0, cut) : joined.slice(0, maxChars)).trimEnd();
    return `${head}\u2026`;
  }

  /** Repaint the inline review card from `lastPlan`. */
  private renderPlan(): void {
    const state = this.lastPlan;
    if (!state) return;
    const show = state.reviewOpen || state.compacting;
    this.planReview.hidden = !show;
    if (!show) {
      this.planReview.replaceChildren();
      return;
    }
    if (state.compacting) {
      this.planReview.replaceChildren();
      const loading = el("div", "chat-plan-compacting");
      const spinner = el("span", "job-spinner");
      loading.append(spinner, document.createTextNode("Compacting context\u2026"));
      this.planReview.append(loading);
      if (this.pinned) this.scroll.scrollTop = this.scroll.scrollHeight;
      return;
    }
    this.planReview.replaceChildren();
    const head = el("div", "chat-plan-head");
    head.append(el("span", "chat-plan-badge", "Plan Review"));
    head.append(el("span", "chat-plan-title", "Plan Ready \u2014 Choose Next Step"));
    const body = el("div", "chat-plan-body");
    // The session-local artifact is the canonical plan; transcript prose is a
    // fallback while it is being resolved or for older omp sessions.
    const excerpt = state.planText?.trim() || this.planExcerpt();
    if (excerpt) {
      const md = el("div", "chat-md");
      md.innerHTML = renderMarkdown(excerpt);
      body.append(md);
    } else {
      body.textContent = "Loading plan text\u2026";
    }
    const stats = el("div", "chat-plan-stats", state.contextStats || "Keep full session context");
    const actions = el("div", "chat-plan-actions");
    const defs: Array<{ label: string; action: PlanReviewAction; primary?: boolean }> = [
      { label: "Approve and Execute", action: "execute", primary: true },
      { label: "Approve in Compact Context", action: "compact" },
      { label: "Approve and Keep Context", action: "keep" },
      { label: "Refine Plan", action: "refine" },
      { label: "Save and Quit", action: "save" },
      { label: "Quit", action: "quit" },
    ];
    for (const def of defs) {
      const btn = el("button", def.primary ? "chat-plan-btn chat-plan-primary" : "chat-plan-btn", def.label);
      btn.type = "button";
      btn.dataset.planAction = def.action;
      btn.addEventListener("click", () => this.hooks.onPlanAction(def.action));
      actions.append(btn);
    }
    this.planReview.append(head, body, stats, actions);
    if (this.pinned) this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  /**
   * Render the reply as it is written.
   *
   * omp persists a message only once it is complete, so the transcript can
   * never show a turn in progress; this text comes from the control bridge's
   * `message_update` deltas instead. When the bridge reports the turn finished
   * (`null`) the row is kept a moment longer — the transcript tail is up to one
   * poll behind, and blanking early reads as a flicker.
   */
  setStream(stream: ControlBridgeStream | { kind: "text" | "thinking"; text: string } | null | undefined): void {
    // Old bridge (pre-recopy) still publishes the single-slot shape; map it
    // onto the dual buffer so a stale extension paints instead of vanishing.
    let thinking = "";
    let text = "";
    if (stream && "kind" in stream) {
      const legacy = stream as { kind: "text" | "thinking"; text: string };
      if (legacy.kind === "thinking") thinking = legacy.text ?? "";
      else text = legacy.text ?? "";
    } else if (stream) {
      thinking = (stream as ControlBridgeStream).thinking ?? "";
      text = (stream as ControlBridgeStream).text ?? "";
    }
    if (!thinking && !text) {
      if (!this.live.hidden && !this.liveStale) this.markLiveStale();
      return;
    }
    // A trailing echo of the message that just persisted must not resurrect the
    // live wrapper as a duplicate of the row below it. Matched on content, not
    // on the exact buffer pair: the bridge keeps publishing that reply for the
    // rest of the turn, and a byte-level guard let it through as "new".
    if (this.handoff && this.handoff.thinking === thinking && this.handoff.text === text) return;
    if (text !== "" && this.persistedText.includes(text.trim())) {
      if (!this.live.hidden && !this.liveStale) this.markLiveStale();
      return;
    }
    this.showLive();
    // The bridge republishes the same buffers whenever activity moves, and a
    // turn emits those constantly. Re-rendering identical text would re-split
    // markdown and rebuild the tail spans for nothing.
    if (thinking === this.renderedThinking && text === this.renderedText) return;
    // A live reasoning step stops being the active focus as reply prose starts:
    // fold it into the Activity sequence once per turn. Existing transcript
    // reasoning keeps its separate, user-configurable collapse preference.
    if (text !== "" && this.renderedText === "" && !this.reasoningCollapsedForTurn) {
      this.reasoningCollapsedForTurn = true;
      if (this.collapseReasoningOnReply) {
        for (const details of this.rowsEl.querySelectorAll<HTMLDetailsElement>("details.chat-thinking")) {
          details.open = false;
        }
      }
    }
    // Prose moving is what ends a thought — not prose merely existing, or a
    // second thought after a reply would never reach the band.
    this.renderLiveThinking(thinking, text !== "" && text !== this.renderedText);
    this.appendStreamChunk(text);
    this.scrollToTail();
  }

  /**
   * Stick to the tail at most once per frame. Writing `scrollTop` right after a
   * DOM write forces a synchronous layout, and a streaming turn does that
   * dozens of times a second — which is what made the thinking band stutter.
   */
  private scrollToTail(): void {
    if (!this.pinned || this.scrollFrame !== null) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = null;
      if (this.pinned) this.scroll.scrollTop = this.scroll.scrollHeight;
    });
  }
  /**
   * Show or hide the inline ask card at the transcript tail.
   *
   * Ephemeral UI: never enters `rows`, windowing, or grouping. Transcript
   * churn (`apply`, `clearTranscript`) only touches `rowsEl`, so the slot
   * survives rebuilds without extra preservation code.
   */
  setAsk(
    pending: PendingAsk | null,
    onSubmit: ((answers: AskAnswer[]) => void) | null,
    onDismiss: (() => void) | null,
  ): void {
    if (!pending || !onSubmit || !onDismiss) {
      this.askCard.close();
      this.askSlot.hidden = true;
      return;
    }
    // Same-id reopen would wipe half-entered answers; the card guards this
    // too, but skip the scroll nudge as well.
    if (this.askCard.isOpen && this.askCard.toolCallId === pending.toolCallId) return;
    this.askCard.open(
      pending,
      (answers) => {
        onSubmit(answers);
        this.askSlot.hidden = true;
      },
      () => {
        onDismiss();
        this.askSlot.hidden = true;
      },
    );
    this.askSlot.hidden = false;
    if (this.pinned) this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  private renderedThinking = "";
  private renderedText = "";
  /** Source of each rendered text block, 1:1 with `liveBody`'s children. */
  private streamBlocks: string[] = [];

  /**
   * Reasoning that is still being written owns the band: dim prose under a
   * sweeping highlight, outside the Activity box. It folds into the sequence as
   * a single step only when that thought is *finished* — which is when the
   * reply moves while the thought stands still, or when the next thought
   * begins. Reasoning that resumes after a reply therefore returns to the band
   * instead of being buried, and a thought never mints more than one entry.
   */
  private renderLiveThinking(thinking: string, replyAdvanced: boolean): void {
    if (thinking === this.renderedThinking) {
      // The thought stopped growing while prose moved on: it is done.
      if (replyAdvanced) this.foldThought();
      return;
    }

    // A buffer that is no longer an extension of what is on screen is a new
    // thought; the outgoing one is finished and must survive in the sequence.
    if (this.renderedThinking !== "" && !this.continuesThought(thinking)) {
      this.foldThought();
      this.thoughtStep = null;
    }

    this.renderedThinking = thinking;

    // Already in the transcript as a `Thought` row: painting it again beside
    // itself is the duplicate the reader sees, not a second thought. Compared
    // on trimmed text — the persisted copy often differs by trailing newlines.
    const trimmed = thinking.trim();
    if (thinking === "" || this.persistedThinking.some((seen) => seen === trimmed || seen.startsWith(trimmed))) {
      this.clearBand();
      return;
    }

    // Already folded (or never meant to be watched live): keep the entry it
    // owns up to date rather than opening a second one.
    if (this.thoughtStep !== null || !this.autoShowLiveThinking) {
      this.clearBand();
      const step = this.buildThoughtStep(thinking);
      if (this.thoughtStep !== null) {
        step.open = this.thoughtStep.open;
        this.thoughtStep.replaceWith(step);
      } else {
        this.appendLiveStep(step);
        this.syncLiveActivity();
      }
      this.thoughtStep = step;
      this.thoughtStepText = thinking;
      return;
    }

    this.liveThought.hidden = false;
    // Same markdown pipeline as the reply, but no per-word fade: the band's
    // colour is a gradient clipped to its glyphs, and a span that composites in
    // its own layer (opacity, filter, transform) escapes that clip and ghosts
    // the words over each other. The sweep already shows it is being written.
    this.thoughtBlocks = this.paintStream(this.liveThoughtText, this.thoughtBlocks, thinking, 0);
    // The band is a fixed-height window onto a growing thought, so it follows
    // the newest line instead of growing the layout beneath it.
    this.liveThought.scrollTop = this.liveThought.scrollHeight;
  }

  /**
   * Whether `thinking` is the same thought as what is rendered.
   *
   * Usually that means it simply grew. But the bridge caps its buffer at 20k
   * characters and keeps the *tail*, so a long thought starts sliding: each
   * update drops a few characters from the front. Treating that as a new
   * thought minted one `Thought` row per delta, each shifted a few characters
   * along. An overlap test recognises the slide for what it is.
   */
  private continuesThought(thinking: string): boolean {
    const prev = this.renderedThinking;
    if (thinking.startsWith(prev) || prev.startsWith(thinking)) return true;
    const head = thinking.slice(0, 120);
    return head.length === 120 && prev.includes(head);
  }

  /**
   * Finish the thought on screen: it leaves the band for the sequence, once.
   * Its text is remembered as already shown, so a later republication of the
   * same buffer cannot paint the band beside the entry that now holds it.
   */
  private foldThought(): void {
    this.clearBand();
    if (this.renderedThinking === "" || this.thoughtStep !== null) return;
    this.thoughtStep = this.buildThoughtStep(this.renderedThinking);
    this.thoughtStepText = this.renderedThinking;
    this.appendLiveStep(this.thoughtStep);
    this.markThinkingShown(this.renderedThinking);
    this.syncLiveActivity();
  }

  /** Remember reasoning that already has a row, capped to the recent turn. */
  private markThinkingShown(text: string): void {
    const trimmed = text.trim();
    if (trimmed === "" || this.persistedThinking.includes(trimmed)) return;
    this.persistedThinking.push(trimmed);
    if (this.persistedThinking.length > 8) this.persistedThinking = this.persistedThinking.slice(-8);
  }

  /** Remember reply text that already has a row, capped to the recent turn. */
  private markTextShown(text: string): void {
    const trimmed = text.trim();
    if (trimmed === "" || this.persistedText.includes(trimmed)) return;
    this.persistedText.push(trimmed);
    if (this.persistedText.length > 8) this.persistedText = this.persistedText.slice(-8);
  }

  /** Empty the band without touching whatever already folded into the sequence. */
  private clearBand(): void {
    this.liveThought.hidden = true;
    this.liveThoughtText.replaceChildren();
    this.thoughtBlocks = [];
  }

  /** One folded reasoning entry in the live sequence; collapsed, like a tool step. */
  private buildThoughtStep(text: string): HTMLDetailsElement {
    const step = this.buildDetails("chat-thinking", thinkingPreview(text), text) as HTMLDetailsElement;
    step.open = false;
    return step;
  }

  /**
   * Render the in-flight reply as markdown while it is still being written.
   *
   * Re-rendering the whole reply on every delta is wasteful and destroys the
   * scroll position, so the text is split into markdown blocks and only the
   * blocks whose source actually changed are re-rendered — in practice the last
   * one. The characters that just arrived are then wrapped in animated spans,
   * extended back to their word boundary so punctuation never becomes its own
   * breakable box. An empty text half clears the reply blocks but keeps any
   * thinking already painted above them.
   */
  private appendStreamChunk(fullText: string): void {
    const grew = this.renderedText !== "" && fullText.startsWith(this.renderedText);
    const added = grew ? fullText.length - this.renderedText.length : 0;
    this.renderedText = fullText;
    // An Agent card with nothing in it is just an empty box sitting under the
    // thinking band; it appears with the first word of the reply.
    this.liveAgent.hidden = fullText === "";
    this.streamBlocks = this.paintStream(this.liveBody, this.streamBlocks, fullText, added);
  }

  /**
   * Paint streamed markdown into `host`, re-rendering only the blocks whose
   * source changed and fading in just the characters that arrived. Shared by
   * the reply body and the live thinking band so both read as real prose.
   */
  private paintStream(host: HTMLElement, prev: string[], fullText: string, added: number): string[] {
    const blocks = splitMarkdownBlocks(fullText);
    let lastChanged = -1;
    for (let i = 0; i < blocks.length; i++) {
      const existing = host.children[i];
      if (existing instanceof HTMLElement && prev[i] === blocks[i]) continue;
      const block = existing instanceof HTMLElement ? existing : el("div", "chat-stream-block");
      // Safe: `renderMarkdown` escapes its input before emitting any markup.
      block.innerHTML = renderMarkdown(blocks[i]);
      if (!existing) host.append(block);
      lastChanged = i;
    }
    while (host.children.length > blocks.length) host.lastElementChild?.remove();

    if (added > 0 && lastChanged >= 0) {
      const tail = host.children[lastChanged];
      if (tail instanceof HTMLElement) markStreamTail(tail, wordExtendedCount(fullText, added));
    }
    return blocks;
  }

  /** Detailed always starts open; compact only does when auto-expand is on. */
  private get expandByDefault(): boolean {
    return this.toolDensity === "detailed" || this.autoExpandActivity;
  }

  /** Chosen in Settings → Chat View; re-renders so existing rows change shape. */
  setToolDensity(density: ToolDensity): void {
    if (this.toolDensity === density) return;
    this.toolDensity = density;
    this.rebuild();
  }

  /** Whether an expanded reasoning block folds away once the reply text begins. */
  setCollapseReasoningOnReply(enabled: boolean): void {
    this.collapseReasoningOnReply = enabled;
  }

  /** Whether reasoning streams in its own band before folding into the sequence. */
  setAutoShowLiveThinking(enabled: boolean): void {
    if (this.autoShowLiveThinking === enabled) return;
    this.autoShowLiveThinking = enabled;
    if (this.renderedThinking === "") return;
    // Re-present what is already on screen under the new preference: the same
    // path decides band-versus-step, so there is no second placement rule.
    const thinking = this.renderedThinking;
    this.renderedThinking = "";
    this.renderLiveThinking(thinking, this.renderedText !== "");
  }

  /** Compact only: expand into literal payload text rather than the card. */
  setRawTextOnExpand(enabled: boolean): void {
    if (this.rawTextOnExpand === enabled) return;
    this.rawTextOnExpand = enabled;
    if (this.toolDensity === "compact") this.rebuild();
  }

  /** Compact only: activity sections (thinking/tool cards) start open instead of collapsed. */
  setAutoExpandActivity(enabled: boolean): void {
    if (this.autoExpandActivity === enabled) return;
    this.autoExpandActivity = enabled;
    if (this.toolDensity === "compact") this.rebuild();
  }

  /** Model, folder, and connected MCP servers shown on the landing screen of an empty chat. */
  setSessionMeta(meta: ChatSessionMeta): void {
    this.emptyMeta.replaceChildren();
    if (meta.model) this.emptyMeta.append(el("span", "chat-landing-chip", meta.model));
    if (meta.cwd) this.emptyMeta.append(el("span", "chat-landing-chip", meta.cwd));
    if (meta.mcpServers.length > 0 || meta.mcpFailed.length > 0) {
      const mcpGroup = el("div", "chat-landing-mcp-group");
      mcpGroup.append(el("span", "chat-landing-mcp-label", "MCP"));
      for (const server of meta.mcpServers) {
        mcpGroup.append(el("span", "chat-landing-chip chat-landing-chip-mcp", server));
      }
      for (const server of meta.mcpFailed) {
        mcpGroup.append(el("span", "chat-landing-chip chat-landing-chip-mcp-failed", server));
      }
      this.emptyMeta.append(mcpGroup);
    }
  }

  /**
   * Echo a just-sent prompt immediately.
   *
   * omp writes a user message to the transcript only when the whole turn is
   * persisted, so without this the reply could appear seconds before the
   * prompt that caused it.
   */
  showPendingUser(text: string, imagePaths: readonly string[]): void {
    const trimmed = text.trim();
    if (!trimmed && !imagePaths.length) return;
    this.clearPendingUser();
    const row = this.buildEntryRow(
      { id: "pending-user", role: "user", at: Date.now(), model: null, parts: trimmed ? [{ kind: "text", text: trimmed }] : [] },
      true,
      false,
    );
    const body = row.querySelector<HTMLDivElement>(".chat-body");
    if (body) {
      for (const path of imagePaths) body.append(this.buildDeferredImage(this.hooks.resolveLocalImage(path)));
    }
    this.pendingUser = row;
    this.rowsEl.append(row);
    this.empty.hidden = true;
    this.pinned = true;
    this.jumpLatest.hidden = true;
    this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  private clearPendingUser(): void {
    this.pendingUser?.remove();
    this.pendingUser = null;
  }

  /** A real session switch (`/new`, `/resume`) — drop what the old session rendered. */
  clearTranscript(): void {
    this.rows = [];
    this.clearPendingUser();
    this.rowsEl.replaceChildren();
    // The old tail section is detached now; keeping it would park the orb in a
    // header that is no longer on screen.
    this.tailGroupKey = null;
    this.tailActivity = null;
    this.clearLive();
    // The rows that owned this reasoning are gone, so it can be shown live again.
    this.persistedThinking = [];
    this.persistedText = [];
    this.setEmptyReason("loading");
  }

  setEmptyReason(reason: ChatEmptyReason): void {
    if (this.rows.length) {
      this.empty.hidden = true;
      return;
    }
    this.emptyText.textContent = EMPTY_TEXT[reason];
    this.empty.hidden = false;
  }
  /**
   * Extracts recent plain text snippets from chat turns for tab preview.
   */
  getRecentPreviewLines(maxLines = 8): string[] {
    const result: string[] = [];
    // Check live body first if visible
    if (!this.live.hidden && this.liveBody.textContent?.trim()) {
      const text = this.liveBody.textContent.trim();
      result.push(...text.split("\n").slice(-maxLines));
    }
    if (result.length < maxLines) {
      for (let i = this.rows.length - 1; i >= 0 && result.length < maxLines; i--) {
        const r = this.rows[i];
        if (r.type === "entry") {
          const speaker = r.entry.role === "user" ? "You: " : "Agent: ";
          for (const part of r.entry.parts) {
            if (part.kind === "text" && part.text.trim()) {
              const lines = part.text.trim().split("\n");
              for (let j = lines.length - 1; j >= 0 && result.length < maxLines; j--) {
                result.unshift(j === 0 ? `${speaker}${lines[j]}` : lines[j]);
              }
            }
          }
        }
      }
    }
    return result.slice(-maxLines);
  }


  /** Drive the activity pill and live Activity section for the active turn. */
  setActivity(activity: ControlBridgeActivity, since: number | null): void {
    this.activity = activity;
    this.activitySince = since;

    if (activity === "idle") {
      this.inflight.hidden = true;
      this.stopTicker();
      // Reset the latch so the next turn animates its first label in.
      this.activityLabel = "";
      this.inflightStack.replaceChildren(this.inflightLabel);
      // A finished turn with no bridge stream update still has to release the row.
      if (!this.live.hidden && !this.liveStale) this.markLiveStale();
      this.syncOrb();
      return;
    }

    if (this.handoff === null) this.showLive();
    // Deliberately no fold here: activity is republished on every delta, so
    // folding per update minted one Thought row per word. A thought is finished
    // only when prose starts or the next thought begins.
    this.inflight.hidden = false;
    this.paintActivity();
    if (this.ticker === null) this.ticker = window.setInterval(() => this.paintActivity(), 1000);
    this.scrollToTail();
  }

  private showLive(): void {
    this.clearLiveTimer();
    this.liveStale = false;
    this.handoff = null;
    this.live.classList.remove("chat-live-handoff");
    const wasHidden = this.live.hidden;
    this.live.hidden = false;
    if (wasHidden) this.liveActivity.node.open = this.expandByDefault;
    this.empty.hidden = true;
    this.syncLiveActivity();
  }

  /**
   * Park the live orb in the active Activity header. Once the live turn clears,
   * fall back to the persisted tail activity section.
   */
  private syncOrb(): void {
    // An empty live sequence is not on screen, so its header cannot host the orb.
    const liveVisible = !this.live.hidden && !this.liveActivity.node.hidden;
    const group = liveVisible ? this.liveActivity : this.tailActivity;
    if (this.activity === "idle" || group === null) {
      this.orb.hide();
      return;
    }
    this.orb.show(group.head, this.activity);
  }

  /**
   * Hide the live sequence only while another one is on screen to merge into:
   * an empty header beside the persisted `ACTIVITY` is a duplicate, but with no
   * persisted sequence yet it is the turn's only header — and the only home for
   * the orb, so hiding it left a thinking band with no sign of activity at all.
   */
  private syncLiveActivity(): void {
    const empty = this.liveActivity.steps.childElementCount === 0;
    this.liveActivity.node.hidden = empty && this.tailActivity !== null;
    this.syncOrb();
  }

  /**
   * Where a live step belongs: the sequence already open at the transcript tail
   * when there is one, so a turn that is still running extends the `ACTIVITY`
   * section the reader is looking at instead of opening a second one beside it.
   * The live wrapper's own section is the fallback for a turn that has not
   * persisted anything yet.
   */
  private get liveStepGroup(): ActivityGroup {
    return this.tailActivity ?? this.liveActivity;
  }

  /**
   * Append a transient row to that sequence. Unlike `addStep` it leaves the
   * `· 3 reads` tally alone: the count summarises what the transcript holds, and
   * a live row is replaced by its persisted equivalent moments later.
   *
   * The host section is forced open for the duration: a compact-density section
   * is collapsed, and a running edit hidden behind a disclosure is exactly the
   * "nothing is happening" the live rows exist to fix. Its previous state is
   * restored when the turn clears.
   */
  private appendLiveStep(node: HTMLElement): void {
    const group = this.liveStepGroup;
    if (this.reopenGroup === null) {
      this.reopenGroup = { node: group.node, open: group.node.open };
    }
    group.node.open = true;
    node.classList.add("chat-step", "chat-step-fresh");
    group.steps.append(node);
  }

  dispose(): void {
    this.stopTicker();
    if (this.scrollFrame !== null) {
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = null;
    }
    this.clearLive();
    this.unmount();
    this.rows = [];
    this.rowsEl.replaceChildren();
    this.orb.dispose();
  }

  private stopTicker(): void {
    if (this.ticker === null) return;
    window.clearInterval(this.ticker);
    this.ticker = null;
  }

  private clearLiveTimer(): void {
    if (this.liveTimer === null) return;
    window.clearTimeout(this.liveTimer);
    this.liveTimer = null;
  }
  private clearLive(): void {
    this.clearLiveTimer();
    this.liveStale = false;
    this.live.hidden = true;
    this.handoff = null;
    this.live.classList.remove("chat-live-handoff");
    this.liveActivity.node.open = this.expandByDefault;
    // Hand the persisted section back the disclosure state it had before the
    // live rows borrowed it.
    if (this.reopenGroup !== null) {
      this.reopenGroup.node.open = this.reopenGroup.open;
      this.reopenGroup = null;
    }
    this.renderedThinking = "";
    // `persistedThinking` deliberately survives: the bridge holds its buffer
    // until the next turn starts, so it republishes this same reasoning after
    // the live wrapper settles. Forgetting here made it read as brand-new and
    // paint the band next to the `Thought` row that already owns it. Only a
    // real session switch clears it.
    this.renderedText = "";
    this.streamBlocks = [];
    this.reasoningCollapsedForTurn = false;
    // Live steps may have been appended to the persisted tail sequence, so they
    // are removed by node rather than by clearing one container.
    this.thoughtStep?.remove();
    this.thoughtStep = null;
    this.clearBand();
    for (const row of this.liveStepRows.values()) row.remove();
    this.liveStepRows.clear();
    this.liveActivity.steps.replaceChildren();
    this.liveActivity.node.hidden = true;
    this.liveBody.replaceChildren();
    this.liveAgent.hidden = true;
    this.syncOrb();
  }

  /**
   * The turn ended but the transcript tail has not landed yet. Hold the text so
   * the reply does not blink out, and drop it anyway if the file never arrives.
   */
  private markLiveStale(): void {
    this.liveStale = true;
    this.clearLiveTimer();
    this.liveTimer = window.setTimeout(() => this.clearLive(), LIVE_SETTLE_MS);
  }

  private paintActivity(): void {
    const kind: GlowActivity = this.activity === "idle" ? "working" : (this.activity as GlowActivity);
    const label = GLOW_ACTIVITY_LABELS[kind] ?? "Working";
    this.inflight.dataset.activity = kind;
    this.inflightElapsed.textContent =
      this.activitySince === null ? "" : `\u00b7 ${formatElapsed(Date.now() - this.activitySince)}`;
    if (label === this.activityLabel) return;

    const previous = this.activityLabel === "" ? null : this.inflightLabel;
    this.activityLabel = label;
    const next = el("span", "chat-inflight-label chat-inflight-in", label);
    next.dataset.label = label;
    this.inflightLabel = next;
    if (previous) {
      // The outgoing word leaves the flow immediately so the new one lands in
      // place instead of waiting for the slide-out to finish.
      this.inflightStack.append(next);
      previous.classList.add("chat-inflight-out");
      previous.addEventListener("animationend", () => previous.remove(), { once: true });
    } else {
      // First label of the turn: take over the empty placeholder span.
      this.inflightStack.replaceChildren(next);
    }
  }

  private rebuild(): void {
    this.rebuildWithRows(this.rows);
  }

  private rebuildWithRows(rows: readonly TranscriptRow[]): void {
    this.rowsEl.replaceChildren();
    this.windowStart = Math.max(0, rows.length - WINDOW_ROWS);
    const ctx: BuildCtx = { key: null, activity: null };
    this.rowsEl.append(...rows.slice(this.windowStart).map((row) => this.buildRow(row, false, ctx)));
    this.tailGroupKey = ctx.key;
    this.tailActivity = ctx.activity;
    this.syncOrb();
    this.syncLoadEarlier();
    if (this.lastPlan?.reviewOpen) this.renderPlan();
    this.pinned = true;
    this.jumpLatest.hidden = true;
    this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  private appendRows(rows: readonly TranscriptRow[]): void {
    const wasPinned = this.pinned;
    const ctx: BuildCtx = { key: this.tailGroupKey, activity: this.tailActivity };
    this.rowsEl.append(...rows.map((row) => this.buildRow(row, true, ctx)));
    this.tailGroupKey = ctx.key;
    this.tailActivity = ctx.activity;
    this.syncOrb();
    if (wasPinned) this.scroll.scrollTop = this.scroll.scrollHeight;
    else this.jumpLatest.hidden = false;
  }

  private showEarlier(): void {
    const before = this.scroll.scrollHeight;
    const end = this.windowStart;
    this.windowStart = Math.max(0, end - WINDOW_ROWS);
    const frag = document.createDocumentFragment();
    // Older rows are prepended above the current window; the seam against the
    // row that was previously first-shown is deliberately left ungrouped — a
    // rare, manual "load more" action, not worth threading bottom-up state for.
    const ctx: BuildCtx = { key: null, activity: null };
    for (const row of this.rows.slice(this.windowStart, end)) frag.append(this.buildRow(row, false, ctx));
    this.rowsEl.prepend(frag);
    this.syncLoadEarlier();
    // Keep the reader's eye on the same message rather than jumping.
    this.scroll.scrollTop += this.scroll.scrollHeight - before;
  }

  private syncLoadEarlier(): void {
    this.loadEarlier.hidden = this.windowStart === 0;
    if (this.windowStart > 0) {
      this.loadEarlier.textContent = `Load ${Math.min(WINDOW_ROWS, this.windowStart)} earlier messages`;
    }
  }

  /** True when `entry` continues the same speaker run as the previous row; a `tool`
   * row always breaks the run (and is itself never grouped). Mutates `ctx`. */
  private groupWith(entry: TranscriptEntry, ctx: { key: string | null }): boolean {
    const key = entry.role === "tool" ? null : `${entry.role}:${entry.role === "assistant" ? entry.model ?? "" : ""}`;
    const grouped = key !== null && key === ctx.key;
    ctx.key = key;
    return grouped;
  }

  private buildRow(row: TranscriptRow, fresh: boolean, ctx: BuildCtx): Node {
    if (row.type === "marker") {
      ctx.key = null;
      ctx.activity = null;
      const marker = el("div", `chat-marker chat-marker-${row.marker.kind}`);
      marker.append(el("span", "chat-marker-rule"), el("span", "chat-marker-text", row.marker.text));
      return marker;
    }

    const entry = row.entry;
    if (entry.role !== "assistant") {
      ctx.activity = null;
      return this.buildEntryRow(entry, fresh, this.groupWith(entry, ctx));
    }

    // Thinking and tool calls are one continuous execution sequence, so they
    // share a single activity section that spans consecutive assistant rows —
    // otherwise a think/tool/think run shattered into five disconnected cards.
    const steps = entry.parts.filter((part) => part.kind === "thinking" || part.kind === "tool");
    const spoken = entry.parts.filter((part) => part.kind !== "thinking" && part.kind !== "tool");
    if (!steps.length) {
      ctx.activity = null;
      return this.buildEntryRow(entry, fresh, this.groupWith(entry, ctx));
    }

    const fragment = document.createDocumentFragment();
    const group = ctx.activity ?? this.buildActivityGroup(entry, fresh);
    if (group !== ctx.activity) {
      ctx.activity = group;
      ctx.key = null;
      fragment.append(group.node);
    }
    this.appendActivitySteps(group, steps, fresh);
    if (entry.at) group.endedAt = entry.at;
    this.paintActivityCount(group);

    if (spoken.length) {
      // Prose ends the sequence: the next tool call starts a fresh section.
      ctx.activity = null;
      // The prose that closes a sequence also dates its end.
      if (entry.at) group.endedAt = entry.at;
      this.paintActivityCount(group);
      fragment.append(this.buildEntryRow({ ...entry, parts: spoken }, fresh, this.groupWith(entry, ctx)));
    }
    return fragment;
  }

  /**
   * Tool calls of the running turn, published by the bridge. omp writes a call
   * to the transcript only when its message persists, so without these the
   * sequence shows nothing at all while an edit or a command executes — the
   * activity pill named the verb but never the file.
   *
   * Rows are keyed by tool-call id and reconciled in place: a call that
   * finishes updates its own row rather than appending a second one, and the
   * persisted transcript replaces the whole live wrapper at handoff.
   */
  setLiveSteps(steps: readonly ControlBridgeStep[]): void {
    for (const [id, row] of this.liveStepRows) {
      if (steps.some((step) => step.id === id)) continue;
      row.remove();
      this.liveStepRows.delete(id);
    }
    if (!steps.length) {
      this.syncLiveActivity();
      return;
    }

    for (const step of steps) {
      const existing = this.liveStepRows.get(step.id);
      // Updated in place rather than rebuilt: replacing the node on every
      // argument delta restarted its animation and threw away the preview's
      // scroll position, which is what made a streaming write look jumpy.
      if (existing) {
        this.syncLiveStep(existing, step);
        continue;
      }
      const row = this.buildLiveStep(step);
      this.appendLiveStep(row);
      this.liveStepRows.set(step.id, row);
    }
    this.syncLiveActivity();
    this.scrollToTail();
  }

  /**
   * `Editing  src/app.ts` plus, while its arguments stream, the last lines of
   * the payload being written — the same "it is actually doing something right
   * now" the terminal shows for a long write.
   */
  private buildLiveStep(step: ControlBridgeStep): HTMLElement {
    const row = el("div", "chat-act chat-act-live");
    if (step.running) row.classList.add("chat-act-running");
    if (step.isError) row.classList.add("chat-act-error");

    const head = el("div", "chat-act-head");
    const activity = classifyToolActivity(step.name);
    head.append(el("span", "chat-act-verb", GLOW_ACTIVITY_LABELS[activity as GlowActivity] ?? "Working"));
    if (step.subject) head.append(el("span", "chat-act-subject", step.subject));
    const glyph = stateGlyph(step.running, step.isError);
    if (glyph) head.append(el("span", "chat-act-state", glyph));
    row.append(head);

    this.paintStepPreview(row, step.preview);
    return row;
  }

  /** Refresh an existing row: verb never changes, everything else can. */
  private syncLiveStep(row: HTMLElement, step: ControlBridgeStep): void {
    row.classList.toggle("chat-act-running", step.running);
    row.classList.toggle("chat-act-error", step.isError);

    const head = row.querySelector<HTMLElement>(".chat-act-head");
    if (head) {
      const subject = head.querySelector<HTMLElement>(".chat-act-subject");
      if (step.subject && subject) subject.textContent = step.subject;
      else if (step.subject) head.append(el("span", "chat-act-subject", step.subject));
      else subject?.remove();

      const glyph = stateGlyph(step.running, step.isError);
      const state = head.querySelector<HTMLElement>(".chat-act-state");
      if (glyph && state) state.textContent = glyph;
      else if (glyph) head.append(el("span", "chat-act-state", glyph));
      else state?.remove();
    }
    this.paintStepPreview(row, step.preview);
  }

  /**
   * The streamed payload, as added lines — the same treatment the persisted
   * edit row gets, so the live view and the finished one read as one thing.
   *
   * Lines are rewritten in place instead of rebuilt so the box does not flicker
   * on every delta, and the view follows the newest line only while the reader
   * is already at the bottom; scrolling up to read holds position.
   */
  private paintStepPreview(row: HTMLElement, preview: string | null): void {
    const existing = row.querySelector<HTMLElement>(".chat-act-preview");
    if (!preview) {
      existing?.remove();
      return;
    }

    const host = existing ?? el("pre", "chat-pre chat-diff chat-act-preview");
    if (!existing) row.append(host);
    const pinned = host.scrollHeight - host.scrollTop - host.clientHeight < 8;

    const lines = preview.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const text = `+ ${lines[i]}`;
      // A paragraph break in the file is a real empty line; it is kept, but
      // marked so it renders as a gap rather than as a full row of nothing.
      const blank = lines[i].trim() === "";
      const line = host.children[i];
      if (line instanceof HTMLElement) {
        if (line.textContent !== text) line.textContent = text;
        line.classList.toggle("chat-diff-blank", blank);
        continue;
      }
      const span = el("span", "chat-diff-add chat-diff-fresh", text);
      if (blank) span.classList.add("chat-diff-blank");
      host.append(span);
    }
    while (host.children.length > lines.length) host.lastElementChild?.remove();
    if (pinned) host.scrollTop = host.scrollHeight;
  }

  /** The wrapper for one execution sequence: a section, not another tool call. */
  private buildActivityGroup(entry: TranscriptEntry, fresh: boolean): ActivityGroup {
    const node = document.createElement("details");
    node.className = "chat-activity";
    if (fresh) node.classList.add("chat-row-fresh");
    node.open = this.expandByDefault;

    const head = document.createElement("summary");
    head.append(el("span", "chat-activity-title", "Activity"));
    const count = el("span", "chat-activity-count");
    head.append(count);
    if (entry.at) {
      head.append(el("span", "chat-time", new Date(entry.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })));
    }

    const steps = el("div", "chat-activity-steps");
    node.append(head, steps);
    return { node, head, steps, count, n: 0, kinds: [], startedAt: entry.at || null, endedAt: entry.at || null };
  }

  /** Append this row's steps to the open sequence, preserving their order. */
  private appendActivitySteps(group: ActivityGroup, parts: readonly TranscriptPart[], fresh: boolean): void {
    let tools: ToolPart[] = [];
    const flush = (): void => {
      if (!tools.length) return;
      for (const action of summarizeToolParts(tools)) {
        group.kinds.push(action.kind);
        this.addStep(group, this.buildActionRow(action, this.expandByDefault), fresh);
      }
      tools = [];
    };

    for (const part of parts) {
      if (part.kind === "tool") {
        tools.push(part);
        continue;
      }
      flush();
      if (part.kind === "thinking") {
        this.addStep(group, this.buildDetails("chat-thinking", thinkingPreview(part.text), part.text), fresh);
      }
    }
    flush();
  }

  private addStep(group: ActivityGroup, node: HTMLElement, fresh: boolean): void {
    node.classList.add("chat-step");
    // Only a step that arrives while the reader is watching animates in; a
    // rebuild must not replay the whole sequence.
    if (fresh) node.classList.add("chat-step-fresh");
    group.steps.append(node);
    group.n += 1;
    this.paintActivityCount(group);
  }

  /** `· 11 edits, 5 reads · 3m 04s` — the work done, then how long it took. */
  private paintActivityCount(group: ActivityGroup): void {
    // Thinking is not a tool, so the header names the work, not the step count.
    const bits: string[] = [];
    const summary = activitySummary(group.kinds);
    if (summary !== "") bits.push(summary);
    const span = group.startedAt !== null && group.endedAt !== null ? group.endedAt - group.startedAt : 0;
    // Only a real span: every row of a fast burst carries the same timestamp.
    if (span >= 1000) bits.push(formatElapsed(span));
    group.count.textContent = bits.length ? `\u00b7 ${bits.join(" \u00b7 ")}` : "";
  }

  private buildEntryRow(entry: TranscriptEntry, fresh: boolean, grouped: boolean): HTMLDivElement {
    const node = el("div", `chat-row chat-${entry.role}`);
    if (fresh) node.classList.add("chat-row-fresh");
    if (grouped) node.classList.add("chat-row-grouped");

    if (!grouped) {
      const head = el("div", "chat-head");
      head.append(el("span", "chat-who", entry.role === "user" ? "You" : entry.role === "tool" ? "Tool" : "Agent"));
      if (entry.at) {
        head.append(el("span", "chat-time", new Date(entry.at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })));
      }
      node.append(head);
    }

    const body = el("div", "chat-body");
    this.appendParts(body, entry.parts);
    node.append(body);
    return node;
  }

  /** Keep adjacent tool calls inside one activity block. */
  private appendParts(body: HTMLElement, parts: readonly TranscriptPart[]): void {
    let tools: ToolPart[] = [];
    const flushTools = (): void => {
      if (!tools.length) return;
      body.append(this.buildActions(tools));
      tools = [];
    };

    for (const part of parts) {
      if (part.kind === "tool") {
        tools.push(part);
        continue;
      }
      flushTools();
      body.append(this.buildPart(part));
    }
    flushTools();
  }

  private buildPart(part: TranscriptPart): HTMLElement {
    switch (part.kind) {
      case "text":
        return this.buildText(part.text);
      case "thinking":
        return this.buildDetails("chat-thinking", thinkingPreview(part.text), part.text);
      case "image":
        return this.buildImage(part.src, part.mimeType);
      case "tool":
        return this.buildActions([part]);
    }
  }

  /**
   * One bare, borderless line per tool action. Density only decides whether the
   * line starts open — it never adds a container or a border.
   */
  private buildActions(parts: readonly ToolPart[]): HTMLElement {
    const actions = summarizeToolParts(parts);
    const open = this.expandByDefault;
    const running = actions.some((action) => action.running);
    // Latest wins: one recovered failure mid-burst must not paint it all red.
    const failed = actions.length > 0 && actions[actions.length - 1].isError;

    const wrap = el("div", "chat-acts");
    if (running) wrap.classList.add("chat-act-running");
    if (failed) wrap.classList.add("chat-act-error");
    for (const action of actions) {
      wrap.append(this.buildActionRow(action, open));
    }
    return wrap;
  }

  /** `**Edited** math.ts +4 −1 …` — one expandable line per action. */
  private buildActionRow(action: ToolAction, open: boolean): HTMLElement {
    const row = document.createElement("details");
    row.className = "chat-act";
    if (action.running) row.classList.add("chat-act-running");
    if (action.isError) row.classList.add("chat-act-error");
    row.open = open;

    const head = document.createElement("summary");
    head.append(el("span", "chat-act-verb", action.verb));
    head.append(el("span", "chat-act-subject", action.subject));

    const delta = el("span", "chat-act-delta");
    if (action.added) delta.append(el("span", "chat-act-add", `+${action.added}`));
    if (action.removed) delta.append(el("span", "chat-act-del", `\u2212${action.removed}`));
    if (delta.childElementCount) head.append(delta);

    if (action.detail !== null) head.append(el("code", "chat-act-detail", action.detail));
    const glyph = stateGlyph(action.running, action.isError);
    if (glyph) head.append(el("span", "chat-act-state", glyph));
    row.append(head, this.buildActionBody(action));
    return row;
  }

  /**
   * One expanded design for both densities — density only decides whether the
   * row starts open. Compact may opt into a raw-text body instead, which is a
   * deliberate developer view, not a second polished layout.
   */
  private buildActionBody(action: ToolAction): HTMLElement {
    const body = el("div", "chat-act-body");
    const part = action.part;
    const removed = action.removed ?? 0;

    if (this.rawTextOnExpand && this.toolDensity === "compact") {
      const raw = el("pre", "chat-pre chat-act-raw");
      raw.textContent = rawToolText(action);
      body.append(raw);
      return body;
    }

    if (action.kind === "edit" && (removed > 0 || action.addedLines.length > 0)) {
      const diff = el("pre", "chat-pre chat-diff");
      // The patch carries new text only, so removals are a count, never invented
      // red lines. Every added line renders: the box scrolls instead of ending
      // in an unhelpful "+N more lines".
      if (removed > 0) {
        // The old text is not in the patch payload (omp patches carry new text
        // only), so the removal row names the spans that were replaced.
        const spans = action.removedRanges
          .map(([from, to]) => (from === to ? `${from}` : `${from}\u2013${to}`))
          .join(", ");
        diff.append(el(
          "span",
          "chat-diff-del",
          spans ? `\u2212 lines ${spans} replaced (${removed})` : `\u2212 ${removed} lines replaced`,
        ));
      }
      for (const line of action.addedLines) {
        diff.append(el("span", "chat-diff-add", `+ ${line}`));
      }
      body.append(diff);
      // The change itself is the whole story for an edit: the raw patch text
      // and the harness acknowledgement below it were pure noise.
      return body;
    }

    if (action.kind === "read") {
      // What was read, not how it was asked for: the args JSON is noise once
      // the file and its line range are already on the summary line.
      const range = readRangeLabel(action);
      if (range) body.append(el("div", "chat-act-meta", range));
      if (part.result !== null) body.append(this.buildPayload(part.result));
      return body;
    }

    if (action.kind === "run") {
      const command = runCommand(part);
      if (command) {
        const pre = el("pre", "chat-pre chat-act-cmd");
        pre.textContent = command;
        body.append(pre);
      }
      // The whole output, scrolled — a clipped tail hid the part that mattered.
      if (part.result !== null) body.append(this.buildPayload(part.result));
      return body;
    }

    if (part.args && part.args !== "{}") {
      const args = el("pre", "chat-pre chat-act-args");
      args.textContent = part.args;
      body.append(args);
    }

    if (part.result !== null) body.append(this.buildPayload(part.result));

    return body;
  }

  /** Scrollable payload view, or a muted note when omp reclaimed the content. */
  private buildPayload(text: string): HTMLElement {
    if (isSupersededResult(text)) {
      return el("div", "chat-act-note", "Content reclaimed by omp \u2014 superseded by a newer read");
    }
    const pre = el("pre", "chat-pre chat-act-out");
    pre.textContent = text.length > MAX_RESULT_CHARS
      ? `${text.slice(0, MAX_RESULT_CHARS)}\n\u2026 (truncated)`
      : text;
    return pre;
  }

  private buildText(text: string): HTMLElement {
    const wrap = el("div", "chat-md");
    // Safe: `renderMarkdown` escapes its input before emitting any markup.
    wrap.innerHTML = renderMarkdown(text);
    this.attachCopyButtons(wrap);

    const copy = el("button", "chat-copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => {
      this.hooks.copyText(text);
      this.flashCopied(copy);
    });
    wrap.append(copy);
    return wrap;
  }

  /** Give every fenced block its own copy button; agents emit a lot of them. */
  private attachCopyButtons(scope: HTMLElement): void {
    for (const pre of Array.from(scope.querySelectorAll<HTMLPreElement>("pre.md-pre"))) {
      const copy = el("button", "md-copy", "Copy");
      copy.type = "button";
      copy.addEventListener("click", () => {
        this.hooks.copyText(pre.querySelector("code")?.textContent ?? "");
        this.flashCopied(copy);
      });
      pre.append(copy);
    }
  }

  /** Briefly swaps a copy button's label to confirm the click landed. */
  private flashCopied(button: HTMLButtonElement): void {
    const original = button.textContent;
    button.textContent = "Copied";
    button.classList.add("chat-copy-done");
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove("chat-copy-done");
    }, 1200);
  }

  private buildDetails(className: string, summary: string, text: string): HTMLElement {
    const details = document.createElement("details");
    details.className = className;

    const head = document.createElement("summary");
    details.open =
      className === "chat-thinking" && this.expandByDefault && !this.reasoningCollapsedForTurn;
    if (className === "chat-thinking") head.append(el("strong", "chat-thinking-label", "Thought"));
    head.append(el("span", "chat-summary-text", summary));
    details.append(head);

    // Reasoning is prose, not a payload: rendering it raw put `**bold**` markers
    // on screen. `renderMarkdown` escapes its input before emitting markup.
    const body = el("div", "chat-md chat-thinking-body");
    body.innerHTML = renderMarkdown(text);
    details.append(body);
    return details;
  }

  private buildImage(src: string, mimeType: string): HTMLElement {
    if (src.startsWith("blob:sha256:")) return this.buildDeferredImage(this.hooks.resolveBlob(src, mimeType));
    return this.buildShownImage(src);
  }

  private buildDeferredImage(load: Promise<string | null>): HTMLElement {
    const wrap = el("div", "chat-image-wrap");
    wrap.append(el("div", "chat-image-pending", "Loading image…"));
    void load.then((url) => {
      if (url) wrap.replaceChildren(this.buildShownImage(url));
      else wrap.replaceChildren(el("div", "chat-image-missing", "Image unavailable"));
    });
    return wrap;
  }

  private buildShownImage(src: string): HTMLImageElement {
    const img = el("img", "chat-image");
    img.src = src;
    img.alt = "Attachment";
    img.addEventListener("click", () => this.hooks.openImage(src));
    return img;
  }
}
