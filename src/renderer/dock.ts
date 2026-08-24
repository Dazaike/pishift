import { IMAGE_EXT, type ImagePreview } from "../shared/ipc";
import { DockGlow } from "./dock-glow";
import { filePaths } from "./dnd";
import { highlightMessage } from "./highlight";
import { ImageLightbox } from "./image-lightbox";
import { getProviderIcon } from "./provider-icons";
import { SlashMenu } from "./slash-menu";

export type DockPayload = {
  text: string;
  imagePaths: string[];
  otherPaths: string[];
};
export type PlanState = "off" | "on" | "paused";
export type Attachment = { path: string; isImage: boolean };

/** Fallback when model metadata is unknown — no xhigh (many models lack it). */
export const DEFAULT_THINKING_LEVELS = [
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
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
  };
  const key = (raw ?? "").toLowerCase().trim();
  return map[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Low");
}

/** Canonical effort token used in UI state and `/m` commands. */
export function normalizeThinkingToken(raw: string): string {
  const key = (raw ?? "").toLowerCase().trim();
  if (key === "auto") return "auto";
  if (key === "min") return "minimal";
  if (key === "med") return "medium";
  if (key === "xhi") return "xhigh";
  return key || "low";
}

/** Compact token preferred by control-bridge `/m`. */
export function toThinkingCommandToken(raw: string): string {
  const key = normalizeThinkingToken(raw);
  if (key === "auto") return "auto";
  if (key === "minimal") return "min";
  if (key === "medium") return "med";
  if (key === "xhigh") return "xhi";
  return key;
}

export function buildThinkingLevelsForModel(opts: {
  reasoning?: boolean;
  thinkingEfforts?: string[];
  thinkingRequiresEffort?: boolean;
} | null | undefined): string[] {
  if (!opts) return [...DEFAULT_THINKING_LEVELS];

  const efforts = (opts.thinkingEfforts ?? [])
    .map(normalizeThinkingToken)
    .filter(Boolean);

  // Non-reasoning / no effort ladder → thinking off only.
  if (!opts.reasoning && efforts.length === 0) return ["off"];

  if (efforts.length === 0) return [...DEFAULT_THINKING_LEVELS];

  const unique: string[] = [];
  for (const e of efforts) {
    if (e !== "off" && e !== "auto" && !unique.includes(e)) unique.push(e);
  }

  // Always expose Auto & Off so users can select automatic or disabled reasoning.
  return ["auto", "off", ...unique];
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
    minimal: ["low"],
    min: ["minimal", "low"],
    medium: ["low", "high"],
    med: ["medium", "low", "high"],
    xhigh: ["high", "max"],
    xhi: ["xhigh", "high", "max"],
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
  history: string[];
  planState: PlanState;
  modelName: string;
  thinkingLevel: string;
};

export interface DockHooks {
  submit(payload: DockPayload): void;
  interrupt(): void;
  focusTerminal(): void;
  forwardChord(ev: KeyboardEvent): boolean;
  type(data: string): void;
  togglePlan(next: "on" | "off"): void;
  openModel(): void;
  openUsage(): void;
  openTools?(): void;
  cycleThinking(): void;
  changeCwd(): void;
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
  private readonly cwdLabel = document.getElementById("dock-cwd") as HTMLSpanElement;
  private readonly changeDirBtn = document.getElementById("dock-change-dir") as HTMLButtonElement;
  private readonly usageBtn = document.getElementById("dock-usage-btn") as HTMLButtonElement;
  private readonly toolsBtn = document.getElementById("dock-tools-btn") as HTMLButtonElement | null;
  private readonly expandBtn = document.getElementById("dock-expand-btn") as HTMLButtonElement | null;
  private readonly modelBtn = document.getElementById("dock-model") as HTMLButtonElement;
  private readonly planBtn = document.getElementById("dock-plan") as HTMLButtonElement;
  private readonly thinkingBtn = document.getElementById("dock-thinking-btn") as HTMLButtonElement;
  private readonly sendButton = document.getElementById("dock-send") as HTMLButtonElement;
  private readonly slashMenu: SlashMenu;
  private readonly glow: DockGlow;
  private readonly lightbox = new ImageLightbox();
  private isExpanded = false;
  private chips: Attachment[] = [];
  private history: string[] = [];
  private historyIndex = -1;
  private draft = "";
  private planState: PlanState = "off";
  private modelName = "";
  private thinkingLevel = "low";
  private thinkingLevels: string[] = [...DEFAULT_THINKING_LEVELS];
  private readonly previews = new Map<string, ImagePreview>();
  constructor(private readonly hooks: DockHooks) {
    this.slashMenu = new SlashMenu((cmd) => {
      const text = this.input.value;
      const match = /^\/([a-zA-Z0-9_-]*)$/.exec(text);
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
    editorEl.appendChild(this.slashMenu.el);

    this.sendButton.addEventListener("click", () => this.submit());
    this.changeDirBtn.addEventListener("click", () => this.hooks.changeCwd());
    this.usageBtn.addEventListener("click", () => this.hooks.openUsage());
    this.modelBtn.addEventListener("click", () => this.hooks.openModel());
    this.toolsBtn?.addEventListener("click", () => this.hooks.openTools?.());
    this.expandBtn?.addEventListener("click", () => this.toggleExpand());
    this.planBtn.addEventListener("click", () => {
      // Binary only. Native omp may pass through PAUSED; treat it as ON.
      const isOn = this.planState === "on" || this.planState === "paused";
      const next: "on" | "off" = isOn ? "off" : "on";
      this.planState = next;
      this.updatePlanButton();
      this.hooks.togglePlan(next);
    });

    this.thinkingBtn.addEventListener("click", () => {
      this.hooks.cycleThinking();
    });

    this.input.addEventListener("input", () => {
      this.render();
      this.checkSlashMenu();
    });

    this.input.addEventListener("scroll", () => {
      this.mirror.scrollTop = this.input.scrollTop;
      this.mirror.scrollLeft = this.input.scrollLeft;
    });

    this.input.addEventListener("keydown", (ev) => this.onKeyDown(ev));
    this.input.addEventListener("paste", (ev) => void this.onPaste(ev));
    this.input.addEventListener("focus", () => this.root.classList.add("focused"));
    this.input.addEventListener("blur", () => {
      this.root.classList.remove("focused");
      setTimeout(() => {
        if (document.activeElement !== this.input) {
          this.slashMenu.close();
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
  }

  /** Orbiting glow around the composer while the active session is busy. */
  setAgentBusy(busy: boolean, kind: "idle" | "working" | "thinking" = "idle"): void {
    this.root.classList.toggle("agent-busy", busy);
    this.root.classList.toggle("agent-working", busy && kind === "working");
    this.root.classList.toggle("agent-thinking", busy && kind === "thinking");
    if (busy && (kind === "working" || kind === "thinking")) {
      this.glow.start(kind);
    } else {
      this.glow.stop();
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

  setPlanState(state: PlanState): void {
    this.planState = state;
    this.updatePlanButton();
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
    this.thinkingBtn.innerHTML = `<img src="./assets/icons/thinking.png" alt="" class="btn-icon" /><span class="dock-thinking-label">Thinking: ${this.thinkingLevel}</span>`;
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

  snapshot(): DockState {
    return {
      text: this.input.value,
      chips: [...this.chips],
      history: [...this.history],
      planState: this.planState,
      modelName: this.modelName,
      thinkingLevel: this.thinkingLevel,
    };
  }

  load(state: DockState | undefined): void {
    this.input.value = state?.text ?? "";
    this.chips = state ? [...state.chips] : [];
    this.history = state ? [...state.history] : [];
    this.planState = state?.planState ?? "off";
    this.modelName = state?.modelName ?? "";
    this.thinkingLevel = state?.thinkingLevel ?? "low";
    this.historyIndex = -1;
    this.draft = "";
    this.slashMenu.close();
    this.updatePlanButton();
    this.setModelName(this.modelName);
    this.setThinkingLevel(this.thinkingLevel);
    this.renderChips();
    this.render();
  }

  private updatePlanButton(): void {
    this.planBtn.classList.remove("plan-off", "plan-on", "plan-paused");
    const icon = `<img src="./assets/icons/plan.png" alt="" class="btn-icon" />`;
    if (this.planState === "on") {
      this.planBtn.innerHTML = `${icon}<span class="dock-plan-label">Plan: ON</span>`;
      this.planBtn.classList.add("plan-on");
      this.planBtn.title = "Plan mode ON — click to turn OFF";
    } else if (this.planState === "paused") {
      this.planBtn.innerHTML = `${icon}<span class="dock-plan-label">Plan: ON</span>`;
      this.planBtn.classList.add("plan-on");
      this.planBtn.title = "Plan mode ON — click to turn OFF";
    } else {
      this.planBtn.innerHTML = `${icon}<span class="dock-plan-label">Plan: OFF</span>`;
      this.planBtn.classList.add("plan-off");
      this.planBtn.title = "Plan mode OFF — click to turn ON";
    }
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
    const payload: DockPayload = {
      text,
      imagePaths: this.chips.filter((chip) => chip.isImage).map((chip) => chip.path),
      otherPaths: this.chips.filter((chip) => !chip.isImage).map((chip) => chip.path),
    };
    if (!text.trim() && payload.imagePaths.length + payload.otherPaths.length === 0) return;

    this.slashMenu.close();
    this.playSendAnimation(payload.imagePaths.length + payload.otherPaths.length > 0);
    this.hooks.submit(payload);

    if (text.trim() && this.history[this.history.length - 1] !== text) {
      this.history.push(text);
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    this.historyIndex = -1;
    this.draft = "";
    this.input.value = "";
    this.chips = [];
    this.renderChips();
    this.render();
  }

  /** Brief launch feedback when Enter / Send fires. */
  private playSendAnimation(hadAttachments: boolean): void {
    this.root.classList.remove("sending", "sending-attach");
    this.sendButton.classList.remove("sending");
    // Restart CSS animations if the user hammers Enter.
    void this.root.offsetWidth;
    this.root.classList.add("sending");
    if (hadAttachments) this.root.classList.add("sending-attach");
    this.sendButton.classList.add("sending");
    window.setTimeout(() => {
      this.root.classList.remove("sending", "sending-attach");
      this.sendButton.classList.remove("sending");
    }, 480);
  }

  private onKeyDown(ev: KeyboardEvent): void {
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
        if (cmd) {
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
    if (!files.some((file) => file.type.startsWith("image/"))) return;

    ev.preventDefault();
    const saved = await window.omphif.saveClipboardImage();
    if (saved) {
      this.addPaths([saved]);
      return;
    }
    const text = await window.omphif.readClipboardText();
    if (text) this.insertText(text);
  }

  private insertText(text: string): void {
    const { selectionStart: start, selectionEnd: end, value } = this.input;
    this.input.value = value.slice(0, start) + text + value.slice(end);
    const caret = start + text.length;
    this.input.setSelectionRange(caret, caret);
    this.render();
  }

  private render(): void {
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
      const loaded = await window.omphif.imagePreview(chip.path, THUMB_SIZE);
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
    const preview = await window.omphif.imagePreview(path, FULL_PREVIEW_SIZE);
    if (!preview) return;
    const fileName = path.split(/[\\/]/).pop() || "Image Preview";
    this.lightbox.open(preview.dataUrl, fileName, {
      width: preview.width,
      height: preview.height,
    });
  }
}
