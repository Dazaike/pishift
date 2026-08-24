import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

import { bracketPaste } from "../shared/ipc";
import { encodeKey, type KeyMode } from "../shared/kitty-keys";
import { buildXtermTheme, FONT_FAMILY, FONT_SIZE, type ThemePreset } from "./theme";
export interface TermViewHooks {
  /** Bytes to the PTY. */
  write(data: string): void;
  resize(cols: number, rows: number): void;
  setTitle(title: string): void;
  setBusy(busy: boolean): void;
  notify(body: string): void;
  /** User hit Esc / bare Ctrl+C — host should drop working chrome optimistically. */
  onUserCancel?(): void;
}

const RESIZE_DEBOUNCE_MS = 50;

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
  private resizeTimer: number | undefined;
  private opened = false;
  private disposed = false;

  /** Depth of omp's `CSI > <flags> u` kitty-keyboard pushes. */
  private kittyDepth = 0;

  /** Enhanced-key protocol omp negotiated for this session. */
  private keyMode: KeyMode = "legacy";
  private currentFontSize = FONT_SIZE;
  private searchBar: HTMLDivElement | null = null;

  constructor(
    private readonly hooks: TermViewHooks,
    themePreset?: ThemePreset,
  ) {
    this.el = document.createElement("div");
    this.el.className = "view";

    this.term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      fontWeight: "normal",
      fontWeightBold: "bold",
      scrollback: 20_000,
      macOptionIsMeta: false,
      theme: themePreset ? buildXtermTheme(themePreset) : undefined,
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = "11";
    this.term.loadAddon(new WebLinksAddon());
    this.term.loadAddon(this.search);

    this.term.onData((data) => this.hooks.write(data));
    this.term.onBinary((data) => this.hooks.write(data));
    this.registerSequenceHandlers();
    this.term.attachCustomKeyEventHandler((ev) => this.handleKey(ev));

    // xterm.js would otherwise deliver a second, competing paste; Ctrl+V is
    // forwarded to omp as 0x16 so omp reads the OS clipboard itself.
    this.el.addEventListener("paste", (ev) => ev.preventDefault());

    this.el.addEventListener(
      "wheel",
      (ev) => {
        if (ev.ctrlKey) {
          ev.preventDefault();
          if (ev.deltaY < 0) this.zoomIn();
          else this.zoomOut();
        }
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
    }
    this.applyFit();
    this.term.focus();
  }

  deactivate(): void {
    this.el.classList.remove("active");
  }

  /** PTY data in, with the flow-control ack fired once the parser has consumed it. */
  feed(data: string, ack: () => void): void {
    if (this.disposed) return;
    this.term.write(data, ack);
  }

  /** Send user text as a bracketed paste (never submits on its own). */
  paste(text: string): void {
    if (text) this.hooks.write(bracketPaste(text));
  }

  /**
   * Send text as if typed, so omp's line editor sees a command line rather than
   * pasted content. CR/LF are stripped: submitting is the caller's decision.
   */
  type(text: string): void {
    const safe = text.replace(/[\r\n]+/g, " ").replace(/\x1b/g, "");
    if (safe) this.hooks.write(safe);
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
      const code = key.toUpperCase().charCodeAt(0) - 64;
      if (code >= 1 && code <= 26) {
        this.hooks.write(String.fromCharCode(code));
        return;
      }
    }
    // Last resort: type the key and hope.
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

  submit(): void {
    this.hooks.write("\r");
  }
  focus(): void {
    this.term.focus();
  }

  setTheme(preset: ThemePreset): void {
    this.term.options.theme = buildXtermTheme(preset);
  }

  zoomIn(): void {
    if (this.currentFontSize >= 32) return;
    this.setFontSize(this.currentFontSize + 1);
  }

  zoomOut(): void {
    if (this.currentFontSize <= 8) return;
    this.setFontSize(this.currentFontSize - 1);
  }
  resetZoom(): void {
    this.setFontSize(FONT_SIZE);
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
    this.currentFontSize = size;
    this.term.options.fontSize = size;
    this.applyFit();
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
    clearTimeout(this.resizeTimer);
    this.observer?.disconnect();
    this.observer = null;
    this.webgl?.dispose();
    this.webgl = null;
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
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.applyFit(), RESIZE_DEBOUNCE_MS);
  }

  private applyFit(): void {
    if (this.disposed || !this.opened || !this.el.classList.contains("active")) return;
    if (this.el.clientWidth < 8 || this.el.clientHeight < 8) return;
    this.fit.fit();
    this.hooks.resize(this.term.cols, this.term.rows);
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
  }

  /** `false` stops xterm.js from processing the event. */
  private handleKey(ev: KeyboardEvent): boolean {
    if (ev.type !== "keydown") return true;

    // Copy selected terminal text. Must run before Ctrl+C is forwarded as ^C.
    if (ev.ctrlKey && !ev.altKey && ev.key.toLowerCase() === "c") {
      const selected = this.term.getSelection();
      if (selected) {
        ev.preventDefault();
        void navigator.clipboard.writeText(selected);
        return false;
      }
      // No selection: interrupt — clear host busy chrome immediately.
      this.hooks.onUserCancel?.();
    }

    if (ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
      this.hooks.onUserCancel?.();
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
