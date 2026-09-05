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

/** Rows kept in the DOM; older rows load on demand rather than all at once. */
const WINDOW_ROWS = 400;
/** A result longer than this is clipped — the terminal remains the full record. */
const MAX_RESULT_CHARS = 20_000;
/** Distance from the bottom still counted as "following the conversation". */
const PIN_SLACK_PX = 40;
/** How long a finished reply stays on screen while the transcript tail catches up. */
const LIVE_SETTLE_MS = 3000;

export type ChatEmptyReason = "loading" | "no-session" | "empty";

export interface ChatViewHooks {
  copyText(text: string): void;
  openExternal(url: string): void;
  /** Resolve a `blob:sha256:…` attachment to a data URL, or null when unavailable. */
  resolveBlob(ref: string, mimeType: string): Promise<string | null>;
  openImage(src: string): void;
  onRevertToTerminal(): void;
}

const EMPTY_TEXT: Record<ChatEmptyReason, string> = {
  loading: "Reading session transcript\u2026",
  "no-session": "No transcript yet \u2014 this session has not produced a message.",
  empty: "This chat is empty.",
};

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

export class ChatView {
  readonly el: HTMLDivElement;

  private readonly scroll: HTMLDivElement;
  private readonly rowsEl: HTMLDivElement;
  private readonly loadEarlier: HTMLButtonElement;
  private readonly inflight: HTMLDivElement;
  private readonly inflightText: HTMLSpanElement;
  private readonly jumpLatest: HTMLButtonElement;
  private readonly empty: HTMLDivElement;
  private readonly emptyText: HTMLParagraphElement;

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
  private autoExpandTools = false;
  private autoExpandReasoning = true;

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
    liveHead.append(this.liveKind, el("span", "chat-live-caret"));
    this.liveBody = el("div", "chat-md");
    this.live.append(liveHead, this.liveBody);

    this.inflight = el("div", "chat-inflight");
    this.inflight.hidden = true;
    this.inflight.append(el("span", "chat-inflight-dot"));
    this.inflightText = el("span", "chat-inflight-text");
    this.inflight.append(this.inflightText);
    this.scroll.append(this.loadEarlier, this.rowsEl, this.live, this.inflight);

    this.jumpLatest = el("button", "chat-jump-latest", "Jump to latest");
    this.jumpLatest.type = "button";
    this.jumpLatest.hidden = true;

    this.empty = el("div", "chat-empty");
    this.emptyText = el("p", "chat-empty-text", EMPTY_TEXT.loading);
    const revert = el("button", "chat-empty-action", "Show terminal");
    revert.type = "button";
    revert.addEventListener("click", () => this.hooks.onRevertToTerminal());
    this.empty.append(this.emptyText, revert);

    this.el.append(this.scroll, this.jumpLatest, this.empty);

    this.scroll.addEventListener("scroll", () => {
      this.pinned = this.scroll.scrollHeight - this.scroll.scrollTop - this.scroll.clientHeight < PIN_SLACK_PX;
      this.jumpLatest.hidden = this.pinned;
    });
    this.jumpLatest.addEventListener("click", () => {
      this.pinned = true;
      this.jumpLatest.hidden = true;
      this.scroll.scrollTop = this.scroll.scrollHeight;
    });
    this.loadEarlier.addEventListener("click", () => this.showEarlier());

    // Markdown links must open in the user's browser; letting the renderer
    // navigate would replace the whole app window.
    this.el.addEventListener("click", (ev) => {
      const anchor = (ev.target as HTMLElement | null)?.closest("a.md-link") as HTMLAnchorElement | null;
      if (!anchor) return;
      ev.preventDefault();
      this.hooks.openExternal(anchor.href);
    });
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
    if (snapshot.replace) {
      this.rows = snapshot.rows.slice();
      this.rebuild();
    } else if (snapshot.rows.length) {
      this.rows.push(...snapshot.rows);
      this.appendRows(snapshot.rows);
    }

    // The persisted rows have caught up with whatever the live row was
    // shadowing, so drop it rather than render the same text twice.
    if (snapshot.rows.some((row) => row.type === "entry" && row.entry.role === "assistant")) {
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
    const thinking = stream.kind === "thinking";
    this.live.classList.toggle("chat-live-thinking", thinking);
    this.live.classList.toggle("chat-assistant", !thinking);
    this.live.classList.toggle("chat-thinking-row", thinking);
    this.liveKind.textContent = thinking ? "Thinking" : "Agent";
    this.liveBody.innerHTML = renderMarkdown(stream.text);
    if (this.pinned) this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  /** Expand or collapse tool groups without opening each tool's raw payload. */
  setAutoExpandTools(enabled: boolean): void {
    this.autoExpandTools = enabled;
    for (const details of this.el.querySelectorAll<HTMLDetailsElement>("details.chat-tool-group")) {
      details.open = enabled;
    }
  }

  /** Expand or collapse persisted reasoning rows. */
  setAutoExpandReasoning(enabled: boolean): void {
    this.autoExpandReasoning = enabled;
    for (const details of this.el.querySelectorAll<HTMLDetailsElement>("details.chat-thinking")) {
      details.open = enabled;
    }
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
      // A finished turn with no bridge stream update still has to release the row.
      if (!this.live.hidden && !this.liveStale) this.markLiveStale();
      return;
    }

    this.inflight.hidden = false;
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
    const elapsed = this.activitySince === null ? "" : ` \u00b7 ${formatElapsed(Date.now() - this.activitySince)}`;
    this.inflight.dataset.activity = kind;
    this.inflightText.textContent = `${label}${elapsed}`;
  }

  private rebuild(): void {
    this.rowsEl.replaceChildren();
    this.windowStart = Math.max(0, this.rows.length - WINDOW_ROWS);
    this.rowsEl.append(...this.rows.slice(this.windowStart).map((row) => this.buildRow(row)));
    this.syncLoadEarlier();
    this.pinned = true;
    this.jumpLatest.hidden = true;
    this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  private appendRows(rows: readonly TranscriptRow[]): void {
    const wasPinned = this.pinned;
    this.rowsEl.append(...rows.map((row) => this.buildRow(row, true)));
    if (wasPinned) this.scroll.scrollTop = this.scroll.scrollHeight;
    else this.jumpLatest.hidden = false;
  }

  private showEarlier(): void {
    const before = this.scroll.scrollHeight;
    const end = this.windowStart;
    this.windowStart = Math.max(0, end - WINDOW_ROWS);
    const frag = document.createDocumentFragment();
    for (const row of this.rows.slice(this.windowStart, end)) frag.append(this.buildRow(row));
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

  private buildRow(row: TranscriptRow, fresh = false): Node {
    if (row.type === "marker") {
      const marker = el("div", `chat-marker chat-marker-${row.marker.kind}`);
      marker.append(el("span", "chat-marker-rule"), el("span", "chat-marker-text", row.marker.text));
      return marker;
    }

    const entry = row.entry;
    if (entry.role !== "assistant") return this.buildEntryRow(entry, fresh);

    const thinking = entry.parts.filter((part) => part.kind === "thinking");
    if (!thinking.length) return this.buildEntryRow(entry, fresh);

    const fragment = document.createDocumentFragment();
    for (const part of thinking) {
      fragment.append(this.buildThinkingRow(entry, part, fresh));
    }

    const visibleParts = entry.parts.filter((part) => part.kind !== "thinking");
    if (visibleParts.length) {
      fragment.append(this.buildEntryRow({ ...entry, parts: visibleParts }, fresh));
    }
    return fragment;
  }

  /** Assistant thinking is context, so it renders in its own collapsed row. */
  private buildThinkingRow(
    entry: TranscriptEntry,
    part: Extract<TranscriptPart, { kind: "thinking" }>,
    fresh: boolean,
  ): HTMLDivElement {
    const node = el("div", "chat-row chat-thinking-row");
    if (fresh) node.classList.add("chat-row-fresh");

    const head = el("div", "chat-head");
    head.append(el("span", "chat-who", "Thinking"));
    if (entry.at) {
      head.append(el("span", "chat-time", new Date(entry.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })));
    }
    const body = el("div", "chat-body");
    body.append(this.buildDetails("chat-thinking", "Reasoning", part.text));
    node.append(head, body);
    return node;
  }

  private buildEntryRow(entry: TranscriptEntry, fresh: boolean): HTMLDivElement {
    const node = el("div", `chat-row chat-${entry.role}`);
    if (fresh) node.classList.add("chat-row-fresh");

    const head = el("div", "chat-head");
    head.append(el("span", "chat-who", entry.role === "user" ? "You" : entry.role === "tool" ? "Tool" : "Agent"));
    if (entry.model) head.append(el("span", "chat-model", entry.model));
    if (entry.at) {
      head.append(el("span", "chat-time", new Date(entry.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })));
    }
    node.append(head);

    const body = el("div", "chat-body");
    this.appendParts(body, entry.parts);
    node.append(body);
    return node;
  }

  /** Keep adjacent tool calls inside one collapsed activity group. */
  private appendParts(body: HTMLElement, parts: readonly TranscriptPart[]): void {
    let tools: Extract<TranscriptPart, { kind: "tool" }>[] = [];
    const flushTools = (): void => {
      if (!tools.length) return;
      body.append(tools.length === 1 ? this.buildTool(tools[0]) : this.buildToolGroup(tools));
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
        return this.buildDetails("chat-thinking", "Thinking", part.text);
      case "image":
        return this.buildImage(part.src, part.mimeType);
      case "tool":
        return this.buildTool(part);
    }
  }

  /**
   * One card per tool: header carries the outcome glyph, body shows arguments
   * and result stacked. Splitting them made every tool cost two rows of chrome.
   */
  private buildTool(part: Extract<TranscriptPart, { kind: "tool" }>): HTMLElement {
    const running = part.result === null;
    const details = document.createElement("details");
    details.className = `chat-tool${part.isError ? " chat-tool-error" : ""}${running ? " chat-tool-running" : ""}`;

    const head = document.createElement("summary");
    head.append(el("span", "chat-tool-badge", part.name));
    if (part.intent) head.append(el("span", "chat-summary-text", part.intent));
    head.append(el(
      "span",
      "chat-tool-state",
      running ? "\u2026" : part.isError ? "\u2716" : "\u2714",
    ));
    details.append(head);

    if (part.args && part.args !== "{}") {
      const args = el("pre", "chat-pre chat-tool-args");
      args.textContent = part.args;
      details.append(args);
    }

    if (part.result !== null) {
      const out = el("pre", "chat-pre");
      out.textContent = part.result.length > MAX_RESULT_CHARS
        ? `${part.result.slice(0, MAX_RESULT_CHARS)}\n\u2026 (truncated)`
        : part.result;
      details.append(out);
    }

    return details;
  }

  /**
   * Tool bursts are collapsed under one turn-level control. Individual calls
   * remain independently expandable when the group is opened.
   */
  private buildToolGroup(parts: readonly Extract<TranscriptPart, { kind: "tool" }>[]): HTMLElement {
    const latest = parts[parts.length - 1];
    const running = latest.result === null;
    const details = document.createElement("details");
    details.className = `chat-tool-group${latest.isError ? " chat-tool-error" : ""}${running ? " chat-tool-running" : ""}`;
    details.open = this.autoExpandTools;

    const head = document.createElement("summary");
    head.append(el("span", "chat-tool-badge", `${parts.length} tools`));
    head.append(el("span", "chat-tool-badge", latest.name));
    if (latest.intent) head.append(el("span", "chat-summary-text", latest.intent));
    head.append(el("span", "chat-tool-state", running ? "\u2026" : latest.isError ? "\u2716" : "\u2714"));
    details.append(head);

    const list = el("div", "chat-tool-list");
    for (const part of parts) list.append(this.buildTool(part));
    details.append(list);
    return details;
  }

  private buildText(text: string): HTMLElement {
    const wrap = el("div", "chat-md");
    // Safe: `renderMarkdown` escapes its input before emitting any markup.
    wrap.innerHTML = renderMarkdown(text);
    this.attachCopyButtons(wrap);

    const copy = el("button", "chat-copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => this.hooks.copyText(text));
    wrap.append(copy);
    return wrap;
  }

  /** Give every fenced block its own copy button; agents emit a lot of them. */
  private attachCopyButtons(scope: HTMLElement): void {
    for (const pre of Array.from(scope.querySelectorAll<HTMLPreElement>("pre.md-pre"))) {
      const copy = el("button", "md-copy", "Copy");
      copy.type = "button";
      copy.addEventListener("click", () => this.hooks.copyText(pre.querySelector("code")?.textContent ?? ""));
      pre.append(copy);
    }
  }

  private buildDetails(className: string, summary: string, body: string, badge?: string): HTMLElement {
    const details = document.createElement("details");
    details.className = className;

    const head = document.createElement("summary");
    if (badge) head.append(el("span", "chat-tool-badge", badge));
    details.open = className === "chat-thinking" && this.autoExpandReasoning;
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
