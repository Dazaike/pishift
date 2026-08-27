import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type IDisposable, type IMarker } from "@xterm/xterm";

import { bracketPaste } from "../shared/ipc";
import { encodeArrow, encodeKey, type KeyLike, type KeyMode } from "../shared/kitty-keys";
import { buildXtermTheme, FONT_FAMILY, FONT_SIZE, type ThemePreset } from "./theme";

/**
 * xterm 6 syncs only the scrollable element's *dimensions* on resize; the scroll
 * position is left clamped against a stale scrollHeight once `_latestYDisp` is
 * populated, which snaps the viewport toward the top of the scrollback. The
 * public scroll API is a no-op here (xterm's own `ydisp` never moved), so re-pin
 * through `Viewport.scrollToLine(line, force)` — the only primitive that both
 * writes the DOM offset instantly and refreshes xterm's cached position.
 */
type XtermInternals = {
  _core?: { _viewport?: { scrollToLine(line: number, force: boolean): void } };
};

/**
 * A resize anchor holds until the viewport has stayed put for this long. The
 * disturbance is not a fixed number of frames: ResizeObserver ticks, the 80ms
 * PTY resize debounce and omp's full-screen redraw all arrive separately, and a
 * restore lands later than a maximize.
 */
const REPIN_SETTLE_MS = 260;
/** Hard stop for the anchor, so a pathological case cannot pin forever. */
const REPIN_CEILING_MS = 3000;
/** Anchor re-check cadence for disturbances that arrive without a repaint. */
const REPIN_POLL_MS = 100;
/** Pointer travel before middle-button autoscroll engages. */
const AUTOSCROLL_DEADZONE_PX = 12;
const AUTOSCROLL_ROWS_PER_PX = 0.35;
/** Leading characters of a message used when jumping by scrollback search. */
const TEXT_JUMP_MAX_CHARS = 48;
/** Shared chrome row that hosts the keystroke-target chip and the jump pill. */
const JUMP_SLOT_ID = "key-target-row";
/** Keystroke-target chip that sits left of the pill and slides to make room. */
const CHIP_ID = "key-target-indicator";
/** Must match the `gap` on #key-target-row in styles.css. */
const CHIP_GAP_PX = 8;

export const MIN_SCROLL_STEPS = 1;
export const MAX_SCROLL_STEPS = 12;
export const DEFAULT_SCROLL_STEPS = 3;

export function clampScrollSteps(steps: number): number {
  if (!Number.isFinite(steps)) return DEFAULT_SCROLL_STEPS;
  return Math.min(MAX_SCROLL_STEPS, Math.max(MIN_SCROLL_STEPS, Math.round(steps)));
}

export interface TermViewHooks {
  /** Bytes to the PTY. */
  write(data: string): void;
  resize(cols: number, rows: number): void;
  setTitle(title: string): void;
  setBusy(busy: boolean): void;
  notify(body: string): void;
  /** User hit Esc / bare Ctrl+C — host should drop working chrome optimistically. */
  onUserCancel?(): void;
  /** User referenced a highlighted region — host attaches it to the composer. */
  onReferenceSelection?(text: string): void;
  /** Fired when text is copied specifically from the terminal. */
  onCopyFromTerminal?(text: string): void;
}
const PTY_RESIZE_DEBOUNCE_MS = 80;
const MIN_FONT = 8;
const MAX_FONT = 32;

/** One xterm.js terminal, one PTY session, one tab body. */
export class TermView {
  readonly el: HTMLDivElement;
  private readonly term: Terminal;
  private readonly fit = new FitAddon();
  private readonly search = new SearchAddon();
  private readonly image = new ImageAddon({
    // omp only ever emits iTerm2 inline images (IIP); no capability profile maps
    // to sixel. Size reports (CSI 14t/16t) must stay enabled — omp uses them to
    // pick image cell dimensions.
    sixelSupport: false,
    iipSupport: true,
    iipSizeLimit: 33_554_432,
    storageLimit: 256,
  });
  private webgl: WebglAddon | null = null;
  private observer: ResizeObserver | null = null;
  private rafHandle: number | undefined;
  private ptyResizeTimer: number | undefined;
  private repinRender: IDisposable | null = null;
  private repinTimer: number | undefined;
  private repinMarker: IMarker | null = null;
  private repinAtBottom = true;
  private repinOffset = 0;
  private repinCeiling = 0;
  private repinDeadline = 0;
  private readonly autoScroll = new AbortController();
  private opened = false;
  private disposed = false;
  private lastFeedAt = 0;
  private lastCols = 0;
  private lastRows = 0;
  /** DECCKM — when true, interactive TUI menus want arrow keys as SS3. */
  private appCursorKeys = false;

  /** Depth of omp's `CSI > <flags> u` kitty-keyboard pushes. */
  private kittyDepth = 0;

  /** Enhanced-key protocol omp negotiated for this session. */
  private keyMode: KeyMode = "legacy";
  private currentFontSize = FONT_SIZE;
  private searchBar: HTMLDivElement | null = null;
  private onFontSizeChange: ((size: number) => void) | null = null;
  private jumpBtn: HTMLButtonElement | null = null;
  private atBottom = true;
  /** Floating "Reference" affordance shown over a finished mouse selection. */
  private selectionBubble: HTMLButtonElement | null = null;
  private selectionDragging = false;

  constructor(
    private readonly hooks: TermViewHooks,
    themePreset?: ThemePreset,
    initialFontSize?: number,
  ) {
    this.el = document.createElement("div");
    this.el.className = "view";

    const fontSize =
      typeof initialFontSize === "number" && Number.isFinite(initialFontSize)
        ? Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(initialFontSize)))
        : FONT_SIZE;
    this.currentFontSize = fontSize;

    this.term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: FONT_FAMILY,
      fontSize,
      fontWeight: "normal",
      fontWeightBold: "bold",
      scrollback: 20_000,
      // Smoothing plus a multiplied notch: several rows per detent, glided over
      // ~200ms, so a page of scrollback takes a few flicks instead of dozens.
      // The multiplier is user-tunable via setScrollSteps.
      smoothScrollDuration: 200,
      scrollSensitivity: DEFAULT_SCROLL_STEPS,
      fastScrollSensitivity: 10,
      macOptionIsMeta: false,
      windowsPty: window.omphif.windowsPty,
      theme: themePreset ? buildXtermTheme(themePreset) : undefined,
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = "11";
    this.term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        if (window.omphif?.openExternal) {
          void window.omphif.openExternal(uri);
        } else if (/^https?:\/\//i.test(uri)) {
          window.open(uri, "_blank", "noopener,noreferrer");
        }
      }),
    );
    this.term.loadAddon(this.search);

    this.term.onData((data) => this.hooks.write(data));
    this.term.onBinary((data) => this.hooks.write(data));
    this.registerSequenceHandlers();
    this.term.attachCustomKeyEventHandler((ev) => this.handleKey(ev));

    // xterm.js would otherwise deliver a second, competing paste; Ctrl+V is
    // forwarded to omp as 0x16 so omp reads the OS clipboard itself.
    this.el.addEventListener("paste", (ev) => ev.preventDefault());

    this.el.addEventListener("copy", () => {
      const selected = this.term.getSelection();
      if (selected) {
        this.hooks.onCopyFromTerminal?.(selected);
      }
    });

    this.el.addEventListener(
      "wheel",
      (ev) => {
        if (ev.ctrlKey) {
          ev.preventDefault();
          if (ev.deltaY < 0) this.zoomIn();
          else this.zoomOut();
          return;
        }
        // Manual scrolling always wins over a resize anchor still in flight.
        this.endRepin();
      },
      { passive: false },
    );
  }

  /** Attach to the DOM tree and (first time only) open the terminal. */
  activate(parent: HTMLElement): void {
    if (this.disposed) return;
    if (!this.el.parentElement) parent.appendChild(this.el);
    this.el.classList.add("active");

    if (!this.opened) {
      this.term.open(this.el);
      this.opened = true;
      this.term.loadAddon(this.image);
      this.loadWebgl();
      this.observer = new ResizeObserver(() => this.scheduleFit());
      this.observer.observe(this.el);
      this.installJumpToBottom();
      this.installSelectionAction();
      this.installAutoScroll();
    }
    this.applyFit();
    this.syncJumpButton();
    this.term.focus();
  }

  deactivate(): void {
    this.el.classList.remove("active");
    // The pill lives in shared chrome, so a background view must not leave one
    // showing next to another tab's focus chip.
    if (this.jumpBtn) {
      this.jumpBtn.classList.remove("leaving");
      this.jumpBtn.hidden = true;
    }
    this.atBottom = true;
  }

  /** PTY data in, with the flow-control ack fired once the parser has consumed it. */
  feed(data: string, ack: () => void): void {
    if (this.disposed) {
      // The PTY stays paused until someone acks; dropping this wedges omp.
      ack();
      return;
    }
    this.lastFeedAt = Date.now();
    try {
      this.term.write(data, ack);
    } catch {
      // xterm throws past its 50 MB DISCARD_WATERMARK and on parser faults.
      // write() throws before queueing the callback, so ack here. pty.resume()
      // is idempotent, so a late queued callback acking again is harmless.
      ack();
    }
  }

  /** Resolves once PTY output has been quiet for `quietMs`, or after `timeoutMs` total elapsed, whichever comes first. */
  async waitForQuiet(quietMs: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const idleFor = Date.now() - this.lastFeedAt;
      if (idleFor >= quietMs) return;
      await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(quietMs - idleFor, 20)));
    }
  }

  /** Send user text as a bracketed paste (never submits on its own). */
  paste(text: string): void {
    if (text) this.hooks.write(bracketPaste(text));
  }

  /**
   * Registers a marker at the row the cursor currently sits on — call this
   * right before submitting so it anchors to the just-typed, already-visible
   * composer line.
   */
  markCurrentLine(): IMarker {
    return this.term.registerMarker(0);
  }

  /**
   * Scrolls a marker registered via markCurrentLine() into view, using the
   * same viewport primitive the resize-repin path uses. No-ops once the
   * marker's line has scrolled out of the 20k-line scrollback and xterm has
   * disposed it.
   */
  scrollToMarker(marker: IMarker): void {
    if (marker.isDisposed) return;
    this.endRepin();
    this.pinViewport(marker.line);
  }

  /**
   * Best-effort jump for a message with no marker (one backfilled from a
   * session transcript): find its text in the scrollback and scroll there.
   * Returns false when the text is not in the buffer at all — the turn
   * predates this window and was never replayed.
   *
   * Only the first line is used, and only its leading characters: a long turn
   * wraps and a multi-line one cannot match a single search term.
   */
  scrollToText(text: string): boolean {
    const needle = (text.split("\n")[0] ?? "").trim().slice(0, TEXT_JUMP_MAX_CHARS);
    if (!needle) return false;
    this.endRepin();
    // findPrevious walks backwards, so seeking from the bottom lands on the
    // most recent occurrence rather than the oldest.
    this.term.scrollToBottom();
    return this.search.findPrevious(needle, { caseSensitive: false });
  }

  /**
   * Send text as if typed, so omp's line editor sees a command line rather than
   * pasted content. CR/LF are stripped: submitting is the caller's decision.
   */
  type(text: string): void {
    const safe = text.replace(/[\r\n]+/g, " ").replace(/\x1b/g, "");
    if (safe) this.hooks.write(safe);
  }

  /** Submit the current omp prompt line. */
  submit(): void {
    this.hooks.write("\r");
  }

  /**
   * Clear the current omp prompt line, type a slash command, and submit.
   * Sent as one write so kitty/ConPTY cannot interleave other input.
   */
  runSlash(command: string): void {
    const cmd = command.trim().replace(/[\r\n]+/g, " ");
    if (!cmd) return;
    const body = cmd.startsWith("/") ? cmd : `/${cmd}`;
    // Ctrl+U clears the line in both legacy and most kitty configurations.
    // Also emit the kitty encoding so clear works when progressive enhancement
    // has disabled raw C0 handling for modified keys.
    const clear =
      this.keyMode === "kitty"
        ? "\x1b[117;5u" // Ctrl+U (u=117, ctrl => mask 4, encoded 5)
        : "\x15";
    this.hooks.write(`${clear}${body}\r`);
  }

  /**
   * Inject a modifier chord into the PTY (kitty / modifyOtherKeys / legacy ESC).
   * Used for native omp keybindings such as Alt+Shift+P (plan toggle).
   */
  sendChord(key: string, mods: { alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean }): void {
    const mask = 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0) + (mods.meta ? 8 : 0);
    const code = key.length === 1 ? key.toLowerCase().charCodeAt(0) : (key === "Enter" ? 13 : key === "Escape" ? 27 : 0);

    if (this.keyMode === "kitty" && code > 0 && mask > 1) {
      this.hooks.write(`\x1b[${code};${mask}u`);
      return;
    }
    if (this.keyMode === "modifyOtherKeys" && code > 0 && mask > 1) {
      this.hooks.write(`\x1b[27;${mask};${code}~`);
      return;
    }

    const ev = {
      key,
      altKey: !!mods.alt,
      shiftKey: !!mods.shift,
      ctrlKey: !!mods.ctrl,
      metaKey: !!mods.meta,
    };
    const encoded = encodeKey(ev, this.keyMode);
    if (encoded) {
      this.hooks.write(encoded);
      return;
    }
    // Legacy fallbacks xterm would emit for alt chords.
    if (mods.alt && key.length === 1) {
      const ch = mods.shift ? key.toUpperCase() : key.toLowerCase();
      this.hooks.write(`\x1b${ch}`);
      return;
    }
    if (mods.ctrl && key.length === 1) {
      const charCode = key.toUpperCase().charCodeAt(0) - 64;
      if (charCode >= 1 && charCode <= 26) {
        this.hooks.write(String.fromCharCode(charCode));
        return;
      }
    }
    // Last resort: type the key.
    this.type(key);
  }

  /** Send raw escape sequence directly to PTY. */
  writeRaw(data: string): void {
    this.hooks.write(data);
  }

  /**
   * Encode a modifier chord for the session's negotiated keyboard protocol.
   * Returns false when nothing was sent, so the caller can keep the event.
   */
  forwardChord(ev: KeyboardEvent): boolean {
    const seq = encodeKey(ev, this.keyMode);
    if (!seq) return false;
    this.hooks.write(seq);
    return true;
  }

  focus(): void {
    this.term.focus();
  }

  /** True when the PTY enabled application cursor keys (interactive arrow UIs). */
  wantsArrowKeys(): boolean {
    return this.appCursorKeys;
  }

  /** Encode and write an arrow key using the current cursor-key mode. */
  writeArrow(ev: KeyLike): boolean {
    const seq = encodeArrow(ev, this.appCursorKeys);
    if (!seq) return false;
    this.hooks.write(seq);
    return true;
  }

  setTheme(preset: ThemePreset): void {
    this.term.options.theme = buildXtermTheme(preset);
  }

  zoomIn(): void {
    if (this.currentFontSize >= MAX_FONT) return;
    this.setFontSize(this.currentFontSize + 1);
  }

  zoomOut(): void {
    if (this.currentFontSize <= MIN_FONT) return;
    this.setFontSize(this.currentFontSize - 1);
  }

  resetZoom(): void {
    this.setFontSize(FONT_SIZE);
  }

  getFontSize(): number {
    return this.currentFontSize;
  }

  setFontSizeChangeHandler(handler: ((size: number) => void) | null): void {
    this.onFontSizeChange = handler;
  }

  getSelection(): string {
    return this.term.getSelection();
  }

  clear(): void {
    this.term.clear();
  }

  openSearch(): void {
    if (!this.searchBar) this.toggleSearch();
  }

  private setFontSize(size: number): void {
    const next = Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(size)));
    if (next === this.currentFontSize && this.term.options.fontSize === next) return;
    this.currentFontSize = next;
    this.term.options.fontSize = next;
    this.applyFit();
    this.onFontSizeChange?.(next);
  }

  /** Apply a restored zoom without firing the change handler (boot path). */
  applyPersistedFontSize(size: number): void {
    const next = Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(size)));
    this.currentFontSize = next;
    this.term.options.fontSize = next;
    this.applyFit();
  }

  setFontFamily(family: string): void {
    this.term.options.fontFamily = family;
    this.applyFit();
  }

  /** Rows advanced per wheel detent (settings slider). */
  setScrollSteps(steps: number): void {
    this.term.options.scrollSensitivity = clampScrollSteps(steps);
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    clearTimeout(this.ptyResizeTimer);
    this.observer?.disconnect();
    this.observer = null;
    this.webgl?.dispose();
    this.webgl = null;
    this.endRepin();
    this.autoScroll.abort();
    // Reparented into shared chrome, so el.remove() would not take it along.
    this.jumpBtn?.remove();
    this.jumpBtn = null;
    this.term.dispose();
    this.el.remove();
  }

  private loadWebgl(): void {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        this.webgl = null;
      });
      this.term.loadAddon(webgl);
      this.webgl = webgl;
    } catch {
      // No GL context available: the DOM renderer stays in place.
      this.webgl = null;
    }
  }

  private scheduleFit(): void {
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = undefined;
      this.applyFit(false);
    });
  }

  refit(): void {
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = undefined;
    }
    this.applyFit(true);
  }

  private applyFit(immediatePty = true): void {
    if (this.disposed || !this.opened || !this.el.classList.contains("active")) return;
    if (this.el.clientWidth < 8 || this.el.clientHeight < 8) return;

    const buffer = this.term.buffer.active;
    const wasAtBottom = buffer.viewportY >= buffer.baseY;
    // Reflow renumbers absolute lines; a marker tracks the viewport's top line
    // through that renumbering so a mid-scrollback resize doesn't jump the view.
    const marker = wasAtBottom
      ? null
      : this.term.registerMarker(buffer.viewportY - buffer.baseY - buffer.cursorY);

    this.fit.fit();

    const cols = this.term.cols;
    const rows = this.term.rows;
    // Skip PTY resize when the cell grid is unchanged — stops omp redraw flicker
    // when the composer grows a few pixels without changing rows.
    if (cols !== this.lastCols || rows !== this.lastRows) {
      this.lastCols = cols;
      this.lastRows = rows;
      clearTimeout(this.ptyResizeTimer);
      if (immediatePty) {
        this.hooks.resize(cols, rows);
      } else {
        this.ptyResizeTimer = window.setTimeout(() => {
          if (!this.disposed) {
            this.hooks.resize(cols, rows);
          }
        }, PTY_RESIZE_DEBOUNCE_MS);
      }
    }

    // Keep re-asserting: a maximize fires several ResizeObserver ticks and xterm
    // re-clamps the offset on each of its own render passes, so a fixed number of
    // frames is not enough — hold the anchor until the resize storm settles.
    this.beginRepin(wasAtBottom, marker, buffer.baseY - buffer.viewportY);
  }

  /**
   * Anchor the viewport across a resize. `atBottom` sticks to live output;
   * otherwise the marker's absolute line wins, with distance-from-bottom as the
   * fallback for when reflow has already disposed the marker.
   */
  private beginRepin(atBottom: boolean, marker: IMarker | null, bottomOffset: number): void {
    if (this.repinMarker !== marker) this.repinMarker?.dispose();
    this.repinMarker = marker;
    this.repinAtBottom = atBottom;
    this.repinOffset = Math.max(0, bottomOffset);
    const now = Date.now();
    this.repinCeiling = now + REPIN_CEILING_MS;
    this.repinDeadline = now + REPIN_SETTLE_MS;
    // onRender catches the clamp the moment it becomes visible; the interval
    // covers late disturbances (omp's post-resize redraw) that arrive after the
    // render storm has already died down.
    this.repinRender ??= this.term.onRender(() => this.applyRepin());
    this.repinTimer ??= window.setInterval(() => this.applyRepin(), REPIN_POLL_MS);
    this.applyRepin();
  }

  private applyRepin(): void {
    if (this.disposed || !this.repinRender) return;
    const buffer = this.term.buffer.active;
    const marker = this.repinMarker;
    const target = this.repinAtBottom
      ? buffer.baseY
      : marker && marker.line >= 0
        ? marker.line
        : buffer.baseY - this.repinOffset;
    const now = Date.now();
    if (buffer.viewportY !== target) {
      // Re-pinning to the line already displayed emits no scroll event, so this
      // cannot recurse through onRender.
      this.pinViewport(target);
      // Something is still moving the viewport: keep watching a bit longer,
      // bounded by the ceiling so a pathological case cannot pin forever.
      this.repinDeadline = Math.min(now + REPIN_SETTLE_MS, this.repinCeiling);
    }
    if (now >= this.repinDeadline || now >= this.repinCeiling) this.endRepin();
  }

  /** Drop the anchor: the resize settled, the view died, or the user took over. */
  private endRepin(): void {
    if (this.repinTimer !== undefined) clearInterval(this.repinTimer);
    this.repinTimer = undefined;
    this.repinRender?.dispose();
    this.repinRender = null;
    this.repinMarker?.dispose();
    this.repinMarker = null;
  }

  /**
   * Middle-button autoscroll: hold to scroll continuously, speed proportional to
   * how far the pointer sits from the press point. Captured on the wrapper so
   * xterm never sees the button and cannot report it to a mouse-tracking app.
   */
  private installAutoScroll(): void {
    let originY = 0;
    let pointerY = 0;
    let lastTick = 0;
    let carry = 0;
    let frame: number | undefined;

    const stop = (): void => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      carry = 0;
      this.el.classList.remove("term-autoscrolling");
    };

    const tick = (now: number): void => {
      if (frame === undefined || this.disposed) return;
      const dt = Math.min(64, now - lastTick) / 1000;
      lastTick = now;
      const distance = pointerY - originY;
      const past = Math.abs(distance) - AUTOSCROLL_DEADZONE_PX;
      if (past > 0) {
        carry += Math.sign(distance) * past * AUTOSCROLL_ROWS_PER_PX * dt;
        const rows = Math.trunc(carry);
        if (rows !== 0) {
          carry -= rows;
          this.term.scrollLines(rows);
        }
      }
      frame = requestAnimationFrame(tick);
    };

    const signal = this.autoScroll.signal;
    this.el.addEventListener(
      "mousedown",
      (ev) => {
        if (ev.button !== 1) return;
        ev.preventDefault();
        ev.stopPropagation();
        // A resize anchor still holding would fight the user's scrolling.
        this.endRepin();
        originY = ev.clientY;
        pointerY = ev.clientY;
        lastTick = performance.now();
        if (frame === undefined) frame = requestAnimationFrame(tick);
        this.el.classList.add("term-autoscrolling");
      },
      { capture: true, signal },
    );

    this.el.addEventListener(
      "mousemove",
      (ev) => {
        if (frame !== undefined) pointerY = ev.clientY;
      },
      { signal },
    );

    // mouseup can land outside the element (or outside the window) — listen wide.
    window.addEventListener(
      "mouseup",
      (ev) => {
        if (ev.button === 1 && frame !== undefined) {
          ev.preventDefault();
          stop();
        }
      },
      { signal },
    );
    window.addEventListener("blur", stop, { signal });
    signal.addEventListener("abort", stop);
  }

  private pinViewport(line: number): void {
    const target = Math.max(0, line);
    const viewport = (this.term as unknown as XtermInternals)._core?._viewport;
    if (viewport) {
      viewport.scrollToLine(target, true);
      return;
    }
    // Future xterm rename: degrade to the public API instead of throwing.
    if (target >= this.term.buffer.active.baseY) this.term.scrollToBottom();
    else this.term.scrollToLine(target);
  }

  /**
   * Highlight-to-reference: after a mouse selection settles, float a pill over
   * the selection's first row. Clicking it hands the exact text to the host,
   * which turns it into a composer reference chip.
   *
   * The bubble is only shown for pointer selections that have ended — showing
   * it while the drag is live would fight the pointer under the cursor.
   */
  private installSelectionAction(): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "term-selection-action";
    btn.hidden = true;
    btn.title = "Add this selection to the composer as a reference";
    btn.innerHTML =
      '<span class="term-selection-icon" aria-hidden="true">&#8220;</span><span>Reference</span>';
    // Keep focus where it is: mousedown default would pull it off the terminal
    // and xterm clears the selection the moment it loses the pointer target.
    btn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const text = this.term.getSelection();
      this.hideSelectionAction();
      if (!text.trim()) return;
      this.term.clearSelection();
      this.hooks.onReferenceSelection?.(text);
    });
    this.el.appendChild(btn);
    this.selectionBubble = btn;

    this.el.addEventListener("mousedown", (ev) => {
      if (this.selectionBubble && (ev.target === this.selectionBubble || this.selectionBubble.contains(ev.target as Node))) {
        return;
      }
      this.selectionDragging = true;
      this.hideSelectionAction();
    });
    // Window-level: a drag that ends outside the terminal still finishes here.
    window.addEventListener("mouseup", this.onSelectionMouseUp, {
      signal: this.autoScroll.signal,
    });
    this.term.onSelectionChange(() => {
      if (this.selectionDragging) return;
      if (this.term.hasSelection()) this.showSelectionAction();
      else this.hideSelectionAction();
    });
    // Keyboard input and scrolling both invalidate the anchor position.
    this.term.onScroll(() => this.hideSelectionAction());
    this.term.onData(() => {
      if (!this.term.hasSelection()) this.hideSelectionAction();
    });
  }

  private readonly onSelectionMouseUp = (): void => {
    if (!this.selectionDragging) return;
    this.selectionDragging = false;
    if (this.term.hasSelection()) this.showSelectionAction();
  };

  private showSelectionAction(): void {
    const btn = this.selectionBubble;
    if (!btn) return;
    const range = this.term.getSelectionPosition();
    const screen = this.el.querySelector(".xterm-screen") as HTMLElement | null;
    if (!range || !screen || !this.term.getSelection().trim()) {
      this.hideSelectionAction();
      return;
    }

    // Rect math, not offsetLeft: xterm's screen sits inside .xterm, so offsets
    // are relative to that wrapper rather than the .view the bubble lives in.
    const screenRect = screen.getBoundingClientRect();
    const hostRect = this.el.getBoundingClientRect();
    const originX = screenRect.left - hostRect.left;
    const originY = screenRect.top - hostRect.top;
    const cellW = screenRect.width / this.term.cols;
    const cellH = screenRect.height / this.term.rows;
    const viewportY = this.term.buffer.active.viewportY;
    const startRow = range.start.y - viewportY;
    const endRow = range.end.y - viewportY;

    // Selection scrolled fully out of view — nothing to anchor to.
    if (endRow < 0 || startRow >= this.term.rows) {
      this.hideSelectionAction();
      return;
    }

    // Unhide first: layout is needed to measure the pill for clamping.
    btn.hidden = false;
    const maxLeft = Math.max(0, this.el.clientWidth - btn.offsetWidth - 8);
    const left = Math.min(Math.max(0, originX + range.start.x * cellW), maxLeft);
    // Prefer sitting above the first selected row; drop below when clipped.
    const above = originY + startRow * cellH - btn.offsetHeight - 6;
    const below = originY + (endRow + 1) * cellH + 6;
    const maxTop = Math.max(0, this.el.clientHeight - btn.offsetHeight - 4);
    const top = Math.min(above >= 0 ? above : below, maxTop);
    btn.style.left = `${Math.round(left)}px`;
    btn.style.top = `${Math.round(top)}px`;
  }

  private hideSelectionAction(): void {
    const btn = this.selectionBubble;
    if (!btn || btn.hidden) return;
    btn.hidden = true;
  }

  /** Scroll-off-bottom affordance; one click returns to live output. */
  private installJumpToBottom(): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "term-jump-latest";
    btn.hidden = true;
    btn.title = "Jump to latest output";
    btn.innerHTML =
      '<span class="term-jump-arrow" aria-hidden="true">&#x2193;</span><span>Latest</span>';
    // Never steal the caret: mousedown default is what moves focus to a button,
    // so suppressing it leaves the composer (or the terminal) exactly as it was.
    btn.addEventListener("mousedown", (ev) => ev.preventDefault());
    btn.addEventListener("click", () => {
      // A resize anchor still in flight would drag the view straight back.
      this.endRepin();
      // Public scrollToBottom() goes through scrollLines(), which animates with
      // smoothScrollDuration — exactly the wanted feel here.
      this.term.scrollToBottom();
    });
    // Sit in the keystroke-target row, to the right of the focus chip: same
    // baseline, no dock/scrollbar collision. Fall back to the view if absent.
    const slot = document.getElementById(JUMP_SLOT_ID) ?? this.el;
    slot.appendChild(btn);
    this.jumpBtn = btn;
    // Hide only once the exit animation has played out, and let the focus chip
    // glide into the freed space instead of teleporting.
    btn.addEventListener("animationend", (ev) => {
      if (ev.animationName === "term-jump-out" && btn.classList.contains("leaving")) {
        const width = btn.offsetWidth + CHIP_GAP_PX;
        btn.classList.remove("leaving");
        btn.hidden = true;
        this.slideChip(-width);
      }
    });
    this.term.onScroll(() => this.syncJumpButton());
    this.term.onRender(() => this.syncJumpButton());
    this.syncJumpButton();
  }

  /**
   * FLIP the focus chip: flex reflow is not animatable, so start it at its old
   * offset and let a transform transition carry it to the new one. Only runs
   * while the chip is actually showing — i.e. the terminal holds the keys.
   */
  private slideChip(shift: number): void {
    const chip = document.getElementById(CHIP_ID);
    if (!chip || chip.hidden || shift === 0) return;
    // Mid-entrance the chip's own keyframes own `transform`; sliding would be
    // overridden and then snap when the animation released it.
    if (chip.getAnimations().some((anim) => anim.playState === "running")) return;
    // No transition on the jump back to the old offset — only on the return.
    chip.style.transition = "none";
    chip.style.transform = `translateX(${shift}px)`;
    requestAnimationFrame(() => {
      chip.style.transition = "transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1)";
      chip.style.transform = "translateX(0)";
    });
  }

  private syncJumpButton(): void {
    const btn = this.jumpBtn;
    if (!btn) return;
    const buffer = this.term.buffer.active;
    // One row of slack: a single-row offset still reads as "at the bottom".
    const atBottom = buffer.viewportY >= buffer.baseY - 1;
    if (atBottom === this.atBottom) return;
    this.atBottom = atBottom;
    if (atBottom) {
      // Already hidden (first sync of a fresh view): skip the exit animation.
      if (!btn.hidden) btn.classList.add("leaving");
    } else {
      btn.classList.remove("leaving");
      btn.hidden = false;
      // Now measurable: the chip has just been pushed left by this much.
      this.slideChip(btn.offsetWidth + CHIP_GAP_PX);
    }
  }

  private registerSequenceHandlers(): void {
    const onTitle = (title: string): boolean => {
      this.hooks.setTitle(title);
      return true;
    };
    this.term.parser.registerOscHandler(0, onTitle);
    this.term.parser.registerOscHandler(2, onTitle);

    // OSC 9 is overloaded by omp: `4;<state>[;<progress>]` is a ConEmu progress
    // report (`3` = indeterminate running, `0` = clear). Anything else is a
    // desktop notification body.
    this.term.parser.registerOscHandler(9, (data) => {
      if (data === "4" || data.startsWith("4;")) {
        const state = data === "4" ? "0" : (data.slice(2).split(";")[0] ?? "0");
        // 0 = remove, anything else (1 value / 2 error / 3 indeterminate / 4 paused) = busy
        this.hooks.setBusy(state !== "" && state !== "0");
      } else if (data) {
        this.hooks.notify(data);
      }
      return true;
    });

    // Enhanced keyboard negotiation. Answering the kitty query immediately avoids
    // omp's negotiation timeout; omp then either pushes kitty flags or switches on
    // modifyOtherKeys, and the encoder follows whichever it chose.
    this.term.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => {
      this.hooks.write("\x1b[?1u");
      return true;
    });
    this.term.parser.registerCsiHandler({ prefix: ">", final: "u" }, () => {
      this.kittyDepth++;
      this.keyMode = "kitty";
      return true;
    });
    this.term.parser.registerCsiHandler({ prefix: "<", final: "u" }, () => {
      this.kittyDepth = Math.max(0, this.kittyDepth - 1);
      if (this.kittyDepth === 0) this.keyMode = "legacy";
      return true;
    });

    // `CSI > 4 ; <level> m` — modifyOtherKeys, omp's fallback when the kitty probe
    // is not honoured. Level 0 turns it back off.
    this.term.parser.registerCsiHandler({ prefix: ">", final: "m" }, (params) => {
      if (params[0] !== 4) return false;
      const level = typeof params[1] === "number" ? params[1] : 0;
      if (this.kittyDepth === 0) {
        this.keyMode = level > 0 ? "modifyOtherKeys" : "legacy";
      }
      return true;
    });

    // DECCKM — application cursor keys. Interactive TUIs (pickers, menus) set this
    // so we can route arrows from the composer without stealing normal typing.
    this.term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
      for (const p of params) {
        if (p === 1 || (Array.isArray(p) && p[0] === 1)) this.appCursorKeys = true;
      }
      return false; // let xterm apply the mode too
    });
    this.term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
      for (const p of params) {
        if (p === 1 || (Array.isArray(p) && p[0] === 1)) this.appCursorKeys = false;
      }
      return false;
    });
  }

  /** `false` stops xterm.js from processing the event. */
  private handleKey(ev: KeyboardEvent): boolean {
    if (ev.type !== "keydown") return true;

    // Copy selected terminal text. Must run before Ctrl+C is forwarded as ^C.
    if (ev.ctrlKey && !ev.altKey && (ev.key.toLowerCase() === "c" || ev.key === "Insert")) {
      const selected = this.term.getSelection();
      if (selected) {
        ev.preventDefault();
        void navigator.clipboard.writeText(selected);
        this.hooks.onCopyFromTerminal?.(selected);
        return false;
      }
      // No selection: interrupt — clear host busy chrome immediately.
      this.hooks.onUserCancel?.();
    }

    if (ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
      this.hooks.onUserCancel?.();
    }
    if (
      (ev.key === "Enter" || ev.code === "Enter" || ev.code === "NumpadEnter") &&
      ev.altKey &&
      !ev.ctrlKey &&
      !ev.metaKey
    ) {
      ev.preventDefault();
      this.hooks.write("\r");
      return false;
    }

    // One byte reproduces omp's native paste: clipboard image -> attachment,
    // else text, else a detected image path -> attachment.
    if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "v") {
      ev.preventDefault();
      this.hooks.write("\x16");
      return false;
    }

    const seq = encodeKey(ev, this.keyMode);
    if (seq) {
      ev.preventDefault();
      this.hooks.write(seq);
      return false;
    }
    return true;
  }

  /** Scrollback search overlay; app chords are owned by the window handler. */
  toggleSearch(): void {
    if (this.searchBar) {
      this.searchBar.remove();
      this.searchBar = null;
      this.search.clearDecorations();
      this.term.focus();
      return;
    }

    const bar = document.createElement("div");
    bar.className = "term-search";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Find in scrollback";
    input.spellcheck = false;
    bar.appendChild(input);
    this.el.appendChild(bar);
    this.searchBar = bar;
    input.focus();

    const options = {
      decorations: {
        matchOverviewRuler: "#7aa2f7",
        activeMatchColorOverviewRuler: "#e0af68",
      },
    };
    input.addEventListener("input", () => {
      if (input.value) this.search.findNext(input.value, options);
      else this.search.clearDecorations();
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.toggleSearch();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (!input.value) return;
        if (ev.shiftKey) this.search.findPrevious(input.value, options);
        else this.search.findNext(input.value, options);
      }
    });
  }
}
