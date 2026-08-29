import type { PasteMode } from "../shared/paste-attach";

export type PasteMenuChoice = (mode: PasteMode) => void;

/** omp's own selector rows, in omp's order and wording. */
const PASTE_MENU_ITEMS: readonly { mode: PasteMode; name: string; desc: string }[] = [
  {
    mode: "wrapped",
    name: "Attach as a wrapped block",
    desc: "Wrap the text in <attachment> tags, collapsed to a marker",
  },
  {
    mode: "file",
    name: "Attach as local file",
    desc: "Save the text to a local://paste file",
  },
  {
    mode: "inline",
    name: "Paste inline",
    desc: "Collapse the text to an inline paste marker",
  },
];

/**
 * Dock popover asking how to attach a long paste.
 *
 * Sibling of SlashMenu, deliberately not sharing its implementation: this one
 * is modal (it owes an answer) and has a fixed three-row list.
 */
export class PasteMenu {
  readonly el: HTMLDivElement;
  private rows: HTMLElement[] = [];
  private selectedIndex = 0;
  private onChoose: PasteMenuChoice | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "paste-menu";
    this.el.hidden = true;
    this.el.setAttribute("role", "listbox");
    this.el.setAttribute("aria-label", "Long paste options");
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(lines: number, onChoose: PasteMenuChoice): void {
    this.onChoose = onChoose;
    this.selectedIndex = 0;
    this.render(lines);
    this.el.hidden = false;
  }

  /** Hides without answering. Callers that owe an answer use cancel(). */
  close(): void {
    this.el.hidden = true;
    this.el.replaceChildren();
    this.rows = [];
    this.selectedIndex = 0;
    this.onChoose = null;
  }

  moveSelection(delta: number): void {
    const count = PASTE_MENU_ITEMS.length;
    this.selectedIndex = (this.selectedIndex + delta + count) % count;
    this.updateActive();
  }

  selectCurrent(): void {
    const item = PASTE_MENU_ITEMS[this.selectedIndex];
    if (item) this.choose(item.mode);
  }

  /** Esc, blur, or any other abandonment: omp treats these as "paste inline". */
  cancel(): void {
    if (this.isOpen) this.choose("inline");
  }

  private choose(mode: PasteMode): void {
    const callback = this.onChoose;
    this.close();
    callback?.(mode);
  }

  private render(lines: number): void {
    this.el.replaceChildren();
    this.rows = [];

    const head = document.createElement("div");
    head.className = "paste-menu-head";
    head.textContent = `Pasted ${lines} lines`;
    this.el.appendChild(head);

    PASTE_MENU_ITEMS.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = i === this.selectedIndex ? "paste-item active" : "paste-item";
      row.role = "option";
      row.setAttribute("aria-selected", i === this.selectedIndex ? "true" : "false");

      const nameSpan = document.createElement("span");
      nameSpan.className = "paste-name";
      nameSpan.textContent = item.name;

      const descSpan = document.createElement("span");
      descSpan.className = "paste-desc";
      descSpan.textContent = item.desc;

      row.appendChild(nameSpan);
      row.appendChild(descSpan);

      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.choose(item.mode);
      });

      row.addEventListener("mouseenter", () => {
        this.selectedIndex = i;
        this.updateActive();
      });

      this.rows.push(row);
      this.el.appendChild(row);
    });

    const help = document.createElement("div");
    help.className = "paste-menu-help";
    help.textContent = "Esc to paste inline";
    this.el.appendChild(help);
  }

  private updateActive(): void {
    this.rows.forEach((row, i) => {
      const isSelected = i === this.selectedIndex;
      row.classList.toggle("active", isSelected);
      row.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
  }
}
