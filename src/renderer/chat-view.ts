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
  type ControlBridgeStream,
  type GlowActivity,
} from "../shared/ipc";
import { formatElapsed } from "../shared/elapsed";
import { renderMarkdown } from "../shared/markdown";
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

export type ChatEmptyReason = "loading" | "no-session" | "empty";

export interface ChatViewHooks {
  copyText(text: string): void;
  openExternal(url: string): void;
  /** Resolve a `blob:sha256:…` attachment to a data URL, or null when unavailable. */
  resolveBlob(ref: string, mimeType: string): Promise<string | null>;
  openImage(src: string): void;
  onRevertToTerminal(): void;
  /** Drop a starter prompt into the composer so the user can edit or send it. */
  onStarterPrompt(text: string): void;
}

/** Session facts shown on the landing screen of an empty chat. */
export interface ChatSessionMeta {
  model: string | null;
  cwd: string | null;
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

/** Grow a delta backwards to its word start: a lone "." must not be its own box. */
function wordExtendedCount(text: string, added: number): number {
  let start = Math.max(0, text.length - added);
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
    const span = document.createElement("span");
    span.className = "chat-stream-new";
    tail.replaceWith(span);
    span.append(tail);
  }
}


/** One continuous execution sequence (thinking + tool steps) under one header. */
interface ActivityGroup {
  readonly node: HTMLDetailsElement;
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
  private readonly inflightStack: HTMLSpanElement;
  private inflightLabel: HTMLSpanElement;
  private readonly inflightElapsed: HTMLSpanElement;
  private readonly jumpLatest: HTMLButtonElement;
  private readonly empty: HTMLDivElement;
  private readonly emptyText: HTMLParagraphElement;
  private readonly emptyMeta: HTMLDivElement;
  /** Optimistic echo of a just-sent prompt; omp only persists it once the turn ends. */
  private pendingUser: HTMLDivElement | null = null;

  /** Every row known for this session, including those windowed out of the DOM. */
  private rows: TranscriptRow[] = [];
  /** Index into `rows` of the oldest row currently in the DOM. */
  private windowStart = 0;
  private pinned = true;
  private activity: ControlBridgeActivity = "idle";
  private activitySince: number | null = null;
  private ticker: number | null = null;
  /** Live turn shadow: cleared as soon as the persisted rows catch up. */
  private readonly live: HTMLDivElement;
  private readonly liveKind: HTMLSpanElement;
  private readonly liveBody: HTMLDivElement;
  private liveStale = false;
  private liveTimer: number | null = null;
  /** Latched so a 1 Hz elapsed tick never restarts the label animation. */
  private activityLabel = "";
  private toolDensity: ToolDensity = "compact";
  private collapseReasoningOnReply = false;
  /** Compact only: manual expansion shows literal payload text, not the card. */
  private rawTextOnExpand = false;
  /** Latched per turn so the fold happens once, not on every text delta. */
  private reasoningCollapsedForTurn = false;
  private currentZoom = DEFAULT_CHAT_ZOOM;
  private onZoomChange: ((zoom: number) => void) | null = null;
  /** Group key of the last row appended to the live window, so a fresh append continues the same run. */
  private tailGroupKey: string | null = null;
  /** Activity section still open at the tail, so an appended row continues it. */
  private tailActivity: ActivityGroup | null = null;

  constructor(private readonly hooks: ChatViewHooks) {
    this.el = el("div", "chat-view");

    this.scroll = el("div", "chat-scroll");
    this.loadEarlier = el("button", "chat-load-earlier");
    this.loadEarlier.type = "button";
    this.loadEarlier.hidden = true;
    this.rowsEl = el("div", "chat-rows");
    this.live = el("div", "chat-row chat-assistant chat-live");
    this.live.hidden = true;
    const liveHead = el("div", "chat-head");
    this.liveKind = el("span", "chat-who", "Agent");
    liveHead.append(this.liveKind);
    this.liveBody = el("div", "chat-md");
    this.live.append(liveHead, this.liveBody);

    this.inflight = el("div", "chat-inflight");
    this.inflight.hidden = true;
    this.inflightStack = el("span", "chat-inflight-stack");
    this.inflightLabel = el("span", "chat-inflight-label");
    this.inflightStack.append(this.inflightLabel);
    this.inflightElapsed = el("span", "chat-inflight-elapsed");
    this.inflight.append(this.inflightStack, this.inflightElapsed);
    this.zoomWrap = el("div", "chat-zoom-wrap");
    this.zoomWrap.append(this.loadEarlier, this.rowsEl, this.live, this.inflight);
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
    }

    // The persisted row now renders below the live row. Pull the live row out of
    // layout flow immediately so the visible text lands exactly where the static
    // row is — no double card, no scroll jump — then release it after its
    // blur-in animation has had time to finish.
    if (hasAssistant && !this.live.hidden) {
      this.live.style.position = "absolute";
      this.live.style.visibility = "hidden";
      this.live.style.pointerEvents = "none";
      this.clearLiveTimer();
      this.liveTimer = window.setTimeout(() => {
        this.live.style.position = "";
        this.live.style.visibility = "";
        this.live.style.pointerEvents = "";
        this.clearLive();
      }, LIVE_SETTLE_MS);
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
   * Render the reply as it is written.
   *
   * omp persists a message only once it is complete, so the transcript can
   * never show a turn in progress; this text comes from the control bridge's
   * `message_update` deltas instead. When the bridge reports the turn finished
   * (`null`) the row is kept a moment longer — the transcript tail is up to one
   * poll behind, and blanking early reads as a flicker.
   */
  setStream(stream: ControlBridgeStream | null | undefined): void {
    if (!stream || !stream.text) {
      if (!this.live.hidden && !this.liveStale) this.markLiveStale();
      return;
    }
    this.clearLiveTimer();
    this.liveStale = false;
    this.live.hidden = false;
    this.empty.hidden = true;
    const thinking = stream.kind === "thinking";
    // The reply's own prose has started, so the reasoning that preceded it is
    // no longer what the reader is waiting on: fold it away once per turn.
    if (!thinking && this.collapseReasoningOnReply && !this.reasoningCollapsedForTurn) {
      this.reasoningCollapsedForTurn = true;
      for (const details of this.el.querySelectorAll<HTMLDetailsElement>("details.chat-thinking")) {
        details.open = false;
      }
    }
    this.live.classList.toggle("chat-live-thinking", thinking);
    this.live.classList.toggle("chat-assistant", !thinking);
    this.live.classList.toggle("chat-thinking-row", thinking);
    this.liveKind.textContent = thinking ? "Thinking" : "Agent";
    this.appendStreamChunk(stream.text);
    if (this.pinned) this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  private renderedStreamText = "";
  /** Source of each rendered block, 1:1 with `liveBody`'s children. */
  private streamBlocks: string[] = [];

  /**
   * Render the in-flight reply as markdown while it is still being written.
   *
   * Re-rendering the whole reply on every delta is wasteful and destroys the
   * scroll position, so the text is split into markdown blocks and only the
   * blocks whose source actually changed are re-rendered — in practice the last
   * one. The characters that just arrived are then wrapped in animated spans,
   * extended back to their word boundary so punctuation never becomes its own
   * breakable box.
   */
  private appendStreamChunk(fullText: string): void {
    if (!fullText) return;

    const grew = this.renderedStreamText !== "" && fullText.startsWith(this.renderedStreamText);
    const added = grew ? fullText.length - this.renderedStreamText.length : 0;
    this.renderedStreamText = fullText;

    const blocks = splitMarkdownBlocks(fullText);
    let lastChanged = -1;
    for (let i = 0; i < blocks.length; i++) {
      const existing = this.liveBody.children[i];
      if (existing instanceof HTMLElement && this.streamBlocks[i] === blocks[i]) continue;
      const host = existing instanceof HTMLElement ? existing : el("div", "chat-stream-block");
      // Safe: `renderMarkdown` escapes its input before emitting any markup.
      host.innerHTML = renderMarkdown(blocks[i]);
      if (!existing) this.liveBody.append(host);
      lastChanged = i;
    }
    while (this.liveBody.children.length > blocks.length) this.liveBody.lastElementChild?.remove();
    this.streamBlocks = blocks;

    if (added <= 0 || lastChanged < 0) return;
    const tail = this.liveBody.children[lastChanged];
    if (tail instanceof HTMLElement) markStreamTail(tail, wordExtendedCount(fullText, added));
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

  /** Compact only: expand into literal payload text rather than the card. */
  setRawTextOnExpand(enabled: boolean): void {
    if (this.rawTextOnExpand === enabled) return;
    this.rawTextOnExpand = enabled;
    if (this.toolDensity === "compact") this.rebuild();
  }

  /** Model and folder shown on the landing screen of an empty chat. */
  setSessionMeta(meta: ChatSessionMeta): void {
    this.emptyMeta.replaceChildren();
    if (meta.model) this.emptyMeta.append(el("span", "chat-landing-chip", meta.model));
    if (meta.cwd) this.emptyMeta.append(el("span", "chat-landing-chip", meta.cwd));
  }

  /**
   * Echo a just-sent prompt immediately.
   *
   * omp writes a user message to the transcript only when the whole turn is
   * persisted, so without this the reply could appear seconds before the
   * prompt that caused it.
   */
  showPendingUser(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.clearPendingUser();
    const row = this.buildEntryRow(
      { id: "pending-user", role: "user", at: Date.now(), model: null, parts: [{ kind: "text", text: trimmed }] },
      true,
      false,
    );
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


  /** Drive the activity pill (what the agent is doing) beneath the live text. */
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
      return;
    }

    this.inflight.hidden = false;
    // A turn is in flight — this is no longer "empty", even before the first
    // persisted row lands (omp only writes a row once a turn completes).
    this.empty.hidden = true;
    this.paintActivity();
    if (this.ticker === null) this.ticker = window.setInterval(() => this.paintActivity(), 1000);
    if (this.pinned) this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  dispose(): void {
    this.stopTicker();
    this.clearLive();
    this.unmount();
    this.rows = [];
    this.rowsEl.replaceChildren();
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
    this.renderedStreamText = "";
    this.reasoningCollapsedForTurn = false;
    this.liveBody.replaceChildren();
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
    this.syncLoadEarlier();
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

  /** The wrapper for one execution sequence: a section, not another tool call. */
  private buildActivityGroup(entry: TranscriptEntry, fresh: boolean): ActivityGroup {
    const node = document.createElement("details");
    node.className = "chat-activity";
    if (fresh) node.classList.add("chat-row-fresh");
    node.open = this.toolDensity === "detailed";

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
    return { node, steps, count, n: 0, kinds: [], startedAt: entry.at || null, endedAt: entry.at || null };
  }

  /** Append this row's steps to the open sequence, preserving their order. */
  private appendActivitySteps(group: ActivityGroup, parts: readonly TranscriptPart[], fresh: boolean): void {
    let tools: ToolPart[] = [];
    const flush = (): void => {
      if (!tools.length) return;
      for (const action of summarizeToolParts(tools)) {
        group.kinds.push(action.kind);
        this.addStep(group, this.buildActionRow(action, this.toolDensity === "detailed"), fresh);
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
        this.addStep(group, this.buildDetails("chat-thinking", "Thought", part.text), fresh);
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
        return this.buildDetails("chat-thinking", "Thought", part.text);
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
    const open = this.toolDensity === "detailed";
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

  private buildDetails(className: string, summary: string, body: string): HTMLElement {
    const details = document.createElement("details");
    details.className = className;

    const head = document.createElement("summary");
    details.open =
      className === "chat-thinking" && this.toolDensity === "detailed" && !this.reasoningCollapsedForTurn;
    head.append(el("span", "chat-summary-text", summary));
    details.append(head);

    const pre = el("pre", "chat-pre");
    pre.textContent = body;
    details.append(pre);
    return details;
  }

  private buildImage(src: string, mimeType: string): HTMLElement {
    const wrap = el("div", "chat-image-wrap");

    const show = (url: string): void => {
      const img = el("img", "chat-image");
      img.src = url;
      img.alt = "Attachment";
      img.addEventListener("click", () => this.hooks.openImage(url));
      wrap.replaceChildren(img);
    };

    if (src.startsWith("blob:sha256:")) {
      wrap.append(el("div", "chat-image-pending", "Loading image\u2026"));
      void this.hooks.resolveBlob(src, mimeType).then((url) => {
        if (url) show(url);
        else wrap.replaceChildren(el("div", "chat-image-missing", "Image unavailable"));
      });
    } else {
      show(src);
    }

    return wrap;
  }
}
