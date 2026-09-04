import {
  DEFAULT_TAB_LAYOUT_MODE,
  planTabOverflow,
  TAB_OVERFLOW_CHIP_RESERVE,
  type TabLayoutMode,
} from "../shared/tab-layout";
import { popoverMotion, safeAnimate, springPresets } from "./motion-utils";

/** One tab as the strip needs to see it; the owner keeps the real Tab record. */
export interface TabStripEntry {
  /** Stable identity across re-syncs (Tab.sessionNumber). */
  key: number;
  label: string;
  cwd: string;
  /** The tab's own header button, already parented to the scroller. */
  element: HTMLElement;
  active: boolean;
  busy: boolean;
  awaiting: boolean;
  /** Activity color when tab glow is enabled, else null. */
  glow: string | null;
}

export interface TabStripOptions {
  strip: HTMLElement;
  scroller: HTMLElement;
  nudgeLeft: HTMLButtonElement;
  nudgeRight: HTMLButtonElement;
  chip: HTMLButtonElement;
  entries: () => TabStripEntry[];
  onActivate: (key: number) => void;
  onClose: (key: number) => void;
}

/** Class that removes a condensed tab from the strip without unmounting it. */
const CONDENSED = "tab-condensed";
/** Must match the `gap` the strip paints between tabs. */
const TAB_GAP = 6;
const NUDGE_STEP = 180;

/**
 * Owns everything about *how* the tab row copes with overflow: which mode is
 * active, which tabs are condensed away, the scroll nudges, and the `+N`
 * switcher. It never mutates tab order or tab content — the owner still renders
 * each tab button itself and simply calls sync() afterwards.
 */
export class TabStrip {
  private mode: TabLayoutMode = DEFAULT_TAB_LAYOUT_MODE;
  private readonly menu: HTMLDivElement;
  private readonly menuTitle: HTMLSpanElement;
  private readonly menuFilter: HTMLInputElement;
  private readonly menuList: HTMLDivElement;
  private filterText = "";
  /**
   * Guard against re-measuring on every repaint. Deliberately excludes the
   * strip's own width (condensing changes it, which would oscillate) in favour
   * of the header width, which does not depend on tab content.
   */
  private lastSignature = "";
  private hiddenKeys = new Set<number>();
  private readonly indicator: HTMLDivElement;
  private readonly hoverIndicator: HTMLDivElement;
  private indicatorMounted = false;
  private hoverMounted = false;
  private hoveredTab: HTMLElement | null = null;
  constructor(private readonly opts: TabStripOptions) {
    this.menu = document.createElement("div");
    this.menu.className = "tab-switcher-popover popover-sheet";
    this.menu.setAttribute("hidden", "true");
    this.menu.setAttribute("role", "dialog");
    this.menu.setAttribute("aria-label", "All sessions");

    const header = document.createElement("div");
    header.className = "tab-switcher-header";
    this.menuTitle = document.createElement("span");
    this.menuTitle.className = "tab-switcher-title";
    this.menuFilter = document.createElement("input");
    this.menuFilter.type = "text";
    this.menuFilter.className = "tab-switcher-filter";
    this.menuFilter.placeholder = "Filter by name or folder";
    this.menuFilter.spellcheck = false;
    this.menuFilter.addEventListener("input", () => {
      this.filterText = this.menuFilter.value;
      this.renderMenuList(this.opts.entries());
    });
    header.append(this.menuTitle, this.menuFilter);

    this.menuList = document.createElement("div");
    this.menuList.className = "tab-switcher-list";
    this.menu.append(header, this.menuList);
    document.body.appendChild(this.menu);
    document.body.dataset.tabLayout = this.mode;
    this.hoverIndicator = document.createElement("div");
    this.hoverIndicator.className = "tab-hover-indicator";
    this.hoverIndicator.style.position = "absolute";
    this.hoverIndicator.style.pointerEvents = "none";
    this.hoverIndicator.style.opacity = "0";

    this.indicator = document.createElement("div");
    this.indicator.className = "tab-indicator";
    this.indicator.style.position = "absolute";
    this.indicator.style.pointerEvents = "none";
    this.indicator.style.opacity = "0";
    this.opts.scroller.prepend(this.hoverIndicator, this.indicator);

    this.opts.scroller.addEventListener("pointerover", (ev) => {
      const target = (ev.target as HTMLElement)?.closest(".tab:not(.tab-condensed)") as HTMLElement | null;
      if (target && target !== this.hoveredTab) {
        this.hoveredTab = target;
        this.syncHoverIndicator();
      }
    });

    this.opts.scroller.addEventListener("pointerout", (ev) => {
      const related = ev.relatedTarget as Node | null;
      if (!related || !this.opts.scroller.contains(related)) {
        this.hoveredTab = null;
        this.syncHoverIndicator();
      } else {
        const next = (related as HTMLElement)?.closest(".tab:not(.tab-condensed)") as HTMLElement | null;
        if (next !== this.hoveredTab) {
          this.hoveredTab = next;
          this.syncHoverIndicator();
        }
      }
    });

    opts.nudgeLeft.addEventListener("click", () => this.nudge(-1));
    opts.nudgeRight.addEventListener("click", () => this.nudge(1));
    opts.chip.addEventListener("click", () => this.toggleMenu());

    // A vertical wheel over a one-row strip is a request to travel along it.
    opts.scroller.addEventListener(
      "wheel",
      (ev) => {
        if (this.mode !== "scroll") return;
        const { scrollWidth, clientWidth } = opts.scroller;
        if (scrollWidth <= clientWidth) return;
        const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
        if (delta === 0) return;
        ev.preventDefault();
        opts.scroller.scrollLeft += delta;
        this.syncNudges();
      },
      { passive: false },
    );

    opts.scroller.addEventListener("scroll", () => this.syncNudges());

    document.addEventListener("mousedown", (ev) => {
      if (this.menu.hidden) return;
      const target = ev.target as Node;
      if (!this.menu.contains(target) && !opts.chip.contains(target)) this.closeMenu();
    });

    document.addEventListener("keydown", (ev) => {
      if (this.menu.hidden || ev.key !== "Escape") return;
      ev.stopPropagation();
      this.closeMenu();
    });

    window.addEventListener("resize", () => {
      if (!this.menu.hidden) this.positionMenu();
      this.sync();
      this.syncIndicator(true);
    });
  }

  /** Idempotent: also used to paint the initial mode at boot. */
  setMode(mode: TabLayoutMode): void {
    this.mode = mode;
    this.lastSignature = "";
    this.closeMenu();
    document.body.dataset.tabLayout = mode;
    this.sync();
    this.syncIndicator(true);
  }

  /**
   * Force the next sync() to re-measure. Needed when something outside the tab
   * list changes the header's spare width (icons-only toggles, burger-menu
   * collapse, pinned usage) — the signature cannot see those.
   */
  invalidate(): void {
    this.lastSignature = "";
  }
  syncHoverIndicator(immediate = false): void {
    if (this.hoverIndicator.parentElement !== this.opts.scroller) {
      this.opts.scroller.prepend(this.hoverIndicator);
    }
    const target = this.hoveredTab;
    const active = this.opts.scroller.querySelector(
      ".tab.active:not(.tab-condensed)"
    ) as HTMLElement | null;

    // If hovering the already active tab, hide the hover indicator so active pill takes precedence.
    if (!target || target === active || target.offsetWidth === 0) {
      if (immediate || !this.hoverMounted) {
        this.hoverIndicator.style.opacity = "0";
      } else {
        safeAnimate(this.hoverIndicator, { opacity: 0 }, { duration: 0.12 });
      }
      return;
    }

    const x = target.offsetLeft;
    const y = target.offsetTop;
    const width = target.offsetWidth;
    const height = target.offsetHeight;
    const transform = `translate(${x}px, ${y}px)`;

    if (immediate || !this.hoverMounted) {
      this.hoverIndicator.style.opacity = "1";
      this.hoverIndicator.style.transform = transform;
      this.hoverIndicator.style.width = `${width}px`;
      this.hoverIndicator.style.height = `${height}px`;
      this.hoverMounted = true;
    } else {
      this.hoverIndicator.style.opacity = "1";
      safeAnimate(
        this.hoverIndicator,
        {
          transform,
          width: `${width}px`,
          height: `${height}px`,
          opacity: 1,
        },
        springPresets.smooth as unknown as Record<string, unknown>
      );
    }
  }

  syncIndicator(immediate = false): void {
    if (this.indicator.parentElement !== this.opts.scroller) {
      this.opts.scroller.prepend(this.indicator);
    }
    const active = this.opts.scroller.querySelector(
      ".tab.active:not(.tab-condensed)"
    ) as HTMLElement | null;

    if (!active || active.offsetWidth === 0) {
      if (immediate || !this.indicatorMounted) {
        this.indicator.style.opacity = "0";
      } else {
        safeAnimate(this.indicator, { opacity: 0 }, { duration: 0.15 });
      }
      return;
    }

    const x = active.offsetLeft;
    const y = active.offsetTop;
    const width = active.offsetWidth;
    const height = active.offsetHeight;
    const transform = `translate(${x}px, ${y}px)`;

    if (immediate || !this.indicatorMounted) {
      this.indicator.style.opacity = "1";
      this.indicator.style.transform = transform;
      this.indicator.style.width = `${width}px`;
      this.indicator.style.height = `${height}px`;
      this.indicatorMounted = true;
    } else {
      this.indicator.style.opacity = "1";
      safeAnimate(
        this.indicator,
        {
          transform,
          width: `${width}px`,
          height: `${height}px`,
          opacity: 1,
        },
        springPresets.smooth as unknown as Record<string, unknown>
      );
    }
    this.syncHoverIndicator(immediate);
  }


  /** Recompute overflow affordances. Cheap when nothing measurable changed. */
  sync(): void {
    const entries = this.opts.entries();
    const signature = `${this.mode}|${document.documentElement.clientWidth}|${entries
      .map((e) => `${e.key}\u0002${e.label}${e.active ? "*" : ""}`)
      .join("\u0001")}`;

    if (signature === this.lastSignature) {
      if (this.mode === "scroll") this.syncNudges();
      this.syncIndicator();
      return;
    }
    this.lastSignature = signature;

    if (this.mode === "menu") this.condense(entries);
    else this.expandAll(entries);

    if (this.mode === "scroll") {
      this.scrollActiveIntoView(entries);
      this.syncNudges();
    } else {
      this.opts.nudgeLeft.hidden = true;
      this.opts.nudgeRight.hidden = true;
    }

    if (!this.menu.hidden) this.renderMenuList(entries);
    this.syncIndicator();
  }

  private expandAll(entries: readonly TabStripEntry[]): void {
    for (const entry of entries) entry.element.classList.remove(CONDENSED);
    this.hiddenKeys.clear();
    this.opts.chip.hidden = true;
  }

  /**
   * Measure with everything expanded and the chip out of the way, so the
   * available width is the true header allowance rather than the width the
   * previous condense pass happened to leave behind.
   */
  private condense(entries: readonly TabStripEntry[]): void {
    for (const entry of entries) entry.element.classList.remove(CONDENSED);
    this.opts.chip.hidden = true;
    if (entries.length <= 1) {
      this.hiddenKeys.clear();
      return;
    }

    const widths = entries.map((entry) => entry.element.offsetWidth);
    const { hidden } = planTabOverflow({
      widths,
      available: this.opts.scroller.clientWidth,
      activeIndex: entries.findIndex((entry) => entry.active),
      gap: TAB_GAP,
      chipWidth: TAB_OVERFLOW_CHIP_RESERVE,
    });

    this.hiddenKeys = new Set(hidden.map((index) => entries[index].key));
    for (const index of hidden) entries[index].element.classList.add(CONDENSED);

    this.opts.chip.hidden = hidden.length === 0;
    this.opts.chip.textContent = `+${hidden.length}`;
    this.opts.chip.title = `${hidden.length} more session${hidden.length === 1 ? "" : "s"} — click to switch`;
  }

  private scrollActiveIntoView(entries: readonly TabStripEntry[]): void {
    const activeEntry = entries.find((entry) => entry.active);
    activeEntry?.element.scrollIntoView({ inline: "nearest" });
  }

  private syncNudges(): void {
    if (this.mode !== "scroll") return;
    const { scrollLeft, scrollWidth, clientWidth } = this.opts.scroller;
    const overflowing = scrollWidth - clientWidth > 1;
    this.opts.nudgeLeft.hidden = !overflowing || scrollLeft <= 1;
    this.opts.nudgeRight.hidden = !overflowing || scrollLeft + clientWidth >= scrollWidth - 1;
  }

  private nudge(direction: -1 | 1): void {
    this.opts.scroller.scrollBy({ left: direction * NUDGE_STEP, behavior: "smooth" });
  }

  private toggleMenu(): void {
    if (this.menu.hidden) this.openMenu();
    else this.closeMenu();
  }

  private openMenu(): void {
    this.menuFilter.value = "";
    this.filterText = "";
    this.renderMenuList(this.opts.entries());
    this.menu.removeAttribute("hidden");
    this.positionMenu();
    popoverMotion.animatePopoverOpen(this.menu);
    this.menuFilter.focus();
  }

  private closeMenu(): void {
    popoverMotion.animatePopoverClose(this.menu, () => {
      this.menu.setAttribute("hidden", "true");
    });
  }


  private positionMenu(): void {
    const anchor = this.opts.chip.getBoundingClientRect();
    const width = this.menu.offsetWidth || 300;
    const pad = 8;
    const left = Math.max(pad, Math.min(anchor.left, window.innerWidth - pad - width));
    this.menu.style.top = `${Math.round(anchor.bottom + 6)}px`;
    this.menu.style.left = `${Math.round(left)}px`;
  }

  /**
   * Rebuilds only the row list. The header and its filter input are built once,
   * so a repaint driven by agent activity cannot steal focus mid-typing.
   */
  private renderMenuList(entries: readonly TabStripEntry[]): void {
    const needle = this.filterText.trim().toLowerCase();
    const matches = needle
      ? entries.filter(
          (entry) =>
            entry.label.toLowerCase().includes(needle) ||
            entry.cwd.toLowerCase().includes(needle),
        )
      : entries;

    this.menuTitle.textContent = `Sessions · ${entries.length}`;
    this.menuList.replaceChildren();

    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tab-switcher-empty";
      empty.textContent = "No session matches that filter.";
      this.menuList.append(empty);
      return;
    }

    for (const entry of matches) {
      const condensed = this.hiddenKeys.has(entry.key);
      const row = document.createElement("div");
      row.className = "tab-switcher-row";
      row.classList.toggle("active", entry.active);
      row.classList.toggle("condensed", condensed);

      const open = document.createElement("button");
      open.type = "button";
      open.className = "tab-switcher-open";

      const dot = document.createElement("span");
      dot.className = "tab-switcher-dot";
      if (entry.busy || entry.awaiting) {
        dot.classList.add(entry.awaiting ? "awaiting" : "busy");
        if (entry.glow) dot.style.background = entry.glow;
      }

      const text = document.createElement("span");
      text.className = "tab-switcher-text";
      const name = document.createElement("span");
      name.className = "tab-switcher-name";
      name.textContent = entry.label;
      const path = document.createElement("span");
      path.className = "tab-switcher-path";
      path.textContent = entry.cwd;
      text.append(name, path);
      open.append(dot, text);

      if (condensed) {
        const badge = document.createElement("span");
        badge.className = "tab-switcher-badge";
        badge.textContent = "hidden";
        open.append(badge);
      }
      open.addEventListener("click", () => {
        this.closeMenu();
        this.opts.onActivate(entry.key);
      });

      const close = document.createElement("button");
      close.type = "button";
      close.className = "tab-switcher-close";
      close.textContent = "\u00d7";
      close.title = `Close ${entry.label}`;
      close.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.opts.onClose(entry.key);
      });

      row.append(open, close);
      this.menuList.append(row);
    }
  }
}
