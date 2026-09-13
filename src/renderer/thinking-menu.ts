import { formatThinkingLevel } from "./dock";
import { getThinkingIconSvg } from "./thinking-icons";
import { attachToolbarHoverPill, popoverMotion } from "./motion-utils";
import type { ThinkingControlStyle } from "../shared/ipc";

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 12;

/**
 * Multi-mode selector for the model's thinking effort ladder.
 * Supports three presentation styles (switched via Settings):
 * 1. "horizontal": Thick horizontal pill slider with directional motion blur (Default)
 * 2. "vertical": Compact vertical control fader filling from bottom to top
 * 3. "list": Original popover list menu with KokonutUI sliding hover pill
 */
export class ThinkingMenu {
  readonly el: HTMLDivElement;
  private style: ThinkingControlStyle = "horizontal";
  private levels: readonly string[] = [];
  private current = "";
  private lastIdx = -1;
  private onSelectCallback: (level: string) => void;
  private listPill: { dispose: () => void; sync: (immediate?: boolean) => void } | null = null;
  private readonly iconEl: HTMLSpanElement;
  private readonly nameEl: HTMLSpanElement;
  private readonly trackEl: HTMLDivElement;
  private readonly sliderEl: HTMLInputElement;
  private readonly fillEl: HTMLDivElement;
  private readonly ticksEl: HTMLDivElement;
  private readonly thumbEl: HTMLDivElement;

  constructor(private readonly anchor: HTMLElement, onSelect: (level: string) => void) {
    this.onSelectCallback = onSelect;
    this.el = document.createElement("div");
    this.el.id = "thinking-menu-popover";
    this.el.className = "thinking-menu-popover style-horizontal";
    this.el.setAttribute("hidden", "true");

    this.iconEl = document.createElement("span");
    this.iconEl.className = "thinking-slider-icon";
    this.nameEl = document.createElement("span");
    this.nameEl.className = "thinking-slider-name";

    this.fillEl = document.createElement("div");
    this.fillEl.className = "thinking-slider-fill";

    this.ticksEl = document.createElement("div");
    this.ticksEl.className = "thinking-slider-ticks";

    this.thumbEl = document.createElement("div");
    this.thumbEl.className = "thinking-slider-thumb";

    this.sliderEl = document.createElement("input");
    this.sliderEl.type = "range";
    this.sliderEl.className = "thinking-slider";
    this.sliderEl.step = "1";
    this.sliderEl.setAttribute("aria-label", "Thinking level");
    this.sliderEl.addEventListener("input", () => this.previewIndex(Number(this.sliderEl.value)));
    this.sliderEl.addEventListener("change", () => this.commitIndex(Number(this.sliderEl.value)));
    this.sliderEl.addEventListener("pointerdown", () => this.trackEl.classList.add("active"));
    window.addEventListener("pointerup", () => this.trackEl.classList.remove("active"));
    window.addEventListener("pointercancel", () => this.trackEl.classList.remove("active"));

    this.trackEl = document.createElement("div");
    this.trackEl.className = "thinking-slider-track";
    this.trackEl.append(this.fillEl, this.ticksEl, this.thumbEl, this.sliderEl);

    document.body.appendChild(this.el);

    document.addEventListener("mousedown", (ev) => {
      if (this.el.hidden) return;
      const target = ev.target as Node;
      if (!this.el.contains(target) && target !== this.anchor && !this.anchor.contains(target)) {
        this.close();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (!this.el.hidden && ev.key === "Escape") this.close();
    });

    window.addEventListener("resize", () => {
      if (this.isOpen) this.position();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  get currentLevel(): string {
    return this.current;
  }

  getStyle(): ThinkingControlStyle {
    return this.style;
  }

  setStyle(style: ThinkingControlStyle): void {
    if (this.style === style) return;
    this.style = style;
    this.el.className = `thinking-menu-popover style-${style}`;
    if (this.isOpen) {
      this.render();
      requestAnimationFrame(() => this.position());
    }
  }

  setLevels(levels: readonly string[], current: string): void {
    this.levels = levels.filter((l) => l.toLowerCase() !== "auto");
    if (this.levels.length === 0) this.levels = ["off"];
    this.current = current === "auto" ? (this.levels[0] || "off") : current;
    if (this.isOpen) this.render();
  }

  toggle(levels: readonly string[], current: string): void {
    this.levels = levels.filter((l) => l.toLowerCase() !== "auto");
    if (this.levels.length === 0) this.levels = ["off"];
    this.current = current === "auto" ? (this.levels[0] || "off") : current;
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.levels.length === 0) return;
    this.lastIdx = -1;
    this.anchor.classList.add("open");
    this.render();
    this.el.removeAttribute("hidden");
    requestAnimationFrame(() => {
      if (this.isOpen) {
        this.position();
        this.listPill?.sync(true);
      }
    });
    const controls = popoverMotion.animatePopoverOpen(this.el);
    controls.then(() => this.listPill?.sync(true));
  }

  close(): void {
    if (this.el.hidden) return;
    this.trackEl.classList.remove("active");
    this.listPill?.dispose();
    this.listPill = null;
    this.anchor.classList.remove("open");
    popoverMotion.animatePopoverClose(this.el, () => {
      this.el.setAttribute("hidden", "true");
    });
  }

  private position(): void {
    const anchorRect = this.anchor.getBoundingClientRect();
    let menuW = this.el.offsetWidth;
    let menuH = this.el.offsetHeight;

    if (!menuW || !menuH) {
      if (this.style === "vertical") {
        menuW = 76;
        menuH = 270;
      } else if (this.style === "list") {
        menuW = 160;
        menuH = 220;
      } else {
        menuW = 300;
        menuH = 80;
      }
    }

    // Center horizontally over the Thinking button.
    let left = anchorRect.left + (anchorRect.width - menuW) / 2;
    left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(left, window.innerWidth - menuW - VIEWPORT_MARGIN),
    );

    // Prefer above the button with a clear gap; flip below if clipped.
    let top = anchorRect.top - menuH - ANCHOR_GAP;
    if (top < VIEWPORT_MARGIN) {
      top = Math.min(anchorRect.bottom + ANCHOR_GAP, window.innerHeight - menuH - VIEWPORT_MARGIN);
    }

    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  /** Live-preview a dragged index without committing the selection. */
  private previewIndex(idx: number): void {
    const level = this.levels[idx];
    if (level === undefined) return;
    this.paint(level);
  }

  /** Commit a dragged/keyboard-adjusted index as the selected level. */
  private commitIndex(idx: number): void {
    const level = this.levels[idx];
    if (level === undefined) return;
    this.current = level;
    this.paint(level);
    this.onSelectCallback(level);
  }

  private render(): void {
    this.levels = this.levels.filter((l) => l.toLowerCase() !== "auto");
    if (this.levels.length === 0) this.levels = ["off"];
    const count = this.levels.length;

    this.el.className = `thinking-menu-popover style-${this.style}`;

    if (this.style === "list") {
      this.listPill?.dispose();
      this.listPill = null;
      this.el.replaceChildren();

      const listEl = document.createElement("div");
      listEl.className = "thinking-menu-list";
      const levels = [...this.levels].reverse();
      for (let i = 0; i < levels.length; i++) {
        const level = levels[i]!;
        const row = document.createElement("div");
        row.className = "thinking-menu-item";
        row.role = "option";
        if (level === this.current) row.classList.add("active");
        const iconSvg = getThinkingIconSvg(level);
        const label = formatThinkingLevel(level);
        row.innerHTML = `${iconSvg}<span class="thinking-menu-item-name">${label}</span>`;
        row.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          this.current = level;
          this.onSelectCallback(level);
          this.close();
        });
        listEl.appendChild(row);
      }
      this.el.appendChild(listEl);
      this.listPill = attachToolbarHoverPill(listEl, {
        itemSelector: ".thinking-menu-item",
        parkedSelector: ".thinking-menu-item.active",
        pillClass: "thinking-row-indicator",
        box: true,
      });
      return;
    }

    // Slider modes ("horizontal" or "vertical")
    this.listPill?.dispose();
    this.listPill = null;
    this.el.replaceChildren();

    const head = document.createElement("div");
    head.className = "thinking-slider-head";
    head.append(this.iconEl, this.nameEl);

    this.sliderEl.min = "0";
    this.sliderEl.max = String(Math.max(0, count - 1));
    this.sliderEl.disabled = count <= 1;
    this.sliderEl.setAttribute("orient", this.style === "vertical" ? "vertical" : "horizontal");

    this.ticksEl.replaceChildren();
    for (let i = 0; i < count; i++) {
      const tick = document.createElement("span");
      tick.className = "thinking-slider-tick";
      tick.title = formatThinkingLevel(this.levels[i]!);
      this.ticksEl.appendChild(tick);
    }

    this.el.append(head, this.trackEl);
    this.paint(this.current || this.levels[0] || "off");
  }

  /** Paints icon, label, fill %, and dot styling for `level`. */
  private paint(level: string): void {
    if (this.style === "list") {
      this.current = level;
      for (const row of this.el.querySelectorAll(".thinking-menu-item")) {
        const text = row.querySelector(".thinking-menu-item-name")?.textContent;
        row.classList.toggle("active", text === formatThinkingLevel(level));
      }
      this.listPill?.sync(true);
      return;
    }

    this.iconEl.innerHTML = getThinkingIconSvg(level);
    this.nameEl.textContent = formatThinkingLevel(level);

    let idx = this.levels.indexOf(level);
    if (idx < 0) idx = 0;

    // Directional sliding motion blur:
    if (this.lastIdx >= 0 && this.lastIdx !== idx) {
      const goingUp = idx > this.lastIdx;
      if (this.style === "vertical") {
        const startY = goingUp ? 18 : -18;
        if (typeof this.nameEl.animate === "function") {
          this.nameEl.animate(
            [
              { transform: `translateY(${startY}px)`, opacity: 0, filter: "blur(6px)" },
              { transform: "translateY(0px)", opacity: 1, filter: "blur(0px)" },
            ],
            { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
          );
        }
      } else {
        const startX = goingUp ? -38 : 38;
        const startSkew = goingUp ? -12 : 12;
        const iconStartX = goingUp ? -18 : 18;
        if (typeof this.nameEl.animate === "function") {
          this.nameEl.animate(
            [
              { transform: `translateX(${startX}px) skewX(${startSkew}deg)`, opacity: 0, filter: "blur(10px)" },
              { transform: "translateX(0px) skewX(0deg)", opacity: 1, filter: "blur(0px)" },
            ],
            { duration: 280, easing: "cubic-bezier(0.08, 0.9, 0.2, 1)" }
          );
        }
        if (typeof this.iconEl.animate === "function") {
          this.iconEl.animate(
            [
              { transform: `translateX(${iconStartX}px)`, opacity: 0.1, filter: "blur(6px)" },
              { transform: "translateX(0px)", opacity: 1, filter: "blur(0px)" },
            ],
            { duration: 260, easing: "cubic-bezier(0.08, 0.9, 0.2, 1)" }
          );
        }
      }
    }
    this.lastIdx = idx;

    if (this.sliderEl.value !== String(idx)) this.sliderEl.value = String(idx);
    const count = this.levels.length;
    const progress = count > 1 ? idx / (count - 1) : 0;
    this.trackEl.style.setProperty("--thumb-progress", String(progress));
    this.sliderEl.style.setProperty("--thinking-fill", `${(progress * 100).toFixed(2)}%`);
    const ticks = this.ticksEl.children;
    for (let i = 0; i < ticks.length; i++) {
      ticks[i]!.classList.toggle("filled", i <= idx);
      ticks[i]!.classList.toggle("current", i === idx);
    }
  }
}
