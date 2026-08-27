import type { IMarker } from "@xterm/xterm";

import { formatRelativeTime } from "./recent-chats-modal";

export interface SentMessageEntry {
  text: string;
  /** Null for entries backfilled from a session transcript: the turn predates
   * this window, so there is no registered marker. Such a row is still
   * clickable — the jump falls back to searching the scrollback. */
  marker: IMarker | null;
  at: number;
}

/** Bars in the collapsed hamburger handle. */
const HANDLE_BARS = 3;
const COLLAPSE_DELAY_MS = 150;
/** How long a row stays flagged after a jump finds nothing to scroll to. */
const MISS_FLASH_MS = 600;

/**
 * Right-center affordance: a small three-bar hamburger handle that expands on
 * hover into the list of everything typed in this tab, each row jumping the
 * terminal to where it was sent.
 *
 * Visibility of the expanded menu is driven by the `hidden` property rather
 * than a CSS class, so no later-loaded `display` rule can leave it stuck open.
 */
export class ActivityTab {
  readonly el: HTMLDivElement;
  private handleEl: HTMLDivElement;
  private menuEl: HTMLDivElement;
  private onJump: ((entry: SentMessageEntry) => boolean) | null = null;
  private collapseTimer: number | undefined;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "activity-tab";
    this.el.hidden = true;

    this.handleEl = document.createElement("div");
    this.handleEl.className = "activity-tab-handle";
    this.handleEl.setAttribute("role", "button");
    this.handleEl.setAttribute("aria-label", "Sent messages");
    this.handleEl.tabIndex = 0;
    for (let i = 0; i < HANDLE_BARS; i++) {
      const bar = document.createElement("span");
      bar.className = "activity-tab-bar";
      this.handleEl.appendChild(bar);
    }

    this.menuEl = document.createElement("div");
    this.menuEl.className = "activity-tab-menu";
    this.menuEl.hidden = true;

    this.el.append(this.handleEl, this.menuEl);
    this.el.addEventListener("mouseenter", () => this.showMenu());
    this.el.addEventListener("mouseleave", () => this.scheduleHideMenu());
    // Keyboard parity: the handle is focusable, so Enter/Space must open it too.
    this.handleEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (this.menuEl.hidden) this.showMenu();
      else this.collapse();
    });

    document.body.appendChild(this.el);
  }

  setEntries(entries: SentMessageEntry[], onJump: (entry: SentMessageEntry) => boolean): void {
    this.onJump = onJump;
    this.el.hidden = entries.length === 0;
    if (entries.length === 0) {
      this.collapse();
      return;
    }

    this.menuEl.replaceChildren();
    for (const entry of [...entries].reverse()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "activity-tab-item";
      item.title = "Jump to this message";

      const text = document.createElement("span");
      text.className = "activity-tab-item-text";
      text.textContent = entry.text;

      const time = document.createElement("span");
      time.className = "activity-tab-item-time";
      time.textContent = formatRelativeTime(entry.at);

      item.append(text, time);
      item.addEventListener("click", () => {
        if (this.onJump?.(entry)) {
          // Jump landed: get the menu out of the way of what it revealed.
          this.collapse();
          return;
        }
        // Turn predates this window's buffer and was never replayed, so there
        // is nothing to scroll to — show that instead of dying silently.
        item.classList.add("miss");
        window.setTimeout(() => item.classList.remove("miss"), MISS_FLASH_MS);
      });
      this.menuEl.appendChild(item);
    }
  }

  private showMenu(): void {
    window.clearTimeout(this.collapseTimer);
    this.menuEl.hidden = false;
  }

  private scheduleHideMenu(): void {
    window.clearTimeout(this.collapseTimer);
    this.collapseTimer = window.setTimeout(() => this.collapse(), COLLAPSE_DELAY_MS);
  }

  private collapse(): void {
    window.clearTimeout(this.collapseTimer);
    this.menuEl.hidden = true;
  }
}
