import { formatThinkingLevel } from "./dock";
import { getThinkingIconSvg } from "./thinking-icons";

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 12;

export class ThinkingMenu {
  readonly el: HTMLDivElement;
  private levels: readonly string[] = [];
  private current = "";
  private onSelectCallback: (level: string) => void;

  constructor(private readonly anchor: HTMLElement, onSelect: (level: string) => void) {
    this.onSelectCallback = onSelect;
    this.el = document.createElement("div");
    this.el.id = "thinking-menu-popover";
    this.el.className = "thinking-menu-popover";
    this.el.setAttribute("hidden", "true");
    this.el.setAttribute("role", "listbox");
    this.el.setAttribute("aria-label", "Thinking level");
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

  setLevels(levels: readonly string[], current: string): void {
    this.levels = levels;
    this.current = current;
    if (this.isOpen) this.render();
  }

  toggle(levels: readonly string[], current: string): void {
    this.levels = levels;
    this.current = current;
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.levels.length === 0) return;
    this.render();
    this.el.removeAttribute("hidden");
    // Measure after layout so offsetWidth/Height are final (ignores open animation transform).
    requestAnimationFrame(() => {
      if (this.isOpen) this.position();
    });
  }

  close(): void {
    this.el.setAttribute("hidden", "true");
  }

  private position(): void {
    const anchorRect = this.anchor.getBoundingClientRect();
    const menuW = this.el.offsetWidth || 140;
    const menuH = this.el.offsetHeight;

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

  private render(): void {
    this.el.replaceChildren();
    for (const level of [...this.levels].reverse()) {
      const row = document.createElement("div");
      row.className = level === this.current ? "thinking-menu-item active" : "thinking-menu-item";
      row.role = "option";
      row.setAttribute("aria-selected", level === this.current ? "true" : "false");
      const iconSvg = getThinkingIconSvg(level);
      const label = formatThinkingLevel(level);
      row.innerHTML = `${iconSvg}<span>${label}</span>`;
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.close();
        this.onSelectCallback(level);
      });
      this.el.appendChild(row);
    }
  }
}
