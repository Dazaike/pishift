import { formatThinkingLevel } from "./dock";
import { getThinkingIconSvg } from "./thinking-icons";
import { attachToolbarHoverPill, popoverMotion } from "./motion-utils";

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 12;

export class ThinkingMenu {
  readonly el: HTMLDivElement;
  private levels: readonly string[] = [];
  private current = "";
  private onSelectCallback: (level: string) => void;
  private listPill: { dispose: () => void; sync: (immediate?: boolean) => void } | null = null;
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
    this.anchor.classList.remove("open");
    this.listPill?.dispose();
    this.listPill = null;
    popoverMotion.animatePopoverClose(this.el, () => {
      this.el.setAttribute("hidden", "true");
    });
  }

  private position(): void {
    const anchorRect = this.anchor.getBoundingClientRect();
    const menuW = this.el.offsetWidth || 135;
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
    this.listPill?.dispose();
    this.listPill = null;
    this.el.replaceChildren();
    const listEl = document.createElement("div");
    listEl.className = "thinking-menu-list";
    const levels = [...this.levels].reverse();
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i]!;
      const row = document.createElement("div");
      row.className = level === this.current ? "thinking-menu-item active" : "thinking-menu-item";
      row.role = "option";
      row.setAttribute("aria-selected", level === this.current ? "true" : "false");
      const iconSvg = getThinkingIconSvg(level);
      const label = formatThinkingLevel(level);
      row.innerHTML = `${iconSvg}<span class="thinking-menu-item-name">${label}</span>`;
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.current = level;
        for (const other of listEl.querySelectorAll(".thinking-menu-item")) {
          other.classList.toggle("active", other === row);
        }
        this.listPill?.sync();
        this.onSelectCallback(level);
        // Let the selection pill settle onto the picked row before the
        // popover closes, instead of closing before it's visible.
        window.setTimeout(() => this.close(), 320);
      });
      listEl.appendChild(row);
    }
    this.el.appendChild(listEl);
    this.listPill = attachToolbarHoverPill(listEl, {
      itemSelector: ".thinking-menu-item",
      // The selected thinking level is already communicated by its accent
      // color. Do not park the hover pill on it (notably when Plan mode
      // changes the selected level while the menu is open).
      pillClass: "thinking-row-indicator",
      box: true,
    });
  }
}
