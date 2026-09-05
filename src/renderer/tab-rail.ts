import { safeAnimate, springPresets } from "./motion-utils";

/** One tab as the rail needs to see it; the owner keeps the real Tab record. */
export interface TabRailEntry {
  /** Stable identity across re-syncs (Tab.sessionNumber). */
  key: number;
  /** The tab's own button, already parented to the list. */
  element: HTMLElement;
  active: boolean;
}

export interface TabRailOptions {
  /** #tab-rail-panel — carries the `pinned-open` class. */
  panel: HTMLElement;
  /** #tab-rail-list — scroll container and indicator parent. */
  list: HTMLElement;
  entries: () => TabRailEntry[];
}

/**
 * Owns the sliding active/hover pills of the vertical session rail. It never
 * mutates tab order or tab content — the owner still renders each tab button
 * itself and simply calls sync() afterwards. The rail's width never depends on
 * tab content, so there is no overflow planning and nothing to oscillate.
 */
export class TabRail {
  private readonly indicator: HTMLDivElement;
  private readonly hoverIndicator: HTMLDivElement;
  private indicatorMounted = false;
  private hoverMounted = false;
  private hoveredTab: HTMLElement | null = null;
  private lastActiveKey: number | null = null;

  constructor(private readonly opts: TabRailOptions) {
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
    this.opts.list.prepend(this.hoverIndicator, this.indicator);

    this.opts.list.addEventListener("pointerover", (ev) => {
      const target = (ev.target as HTMLElement)?.closest(".tab") as HTMLElement | null;
      if (target && target !== this.hoveredTab) {
        this.hoveredTab = target;
        this.syncHoverIndicator();
      }
    });

    this.opts.list.addEventListener("pointerout", (ev) => {
      const related = ev.relatedTarget as Node | null;
      if (!related || !this.opts.list.contains(related)) {
        this.hoveredTab = null;
        this.syncHoverIndicator();
      } else {
        const next = (related as HTMLElement)?.closest(".tab") as HTMLElement | null;
        if (next !== this.hoveredTab) {
          this.hoveredTab = next;
          this.syncHoverIndicator();
        }
      }
    });

    // The hover expansion resizes every row through a CSS transition; re-point
    // the pills on each layout tick so they track it exactly.
    new ResizeObserver(() => this.syncIndicator(true)).observe(this.opts.list);
    window.addEventListener("resize", () => this.syncIndicator(true));
    this.opts.list.addEventListener("scroll", () => this.syncHoverIndicator(true), { passive: true });
  }

  /** Hold the rail expanded while a rename input or a tab drag is in flight. */
  setPinnedOpen(open: boolean): void {
    this.opts.panel.classList.toggle("pinned-open", open);
  }

  syncHoverIndicator(immediate = false): void {
    if (this.hoverIndicator.parentElement !== this.opts.list) {
      this.opts.list.prepend(this.hoverIndicator);
    }
    const target = this.hoveredTab;
    const active = this.opts.list.querySelector(".tab.active") as HTMLElement | null;

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
    if (this.indicator.parentElement !== this.opts.list) {
      this.opts.list.prepend(this.indicator);
    }
    const active = this.opts.list.querySelector(".tab.active") as HTMLElement | null;

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

  /** Re-point the pills; scrolls a newly-active tab into view. */
  sync(): void {
    const active = this.opts.entries().find((entry) => entry.active) ?? null;
    const activeKey = active?.key ?? null;
    // Only chase the active tab when it actually changed, so agent-driven
    // repaints never yank a scroll position the user set by hand.
    if (activeKey !== this.lastActiveKey) {
      this.lastActiveKey = activeKey;
      active?.element.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    this.syncIndicator();
  }
}
