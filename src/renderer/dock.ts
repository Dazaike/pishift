import { IMAGE_EXT, type ControlBridgeActivity, type ImagePreview, type ViewMode } from "../shared/ipc";
import type { KeyLike } from "../shared/kitty-keys";
import { DockGlow } from "./dock-glow";
import { filePaths } from "./dnd";
import { highlightMessage } from "./highlight";
import { ImageLightbox } from "./image-lightbox";
import { getProviderIcon } from "./provider-icons";
import { SlashMenu } from "./slash-menu";
import { ThinkingMenu } from "./thinking-menu";
import { getThinkingIconSvg } from "./thinking-icons";
import planIcon from "./assets/icons/plan.png";
import type { PlanMode, PlanTarget } from "../shared/plan-mode";
import { PasteMenu } from "./paste-menu";
import {
  countPasteLines,
  isLargePaste,
  normalizePaste,
  pasteMarker,
  triggersPasteMenu,
  type PasteMode,
  type PasteModeSetting,
  type PasteMarkerStyle,
} from "../shared/paste-attach";
export type DockPayload = {
  text: string;
  imagePaths: string[];
  otherPaths: string[];
  pastes: PastePayload[];
};
export type Attachment = { path: string; isImage: boolean };

/**
 * A chunk of terminal output the user highlighted and referenced. Snippets are
 * not files: they are inlined into the outgoing message as a fenced block, so
 * omp sees the exact text without a temp file round-trip.
 */
export type Snippet = { id: string; text: string; label: string };

/** First lines of a referenced selection; CSS clamps the visible height. */
function snippetPreview(text: string): string {
  const preview = text
    .split("\n", 3)
    .map((line) => line.trimEnd())
    .join("\n");
  return preview.length > 400 ? `${preview.slice(0, 400)}…` : preview;
}

/**
 * A long paste collapsed out of the composer. The text lives here; the textarea
 * only holds a short marker, which is replayed to omp as its own bracketed
 * paste on submit so omp performs the real attachment.
 */
export type PasteItem = {
  id: string;
  seq: number;
  text: string;
  lines: number;
  mode: PasteMode;
  /** Literal composer text for this paste, in the style chosen when it landed. */
  marker: string;
};

export type PastePayload = Omit<PasteItem, "id" | "marker">;

/** Universal thinking ladder exposed for every model. */
export const DEFAULT_THINKING_LEVELS = [
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const THINKING_LEVELS = DEFAULT_THINKING_LEVELS;


export function formatThinkingLevel(raw: string): string {
  const map: Record<string, string> = {
    off: "Off",
    min: "Min",
    minimal: "Min",
    low: "Low",
    med: "Medium",
    medium: "Medium",
    high: "High",
    xhigh: "XHigh",
    xhi: "XHigh",
    max: "Max",
    auto: "Auto",
    none: "Off",
    disabled: "Off",
    extrahigh: "XHigh",
    maximum: "Max",
  };
  const key = (raw ?? "").toLowerCase().trim();
  return map[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Low");
}

/** Canonical effort token used in UI state and `/m` commands. */
export function normalizeThinkingToken(raw: string): string {
  const key = (raw ?? "").toLowerCase().trim();
  if (key === "auto") return "auto";
  if (key === "off" || key === "none" || key === "disabled") return "off";
  if (key === "min" || key === "minimal") return "minimal";
  if (key === "med" || key === "medium") return "medium";
  if (key === "xhigh" || key === "xhi" || key === "extrahigh") return "xhigh";
  if (key === "max" || key === "maximum") return "max";
  return key || "low";
}

/** Compact token preferred by control-bridge `/m`. */
export function toThinkingCommandToken(raw: string): string {
  const key = normalizeThinkingToken(raw);
  if (key === "minimal") return "min";
  if (key === "medium") return "med";
  return key;
}

export function buildThinkingLevelsForModel(opts?: {
  reasoning?: boolean;
  thinkingEfforts?: string[];
  thinkingRequiresEffort?: boolean;
} | null | undefined): string[] {
  if (!opts) return [...DEFAULT_THINKING_LEVELS];

  if (Array.isArray(opts.thinkingEfforts) && opts.thinkingEfforts.length > 0) {
    const supportedTokens = new Set<string>();
    for (const raw of opts.thinkingEfforts) {
      supportedTokens.add(normalizeThinkingToken(raw));
    }

    const out: string[] = ["auto", "off"];

    const ladder = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
    for (const step of ladder) {
      if (supportedTokens.has(step)) {
        out.push(step);
      }
    }

    return out.length > 0 ? out : ["off"];
  }

  if (opts.reasoning === false) {
    return ["off"];
  }

  return [...DEFAULT_THINKING_LEVELS];
}

export function clampThinkingToLevels(level: string, levels: readonly string[]): string {
  if (levels.length === 0) return "off";
  const token = normalizeThinkingToken(level);

  // Exact canonical match first — never collapse xhigh → high when both exist.
  if (levels.includes(token)) return token;

  // Match a stored display label ("XHigh", "Min", …).
  const label = (level ?? "").trim().toLowerCase();
  for (const lvl of levels) {
    if (formatThinkingLevel(lvl).toLowerCase() === label) return lvl;
  }

  // Only when the preferred token is absent from this model's ladder.
  const fallbacks: Record<string, string[]> = {
    max: ["xhigh", "high", "medium", "low"],
    maximum: ["max", "xhigh", "high", "medium", "low"],
    xhigh: ["high", "medium", "low", "max"],
    xhi: ["xhigh", "high", "medium", "low", "max"],
    minimal: ["low", "medium"],
    min: ["minimal", "low", "medium"],
    medium: ["low", "high"],
    med: ["medium", "low", "high"],
  };
  for (const alt of fallbacks[token] ?? []) {
    if (levels.includes(alt)) return alt;
  }

  // Nearest by global rank.
  const rank = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const want = rank.indexOf(token);
  if (want < 0) return levels[Math.min(1, levels.length - 1)] ?? levels[0]!;
  let best = levels[0]!;
  let bestDist = Infinity;
  for (const lvl of levels) {
    const d = Math.abs(rank.indexOf(lvl) - want);
    if (d < bestDist) {
      bestDist = d;
      best = lvl;
    }
  }
  return best;
}
/** Per-tab dock contents, swapped when the active tab changes. */
export type DockState = {
  text: string;
  chips: Attachment[];
  snippets: Snippet[];
  pastes: PasteItem[];
  pasteSeq: number;
  history: string[];
  // Plan state deliberately absent: it lives on the tab's PlanReconciler so
  // there is exactly one source of truth.
  modelName: string;
  thinkingLevel: string;
};

export interface DockHooks {
  /** Live Settings value, read at paste time. */
  pasteMode(): PasteModeSetting;
  /** Live Settings value, read when a paste lands. */
  pasteMarkerStyle(): PasteMarkerStyle;
  /** Live Settings value, read when a paste lands. */
  pasteMarkerPulse(): boolean;
  submit(payload: DockPayload): void;
  interrupt(): void;
  focusTerminal(): void;
  forwardChord(ev: KeyboardEvent): boolean;
  type(data: string): void;
  writeTerminalRaw(data: string): void;
  /** True when the active PTY wants arrow keys (application cursor mode). */
  wantsTerminalArrows(): boolean;
  /** Send an arrow chord to the active PTY using the correct cursor-key mode. */
  writeTerminalArrow(ev: KeyLike): boolean;
  setPlanTarget(target: PlanTarget): void;
  openModel(): void;
  openUsage(): void;
  openTools?(): void;
  selectThinking(level: string): void;
  openCwd(): void;
  changeCwd(): void;
  toggleViewMode(): void;
}

const EDITOR_CHORDS: Record<string, true> = {
  a: true,
  c: true,
  v: true,
  x: true,
  z: true,
  y: true,
  insert: true,
  delete: true,
  home: true,
  end: true,
  arrowleft: true,
  arrowright: true,
  arrowup: true,
  arrowdown: true,
};

const MAX_HISTORY = 200;
const THUMB_SIZE = 180;
const FULL_PREVIEW_SIZE = 1200;

export class Dock {
  private readonly root = document.getElementById("dock") as HTMLElement;
  private readonly tray = document.getElementById("dock-chips") as HTMLDivElement;
  private readonly input = document.getElementById("dock-input") as HTMLTextAreaElement;
  private readonly mirror = document.getElementById("dock-highlight") as HTMLPreElement;
  private readonly cwdLabel = document.getElementById("dock-cwd") as HTMLButtonElement;
  private readonly changeDirBtn = document.getElementById("dock-change-dir") as HTMLButtonElement;
  private readonly usageBtn = document.getElementById("dock-usage-btn") as HTMLButtonElement;
  private readonly toolsBtn = document.getElementById("dock-tools-btn") as HTMLButtonElement | null;
  private readonly expandBtn = document.getElementById("dock-expand-btn") as HTMLButtonElement | null;
  private readonly modelBtn = document.getElementById("dock-model") as HTMLButtonElement;
  private readonly planBtn = document.getElementById("dock-plan") as HTMLButtonElement;
  private readonly viewModeBtn = document.getElementById("dock-view-mode") as HTMLButtonElement;
  private readonly thinkingBtn = document.getElementById("dock-thinking-btn") as HTMLButtonElement;
  private readonly stopButton = document.getElementById("dock-stop") as HTMLButtonElement;
  private readonly sendButton = document.getElementById("dock-send") as HTMLButtonElement;
  private readonly sendLabel = this.sendButton.querySelector(".dock-send-label") as HTMLSpanElement | null;
  private readonly slashMenu: SlashMenu;
  private readonly pasteMenu = new PasteMenu();
  private readonly thinkingMenu: ThinkingMenu;
  private readonly lightbox: ImageLightbox;
  private readonly glow: DockGlow;
  private isBusy = false;
  private isExpanded = false;
  private chips: Attachment[] = [];
  private snippets: Snippet[] = [];
  private snippetSeq = 0;
  private pastes: PasteItem[] = [];
  private pasteSeq = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private draft = "";
  private planMode: PlanMode = "off";
  private planPending = false;
  private modelName = "";
  private thinkingLevel = "low";
  private thinkingLevels: string[] = [...DEFAULT_THINKING_LEVELS];
  private readonly previews = new Map<string, ImagePreview>();
  private skillCwd = "";
  private toastEl: HTMLDivElement | null = null;
  private toastTimer: number | null = null;
  private toastLeavingTimer: number | null = null;
  constructor(private readonly hooks: DockHooks) {
    this.slashMenu = new SlashMenu((cmd) => {
      const text = this.input.value;
      const match = /^\/([a-zA-Z0-9_:.-]*)$/.exec(text);
      if (match) {
        this.input.value = `/${cmd.name}${cmd.args ? " " : ""}`;
      } else {
        this.input.value = `/${cmd.name} `;
      }
      this.render();
      this.input.focus();
    });

    const editorEl = document.getElementById("dock-editor") as HTMLElement;
    this.glow = new DockGlow(editorEl);
    this.lightbox = new ImageLightbox();
    this.root.appendChild(this.slashMenu.el);
    this.root.appendChild(this.pasteMenu.el);

    const toast = document.createElement("div");
    toast.id = "dock-toast";
    toast.hidden = true;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `<span class="dock-toast-icon">&#x2713;</span><span class="dock-toast-text">Just copied</span>`;
    this.root.appendChild(toast);
    this.toastEl = toast;
    this.stopButton.addEventListener("click", () => {
      this.hooks.interrupt();
    });
    this.sendButton.addEventListener("click", () => {
      this.submit();
    });
    this.changeDirBtn.addEventListener("click", () => this.hooks.changeCwd());
    this.cwdLabel.addEventListener("click", () => this.hooks.openCwd());
    this.usageBtn.addEventListener("click", () => this.hooks.openUsage());
    this.modelBtn.addEventListener("click", () => this.hooks.openModel());
    this.toolsBtn?.addEventListener("click", () => this.hooks.openTools?.());
    this.expandBtn?.addEventListener("click", () => this.toggleExpand());
    this.planBtn.addEventListener("click", () => {
      const target: PlanTarget = this.planMode === "off" ? "on" : "off";
      this.hooks.setPlanTarget(target);
    });
    this.viewModeBtn.addEventListener("click", () => this.hooks.toggleViewMode());

    this.thinkingMenu = new ThinkingMenu(this.thinkingBtn, (level) => {
      this.hooks.selectThinking(level);
    });
    this.thinkingBtn.addEventListener("click", () => {
      this.thinkingMenu.toggle(this.thinkingLevels, normalizeThinkingToken(this.thinkingLevel));
    });

    this.input.addEventListener("input", () => {
      this.render();
      this.checkSlashMenu();
    });

    this.input.addEventListener("scroll", () => {
      this.mirror.scrollTop = this.input.scrollTop;
      this.mirror.scrollLeft = this.input.scrollLeft;
    });

    this.input.addEventListener("keydown", (ev) => this.onKeyDown(ev), true);
    this.input.addEventListener("paste", (ev) => void this.onPaste(ev));
    this.input.addEventListener("focus", () => this.root.classList.add("focused"));
    this.input.addEventListener("blur", () => {
      this.root.classList.remove("focused");
      setTimeout(() => {
        if (document.activeElement !== this.input) {
          this.slashMenu.close();
          this.pasteMenu.cancel();
        }
      }, 150);
    });

    this.render();
  }

  get isFocused(): boolean {
    return document.activeElement === this.input;
  }

  focus(): void {
    this.input.focus();
  }

  setCwd(cwd: string): void {
    this.cwdLabel.textContent = cwd;
    this.cwdLabel.title = cwd;
    void this.refreshSkillCommands(cwd);
  }

  /** Skills are per-project (`<cwd>/.omp/skills`, `.claude/skills`, …), so the
   *  palette's dynamic half is reloaded whenever the active tab's cwd changes. */
  private async refreshSkillCommands(cwd: string): Promise<void> {
    this.skillCwd = cwd;
    try {
      const commands = await window.pishift.getSkillCommands(cwd);
      if (this.skillCwd !== cwd) return; // superseded by a newer tab switch
      this.slashMenu.setExtraCommands(commands);
    } catch {
      // Discovery failed — palette keeps the built-in list only.
    }
  }

  /** Orbiting glow around the composer while the active session is busy. */
  setAgentBusy(busy: boolean, kind: ControlBridgeActivity = "idle"): void {
    this.isBusy = busy;
    this.root.classList.toggle("agent-busy", busy);
    this.updateSendButton();
    if (busy && kind !== "idle") {
      this.root.style.setProperty("--dock-active-color", `var(--glow-${kind})`);
      // Always (re)start so kind switches mid-turn recolor the comet immediately.
      this.glow.start(kind);
    } else {
      this.root.style.removeProperty("--dock-active-color");
      this.glow.stop();
    }
  }

  private updateSendButton(): void {
    if (this.isBusy) {
      this.stopButton.hidden = false;
      this.sendButton.classList.add("icon-only");
      this.sendButton.title = "Queue message (Enter)";
      if (this.sendLabel) this.sendLabel.style.display = "none";
    } else {
      this.stopButton.hidden = true;
      this.sendButton.classList.remove("icon-only");
      this.sendButton.title = "Send message (Enter)";
      if (this.sendLabel) this.sendLabel.style.display = "";
    }
  }

  setModel(name: string, iconUrl?: string, provider?: string): void {
    this.modelName = name;
    if (name) {
      let iconHtml = "&#9889;";
      if (iconUrl) {
        iconHtml = `<img src="${iconUrl}" alt="" class="dock-model-img" onerror="this.parentElement.innerHTML='&#9889;'" />`;
      } else if (provider) {
        iconHtml = getProviderIcon(provider);
      }
      this.modelBtn.innerHTML = `<span class="dock-model-icon">${iconHtml}</span><span class="dock-model-name">${name}</span>`;
      this.modelBtn.title = `Current Model: ${name} (Click to switch)`;
    } else {
      this.modelBtn.innerHTML = `<span class="dock-model-icon">&#9889;</span><span class="dock-model-name">Model</span>`;
      this.modelBtn.title = `Switch Model`;
    }
  }

  setModelName(name: string): void {
    this.setModel(name);
  }

  setPlanMode(mode: PlanMode, pending = this.planPending): void {
    this.planMode = mode;
    this.planPending = pending;
    this.updatePlanButton();
  }

  /** Paint the toggle with the *current* mode; its title names the action it performs. */
  setViewMode(mode: ViewMode): void {
    const chat = mode === "chat";
    this.viewModeBtn.classList.toggle("view-chat", chat);
    this.viewModeBtn.title = chat
      ? "Back to Terminal (Ctrl+Shift+U)"
      : "Switch to Chat View (Ctrl+Shift+U)";
    const label = this.viewModeBtn.querySelector(".dock-view-label");
    if (label) label.textContent = chat ? "Chat" : "Terminal";
  }

  /** Open an already-decoded image (chat attachment) in the shared lightbox. */
  showImage(src: string): void {
    this.lightbox.open(src, "Attachment");
  }

  /** Update supported thinking ladder for the active model (used by cycle). */
  setThinkingLevels(levels: readonly string[], current?: string): void {
    const next = levels.length > 0 ? [...levels] : ["off"];
    this.thinkingLevels = next;
    this.thinkingBtn.disabled = next.length <= 1;
    this.thinkingBtn.title =
      next.length <= 1
        ? "This model has no adjustable thinking levels"
        : `Click to cycle · ${next.map(formatThinkingLevel).join(" → ")}`;
    this.setThinkingLevel(current ?? this.thinkingLevel);
  }

  getThinkingLevels(): readonly string[] {
    return this.thinkingLevels;
  }

  setThinkingLevel(level: string): void {
    if (!level && level !== "off") return;
    const token = clampThinkingToLevels(level, this.thinkingLevels);
    this.thinkingLevel = formatThinkingLevel(token);
    const iconSvg = getThinkingIconSvg(token);
    this.thinkingBtn.innerHTML = `${iconSvg}<span class="dock-thinking-label">Thinking: ${this.thinkingLevel}</span>`;
  }


  /**
   * Show a temporary floating status toast in the dock area (e.g. "Just copied").
   */
  showToast(message = "Just copied", durationMs = 1300): void {
    if (!this.toastEl) return;
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.toastLeavingTimer) {
      clearTimeout(this.toastLeavingTimer);
      this.toastLeavingTimer = null;
    }
    const textEl = this.toastEl.querySelector(".dock-toast-text");
    if (textEl) textEl.textContent = message;
    this.toastEl.classList.remove("leaving");
    this.toastEl.hidden = false;

    this.toastEl.style.animation = "none";
    void this.toastEl.offsetHeight;
    this.toastEl.style.animation = "";

    this.toastTimer = window.setTimeout(() => {
      if (!this.toastEl || this.toastEl.hidden) return;
      this.toastEl.classList.add("leaving");
      this.toastLeavingTimer = window.setTimeout(() => {
        if (!this.toastEl) return;
        this.toastEl.hidden = true;
        this.toastEl.classList.remove("leaving");
        this.toastLeavingTimer = null;
      }, 160);
      this.toastTimer = null;
    }, durationMs);
  }
  toggleExpanded(): void {
    this.root.classList.toggle("expanded");
    this.autoGrow();
    this.focus();
  }

  addPaths(paths: readonly string[]): void {
    for (const path of paths) {
      if (this.chips.some((chip) => chip.path === path)) continue;
      this.chips.push({ path, isImage: IMAGE_EXT.test(path) });
    }
    this.renderChips();
    this.focus();
  }

  /**
   * Reference highlighted terminal output. Identical text is not duplicated —
   * re-referencing the same selection just flashes the existing chip.
   */
  addSnippet(rawText: string): void {
    const text = rawText.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
    if (!text) return;
    const existing = this.snippets.find((snip) => snip.text === text);
    if (existing) {
      this.renderChips();
      this.flashSnippet(existing.id);
      this.focus();
      return;
    }
    const lines = text.split("\n").length;
    const head = text.split("\n", 1)[0] ?? "";
    const label = lines > 1 ? `${lines} lines` : head.length > 28 ? `${head.slice(0, 28)}…` : head;
    const id = `snip-${++this.snippetSeq}`;
    this.snippets.push({ id, text, label });
    this.renderChips();
    this.flashSnippet(id);
    this.focus();
  }

  /** Pulse a chip so a repeat reference is visibly acknowledged. */
  private flashSnippet(id: string): void {
    const el = this.tray.querySelector(`[data-snippet-id="${id}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }

  /** Fenced transcript block appended after the user's prose. */
  private snippetBlock(): string {
    if (this.snippets.length === 0) return "";
    return this.snippets
      .map((snip) => `\n\nReferenced terminal output (${snip.label}):\n\`\`\`\n${snip.text}\n\`\`\``)
      .join("");
  }

  /** Text-only drop (URL, selected text) — insert at the composer caret. */
  insertDroppedText(text: string): void {
    this.focus();
    this.insertText(text);
  }

  snapshot(): DockState {
    return {
      text: this.input.value,
      chips: [...this.chips],
      snippets: [...this.snippets],
      pastes: [...this.pastes],
      pasteSeq: this.pasteSeq,
      history: [...this.history],
      modelName: this.modelName,
      thinkingLevel: this.thinkingLevel,
    };
  }

  load(state: DockState | undefined): void {
    this.input.value = state?.text ?? "";
    this.chips = state ? [...state.chips] : [];
    this.snippets = state?.snippets ? [...state.snippets] : [];
    this.pastes = Array.isArray(state?.pastes) ? [...state.pastes] : [];
    this.pasteSeq = typeof state?.pasteSeq === "number" ? state.pasteSeq : 0;
    this.history = state ? [...state.history] : [];
    this.modelName = state?.modelName ?? "";
    this.thinkingLevel = state?.thinkingLevel ?? "low";
    this.historyIndex = -1;
    this.draft = "";
    this.slashMenu.close();
    this.pasteMenu.close();
    this.updatePlanButton();
    this.setModelName(this.modelName);
    this.setThinkingLevel(this.thinkingLevel);
    this.renderChips();
    this.render();
  }

  private updatePlanButton(): void {
    this.planBtn.classList.remove("plan-off", "plan-on", "plan-paused");
    this.planBtn.classList.toggle("plan-pending", this.planPending);
    const icon = `<img src="${planIcon}" alt="" class="btn-icon" />`;
    const label = this.planMode === "on" ? "Plan: ON" : "Plan: OFF";
    this.planBtn.innerHTML = `${icon}<span class="dock-plan-label">${label}</span>`;
    this.planBtn.classList.add(`plan-${this.planMode}`);
    this.planBtn.title =
      this.planMode === "on"
        ? "Plan mode ON — click to exit"
        : "Plan mode OFF — click to enter";
  }

  private checkSlashMenu(): void {
    const text = this.input.value;
    if (text.startsWith("/") && !text.includes("\n") && !text.includes(" ")) {
      this.slashMenu.open(text.slice(1));
    } else {
      this.slashMenu.close();
    }
  }

  private submit(): void {
    const text = this.input.value;
    const block = this.snippetBlock();
    const payload: DockPayload = {
      text: text + block,
      imagePaths: this.chips.filter((chip) => chip.isImage).map((chip) => chip.path),
      otherPaths: this.chips.filter((chip) => !chip.isImage).map((chip) => chip.path),
      pastes: this.pastes.map(({ seq, text: body, lines, mode }) => ({
        seq,
        text: body,
        lines,
        mode,
      })),
    };
    const hasBody = Boolean(text.trim()) || block.length > 0 || this.pastes.length > 0;
    if (!hasBody && payload.imagePaths.length + payload.otherPaths.length === 0) return;

    this.slashMenu.close();
    this.pasteMenu.close();
    this.playComposerSink();
    this.hooks.submit(payload);

    if (text.trim() && this.history[this.history.length - 1] !== text) {
      this.history.push(text);
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    this.historyIndex = -1;
    this.draft = "";
    this.input.value = "";
    this.chips = [];
    this.snippets = [];
    this.pastes = [];
    this.renderChips();
    this.render();
  }

  /** Brief press-in on Enter/Send, then spring back to focused or idle scale. */
  private playComposerSink(): void {
    const editor = document.getElementById("dock-editor");
    if (!editor) return;
    editor.classList.remove("sinking");
    // Force reflow so re-adding the class restarts the transition.
    void editor.offsetWidth;
    editor.classList.add("sinking");
    window.setTimeout(() => {
      editor.classList.remove("sinking");
    }, 170);
  }

  private onKeyDown(ev: KeyboardEvent): void {
    const arrowKey = this.arrowKeyOf(ev);
    const isArrow = arrowKey !== null;

    // Modal over everything else, including the slash menu and PTY arrow
    // forwarding: the popover owes an answer before the paste can land.
    if (this.pasteMenu.isOpen) {
      const handled = this.handlePasteMenuKey(ev);
      if (handled) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    }

    // Composer-focused: Alt(+Shift)+arrows are a host shortcut that injects
    // normal (or app-cursor) arrow sequences into the PTY. Alt is NOT part of
    // the terminal chord — omp menus expect plain arrows.
    if (isArrow && ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      const ok = this.hooks.writeTerminalArrow({
        key: arrowKey!,
        code: ev.code,
        altKey: false,
        shiftKey: ev.shiftKey,
        ctrlKey: false,
        metaKey: false,
      });
      if (ok) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    }

    // Composer-focused: Alt+Enter (or Alt+NumpadEnter) injects Enter (\r) into
    // the PTY so user can confirm options in omp interactive menus without
    // submitting the composer or leaving the dock.
    if (
      (ev.key === "Enter" || ev.code === "Enter" || ev.code === "NumpadEnter") &&
      ev.altKey &&
      !ev.ctrlKey &&
      !ev.metaKey
    ) {
      ev.preventDefault();
      ev.stopPropagation();
      this.hooks.writeTerminalRaw("\r");
      return;
    }

    // When omp enables application cursor keys (menus/pickers), plain arrows
    // go to the terminal if the slash menu is closed and the composer is empty
    // (so we don't steal caret motion while typing).
    if (
      isArrow &&
      !ev.altKey &&
      !ev.ctrlKey &&
      !ev.metaKey &&
      !ev.shiftKey &&
      !this.slashMenu.isOpen &&
      this.input.value.length === 0 &&
      this.hooks.wantsTerminalArrows()
    ) {
      const ok = this.hooks.writeTerminalArrow({
        key: arrowKey!,
        code: ev.code,
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      if (ok) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    }

    if (this.slashMenu.isOpen) {
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        this.slashMenu.moveSelection(-1);
        return;
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        this.slashMenu.moveSelection(1);
        return;
      }
      if (ev.key === "Enter" || ev.key === "Tab") {
        ev.preventDefault();
        const cmd = this.slashMenu.selectCurrent();
        if (!cmd) return;
        if (ev.key === "Enter") {
          // One keystroke: complete the command and send it.
          this.input.value = `/${cmd.name}`;
          this.render();
          this.submit();
        } else {
          // Tab only completes (keeps a trailing space when the command takes args).
          this.input.value = `/${cmd.name}${cmd.args ? " " : ""}`;
          this.render();
        }
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.slashMenu.close();
        return;
      }
    }

    if (ev.key === "Enter" && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      this.submit();
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      this.slashMenu.close();
      this.hooks.focusTerminal();
      return;
    }
    if (ev.key === "c" && ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
      if (this.input.selectionStart === this.input.selectionEnd) {
        ev.preventDefault();
        this.hooks.interrupt();
      }
      return;
    }

    const chordish = (ev.ctrlKey && ev.shiftKey) || (ev.ctrlKey && ev.altKey);
    if (chordish && !EDITOR_CHORDS[ev.key.toLowerCase()] && this.hooks.forwardChord(ev)) {
      ev.preventDefault();
      return;
    }

    if (ev.key === "Tab" && !ev.ctrlKey && !ev.altKey) {
      ev.preventDefault();
      this.insertText("  ");
      return;
    }
    if (ev.key === "ArrowUp" && !ev.shiftKey && !ev.altKey) {
      if (this.input.selectionStart === 0 && this.input.selectionEnd === 0) {
        ev.preventDefault();
        this.recall(-1);
      }
      return;
    }
    if (ev.key === "ArrowDown" && !ev.shiftKey && !ev.altKey) {
      if (
        this.historyIndex >= 0 &&
        this.input.selectionStart === this.input.value.length &&
        this.input.selectionEnd === this.input.value.length
      ) {
        ev.preventDefault();
        this.recall(1);
      }
    }
  }

  /** Resolve ArrowUp/Down/Left/Right from key or physical code (Windows Alt quirks). */
  private arrowKeyOf(ev: KeyboardEvent): "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | null {
    const fromKey = ev.key;
    if (
      fromKey === "ArrowUp" ||
      fromKey === "ArrowDown" ||
      fromKey === "ArrowLeft" ||
      fromKey === "ArrowRight"
    ) {
      return fromKey;
    }
    // Some hosts report only `code` when Alt is held.
    switch (ev.code) {
      case "ArrowUp":
      case "Up":
        return "ArrowUp";
      case "ArrowDown":
      case "Down":
        return "ArrowDown";
      case "ArrowLeft":
      case "Left":
        return "ArrowLeft";
      case "ArrowRight":
      case "Right":
        return "ArrowRight";
      default:
        return null;
    }
  }

  private recall(direction: -1 | 1): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      if (direction === 1) return;
      this.draft = this.input.value;
      this.historyIndex = this.history.length - 1;
    } else {
      const next = this.historyIndex + direction;
      if (next < 0) return;
      if (next >= this.history.length) {
        this.historyIndex = -1;
        this.input.value = this.draft;
        this.render();
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
        return;
      }
      this.historyIndex = next;
    }
    this.input.value = this.history[this.historyIndex] ?? "";
    this.render();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  private async onPaste(ev: ClipboardEvent): Promise<void> {
    const files = Array.from(ev.clipboardData?.files ?? []);
    const paths = filePaths(files);
    if (paths.length) {
      ev.preventDefault();
      this.addPaths(paths);
      return;
    }

    // A long text paste is collapsed to a chip + marker instead of flooding the
    // composer, exactly as omp does with its own large pastes.
    const pasted = ev.clipboardData?.getData("text/plain") ?? "";
    if (pasted && isLargePaste(pasted)) {
      ev.preventDefault();
      const lines = countPasteLines(pasted);
      const mode = this.hooks.pasteMode();
      if (mode === "ask" && triggersPasteMenu(lines)) {
        this.pasteMenu.open(lines, (chosen) => this.commitPaste(pasted, lines, chosen));
      } else {
        this.commitPaste(pasted, lines, mode === "ask" ? "inline" : mode);
      }
      return;
    }
    if (!files.some((file) => file.type.startsWith("image/"))) return;

    ev.preventDefault();
    const saved = await window.pishift.saveClipboardImage();
    if (saved) {
      this.addPaths([saved]);
      return;
    }
    const text = await window.pishift.readClipboardText();
    if (text) this.insertText(text);
  }

  private insertText(text: string): void {
    const { selectionStart: start, selectionEnd: end, value } = this.input;
    this.input.value = value.slice(0, start) + text + value.slice(end);
    const caret = start + text.length;
    this.input.setSelectionRange(caret, caret);
    this.render();
  }

  private handlePasteMenuKey(ev: KeyboardEvent): boolean {
    if (ev.key === "ArrowUp") {
      this.pasteMenu.moveSelection(-1);
      return true;
    }
    if (ev.key === "ArrowDown") {
      this.pasteMenu.moveSelection(1);
      return true;
    }
    if (ev.key === "Enter" || ev.key === "Tab") {
      this.pasteMenu.selectCurrent();
      return true;
    }
    if (ev.key === "Escape") {
      this.pasteMenu.cancel();
      return true;
    }
    return false;
  }

  private commitPaste(text: string, lines: number, mode: PasteMode): void {
    const seq = ++this.pasteSeq;
    const marker = pasteMarker(seq, this.hooks.pasteMarkerStyle(), text);
    this.pastes.push({ id: `paste-${seq}`, seq, text, lines, mode, marker });
    this.renderChips();
    this.focus();
    this.insertText(`${marker} `);
    this.pulseMarker(seq);
  }

  /**
   * One-shot flash on the marker that just landed, so the eye connects it to
   * the chip appearing in the tray. Any later re-render clears it by itself.
   */
  private pulseMarker(seq: number): void {
    if (!this.hooks.pasteMarkerPulse()) return;
    const el = this.mirror.querySelector(`.hl-paste[data-seq="${seq}"]`);
    if (el instanceof HTMLElement) el.classList.add("pulse");
  }

  /**
   * The marker in the textarea is the source of truth: deleting it drops the
   * paste. Returns true when the tray needs a repaint.
   */
  private syncPastes(): boolean {
    if (this.pastes.length === 0) return false;
    const value = this.input.value;
    const kept = this.pastes.filter((item) => value.includes(item.marker));
    if (kept.length === this.pastes.length) return false;
    this.pastes = kept;
    return true;
  }

  private removePaste(item: PasteItem): void {
    this.pastes = this.pastes.filter((p) => p !== item);
    this.input.value = this.input.value.replace(`${item.marker} `, "").replace(item.marker, "");
    this.renderChips();
    this.render();
  }

  private render(): void {
    if (this.syncPastes()) this.renderChips();
    this.mirror.innerHTML = highlightMessage(this.input.value);
    this.autoGrow();
  }

  private autoGrow(): void {
    if (this.isExpanded) {
      this.input.style.height = "";
      return;
    }
    this.input.style.height = "auto";
    this.input.style.height = `${this.input.scrollHeight}px`;
  }

  public toggleExpand(): void {
    this.isExpanded = !this.isExpanded;
    this.root.classList.toggle("expanded-composer", this.isExpanded);
    if (this.expandBtn) {
      this.expandBtn.innerHTML = this.isExpanded ? "&#x2921;" : "&#x2922;";
      this.expandBtn.title = this.isExpanded
        ? "Collapse composer (Ctrl+Shift+E)"
        : "Expand composer (Ctrl+Shift+E)";
    }
    this.autoGrow();
    this.focus();
  }

  private renderChips(): void {
    this.tray.replaceChildren();
    for (const item of this.pastes) {
      const card = document.createElement("div");
      card.className = "chip-paste";
      card.title = item.text.length > 600 ? `${item.text.slice(0, 600)}…` : item.text;

      const preview = document.createElement("div");
      preview.className = "chip-paste-preview";
      preview.textContent = normalizePaste(item.text)
        .split("\n", 4)
        .map((line) => (line.length > 28 ? `${line.slice(0, 28)}…` : line))
        .join("\n");
      card.appendChild(preview);

      const meta = document.createElement("div");
      meta.className = "chip-paste-meta";

      const count = document.createElement("span");
      count.className = "chip-paste-count";
      count.textContent = `+${item.lines} lines`;
      meta.appendChild(count);

      const tag = document.createElement("span");
      tag.className = "chip-paste-tag";
      tag.textContent = `#${item.seq} · ${item.mode}`;
      meta.appendChild(tag);
      card.appendChild(meta);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "chip-paste-remove";
      removeBtn.textContent = "\u00d7";
      removeBtn.setAttribute("aria-label", `Remove paste #${item.seq}`);
      removeBtn.addEventListener("click", () => this.removePaste(item));
      card.appendChild(removeBtn);

      this.tray.appendChild(card);
    }
    for (const snip of this.snippets) {
      const el = document.createElement("span");
      el.className = "chip chip-snippet";
      el.dataset.snippetId = snip.id;
      el.title = snip.text.length > 600 ? `${snip.text.slice(0, 600)}…` : snip.text;

      const icon = document.createElement("span");
      icon.className = "chip-snippet-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "\u201C";
      el.appendChild(icon);

      const name = document.createElement("span");
      name.className = "chip-name";
      // The chip wraps, so show real content; `label` stays short for the
      // fenced block header in the outgoing message.
      name.textContent = snippetPreview(snip.text);
      el.appendChild(name);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "\u00d7";
      remove.setAttribute("aria-label", `Remove reference ${snip.label}`);
      remove.addEventListener("click", () => {
        this.snippets = this.snippets.filter((s) => s !== snip);
        this.renderChips();
      });
      el.appendChild(remove);
      this.tray.appendChild(el);
    }
    for (const chip of this.chips) {
      if (chip.isImage) {
        const card = document.createElement("div");
        card.className = "chip-image-card";
        card.title = chip.path;

        const thumb = document.createElement("img");
        thumb.className = "chip-image-thumb";
        thumb.alt = "";
        thumb.addEventListener("click", () => void this.showFullPreview(chip.path));
        card.appendChild(thumb);
        void this.attachPreview(chip, thumb);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "chip-image-remove";
        removeBtn.textContent = "\u00d7";
        removeBtn.setAttribute("aria-label", "Remove image");
        removeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.chips = this.chips.filter((c) => c !== chip);
          this.renderChips();
        });
        card.appendChild(removeBtn);

        this.tray.appendChild(card);
        continue;
      }

      // Non-image file chips
      const el = document.createElement("span");
      el.className = "chip";
      el.title = chip.path;

      const name = document.createElement("span");
      name.className = "chip-name";
      name.textContent = chip.path.split(/[\\/]/).pop() || chip.path;
      el.appendChild(name);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "\u00d7";
      remove.setAttribute("aria-label", `Remove ${name.textContent}`);
      remove.addEventListener("click", () => {
        this.chips = this.chips.filter((c) => c !== chip);
        this.renderChips();
      });
      el.appendChild(remove);
      this.tray.appendChild(el);
    }
  }

  private async attachPreview(chip: Attachment, thumb: HTMLImageElement): Promise<void> {
    let preview = this.previews.get(chip.path);
    if (!preview) {
      const loaded = await window.pishift.imagePreview(chip.path, THUMB_SIZE);
      if (!loaded) {
        thumb.remove();
        return;
      }
      this.previews.set(chip.path, loaded);
      preview = loaded;
    }
    thumb.src = preview.dataUrl;
  }

  private async showFullPreview(path: string): Promise<void> {
    const preview = await window.pishift.imagePreview(path, FULL_PREVIEW_SIZE);
    if (!preview) return;
    const fileName = path.split(/[\\/]/).pop() || "Image Preview";
    this.lightbox.open(
      preview.dataUrl,
      fileName,
      { width: preview.width, height: preview.height },
      path,
      () => {
        this.previews.delete(path);
        this.renderChips();
      },
    );
  }
}
