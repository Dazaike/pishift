import { DEFAULT_SLASH_ICON, SKILL_SLASH_ICON, SLASH_COMMAND_ICONS } from "./slash-command-icons";
import { SLASH_COMMANDS, type SlashCommand } from "../shared/slash-commands";
import { rankSlashCommands } from "../shared/slash-rank";
import { popoverMotion } from "./motion-utils";

const USAGE_STORAGE_KEY = "pishift.slashCommandUsage";

function loadUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(USAGE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") return parsed as Record<string, number>;
  } catch {
    // Corrupt/blocked storage — start fresh.
  }
  return {};
}

function saveUsage(usage: Record<string, number>): void {
  try {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage));
  } catch {
    // Storage unavailable — ranking just won't persist across restarts.
  }
}

export class SlashMenu {
  readonly el: HTMLDivElement;
  private items: SlashCommand[] = [];
  private selectedIndex = 0;
  private onSelectCallback: (cmd: SlashCommand) => void;
  private usage: Record<string, number>;
  private extra: SlashCommand[] = [];

  constructor(onSelect: (cmd: SlashCommand) => void) {
    this.onSelectCallback = onSelect;
    this.usage = loadUsage();
    this.el = document.createElement("div");
    this.el.id = "slash-menu";
    this.el.hidden = true;
    this.el.setAttribute("role", "listbox");
    this.el.setAttribute("aria-label", "Slash commands");
  }

  get isOpen(): boolean {
    return !this.el.hidden && this.items.length > 0;
  }

  /** Runtime-discovered commands (skills) appended to the generated built-in list. */
  setExtraCommands(commands: readonly SlashCommand[]): void {
    this.extra = [...commands];
  }

  open(query: string): boolean {
    this.items = rankSlashCommands([...SLASH_COMMANDS, ...this.extra], query, this.usage);

    if (this.items.length === 0) {
      this.close();
      return false;
    }

    this.selectedIndex = 0;
    this.render();
    const wasHidden = this.el.hidden;
    this.el.hidden = false;
    if (wasHidden) popoverMotion.animatePopoverOpen(this.el);
    return true;
  }

  close(): void {
    if (this.el.hidden) {
      this.items = [];
      this.selectedIndex = 0;
      return;
    }
    popoverMotion.animatePopoverClose(this.el, () => {
      this.el.hidden = true;
      this.items = [];
      this.selectedIndex = 0;
    });
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
    if (cmd) this.recordUsage(cmd);
    return cmd ?? null;
  }

  private recordUsage(cmd: SlashCommand): void {
    this.usage[cmd.name] = (this.usage[cmd.name] ?? 0) + 1;
    saveUsage(this.usage);
  }

  private render(): void {
    this.el.replaceChildren();
    for (let i = 0; i < this.items.length; i++) {
      const cmd = this.items[i]!;
      const row = document.createElement("div");
      row.className = i === this.selectedIndex ? "slash-item active" : "slash-item";
      row.role = "option";
      row.setAttribute("aria-selected", i === this.selectedIndex ? "true" : "false");

      const iconSpan = document.createElement("span");
      iconSpan.className = "slash-icon";
      iconSpan.textContent =
        SLASH_COMMAND_ICONS[cmd.name] ??
        (cmd.name.startsWith("skill:") ? SKILL_SLASH_ICON : DEFAULT_SLASH_ICON);

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

      row.appendChild(iconSpan);
      row.appendChild(nameSpan);
      row.appendChild(descSpan);

      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.recordUsage(cmd);
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
