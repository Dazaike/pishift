import { SLASH_COMMANDS, type SlashCommand } from "../shared/slash-commands";

export class SlashMenu {
  readonly el: HTMLDivElement;
  private items: SlashCommand[] = [];
  private selectedIndex = 0;
  private onSelectCallback: (cmd: SlashCommand) => void;

  constructor(onSelect: (cmd: SlashCommand) => void) {
    this.onSelectCallback = onSelect;
    this.el = document.createElement("div");
    this.el.id = "slash-menu";
    this.el.hidden = true;
    this.el.setAttribute("role", "listbox");
    this.el.setAttribute("aria-label", "Slash commands");
  }

  get isOpen(): boolean {
    return !this.el.hidden && this.items.length > 0;
  }

  open(query: string): boolean {
    const q = query.toLowerCase().trim();
    this.items = SLASH_COMMANDS.filter(
      (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    );

    if (this.items.length === 0) {
      this.close();
      return false;
    }

    this.selectedIndex = 0;
    this.render();
    this.el.hidden = false;
    return true;
  }

  close(): void {
    this.el.hidden = true;
    this.items = [];
    this.selectedIndex = 0;
  }

  moveSelection(delta: number): void {
    if (this.items.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex + delta + this.items.length) % this.items.length;
    this.updateActive();
    this.scrollSelectedIntoView();
  }

  selectCurrent(): SlashCommand | null {
    if (!this.isOpen || this.items.length === 0) return null;
    const cmd = this.items[this.selectedIndex];
    this.close();
    return cmd ?? null;
  }

  private render(): void {
    this.el.replaceChildren();
    for (let i = 0; i < this.items.length; i++) {
      const cmd = this.items[i]!;
      const row = document.createElement("div");
      row.className = i === this.selectedIndex ? "slash-item active" : "slash-item";
      row.role = "option";
      row.setAttribute("aria-selected", i === this.selectedIndex ? "true" : "false");

      const nameSpan = document.createElement("span");
      nameSpan.className = "slash-name";
      nameSpan.textContent = `/${cmd.name}`;

      if (cmd.hint) {
        const hintSpan = document.createElement("span");
        hintSpan.className = "slash-hint";
        hintSpan.textContent = ` ${cmd.hint}`;
        nameSpan.appendChild(hintSpan);
      }

      const descSpan = document.createElement("span");
      descSpan.className = "slash-desc";
      descSpan.textContent = cmd.description;

      row.appendChild(nameSpan);
      row.appendChild(descSpan);

      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.onSelectCallback(cmd);
        this.close();
      });

      row.addEventListener("mouseenter", () => {
        this.selectedIndex = i;
        this.updateActive();
      });

      this.el.appendChild(row);
    }
    this.scrollSelectedIntoView();
  }

  private updateActive(): void {
    const children = this.el.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      const isSelected = i === this.selectedIndex;
      child.classList.toggle("active", isSelected);
      child.setAttribute("aria-selected", isSelected ? "true" : "false");
    }
  }

  private scrollSelectedIntoView(): void {
    const active = this.el.children[this.selectedIndex] as HTMLElement | undefined;
    if (active) {
      active.scrollIntoView({ block: "nearest" });
    }
  }
}
