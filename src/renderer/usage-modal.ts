import type { ProviderUsageReport } from "../shared/ipc";
import type { ContextUsageSnapshot } from "../shared/transcript";
import { attachButtonSpring, popoverMotion } from "./motion-utils";
import { animateUsageReveal, renderContextCard, renderUsageCards, renderUsageSkeleton } from "./usage-render";
import type { UsageModalOrder } from "../shared/usage-tracker";
import { attachUsageDrag } from "./usage-drag";

const REFRESH_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3.15-6.85"/><polyline points="21 3 21 9 15 9"/></svg>';
export class UsageModal {
  readonly el: HTMLDivElement;
  private reports: ProviderUsageReport[] = [];
  private onOpenStatsCallback: () => void;
  private readonly refreshReports: () => Promise<ProviderUsageReport[]>;
  private loading = false;
  private hasLoaded = false;
  private refreshBtn!: HTMLButtonElement;
  private closeBtn!: HTMLButtonElement;
  private body!: HTMLDivElement;
  private footer!: HTMLElement;

  private contextUsage: ContextUsageSnapshot | null | undefined = null;
  private isContextOnly = false;
  private isReordering = false;
  private backdrop: HTMLDivElement | null = null;
  private dockContextStyle: string = "badge";

  constructor(
    onOpenStats: () => void,
    refreshReports: () => Promise<ProviderUsageReport[]>,
    private readonly getProviderIconUrls: () => Record<string, string> = () => ({}),
    private readonly onRunSlash: (cmd: string) => void = () => {},
    private readonly onRefreshContext: () => void = () => {},
    private readonly getOrder: () => UsageModalOrder | undefined = () => undefined,
    private readonly onOrderChange: (order: UsageModalOrder) => void = () => {},
  ) {
    this.onOpenStatsCallback = onOpenStats;
    this.refreshReports = refreshReports;
    this.el = document.createElement("div");
    this.el.id = "usage-popover";
    this.el.className = "usage-popover";
    this.el.hidden = true;
    this.buildChrome();
    attachUsageDrag(this.body, {
      isActive: () => this.isReordering,
      getOrder: this.getOrder,
      onChange: this.onOrderChange,
    });
    this.paintBody({ entrance: false });
    document.body.appendChild(this.el);
    document.addEventListener("mousedown", (ev) => {
      const target = ev.target as Node;
      if (!this.el.hidden && !this.el.contains(target) && !(target instanceof Element && target.closest(".usage-reorder-backdrop"))) {
        const usageBtn = document.getElementById("dock-usage-btn");
        const contextBtn = document.getElementById("dock-context-btn");
        const headerUsage = document.getElementById("header-usage");
        if (
          (usageBtn && usageBtn.contains(ev.target as Node)) ||
          (contextBtn && contextBtn.contains(ev.target as Node)) ||
          (headerUsage && headerUsage.contains(ev.target as Node))
        ) {
          return;
        }
        this.close();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (this.el.hidden || ev.key !== "Escape") return;
      if (this.isReordering) this.setReordering(false);
      else this.close();
    });

    window.addEventListener("resize", () => {
      if (!this.isOpen) return;
      if (this.el.classList.contains("usage-expanded")) this.centerExpanded();
      else this.position();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      void this.open();
    }
  }

  async open(): Promise<void> {
    this.position();
    requestAnimationFrame(() => this.position());
    popoverMotion.animatePopoverOpen(this.el);
    // Context-only data comes from transcript snapshots; no provider refresh needed.
    if (this.isContextOnly || this.hasLoaded) {
      this.paintBody({ entrance: true });
    } else {
      await this.refresh();
    }
    requestAnimationFrame(() => this.position());
  }

  private position(anchorEl?: HTMLElement | null): void {
    const dockContext = document.getElementById("dock-context-btn");
    const dockBtn = document.getElementById("dock-usage-btn");
    const headerBtn = document.getElementById("header-usage");
    const anchor = anchorEl ?? (
      (this.isContextOnly && dockContext && dockContext.offsetParent !== null)
        ? dockContext
        : (dockBtn && dockBtn.offsetParent !== null) ? dockBtn : headerBtn
    );
    if (!anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    const menuW = this.el.offsetWidth || 380;
    const menuH = this.el.offsetHeight || 380;

    let left = anchorRect.left + (anchorRect.width - menuW) / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));

    let top: number;
    if (anchorRect.top < window.innerHeight / 2) {
      top = anchorRect.bottom + 10;
    } else {
      top = anchorRect.top - menuH - 10;
      if (top < 8) top = Math.min(anchorRect.bottom + 10, window.innerHeight - menuH - 8);
    }

    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  setContextUsage(snapshot: ContextUsageSnapshot | null | undefined): void {
    this.contextUsage = snapshot;
    if (this.isOpen && !this.loading) {
      this.paintBody({ entrance: false });
    }
  }


  setContextOnly(contextOnly: boolean): void {
    this.isContextOnly = contextOnly;
    this.endReorderInstant();
    this.el.classList.toggle("context-window", contextOnly);
    const title = this.el.querySelector(".usage-header h2");
    if (title) {
      title.textContent = contextOnly ? "Context Window" : "Usage & Quotas";
    }
    // Context data comes from transcript snapshots, not refreshReports.
    this.refreshBtn.style.display = contextOnly ? "none" : "";
    if (this.isOpen && !this.loading) {
      this.paintBody({ entrance: false });
    } else {
      this.paintFooter();
    }
  }

  setDockContextStyle(style: string): void {
    this.dockContextStyle = style;
    if (this.isOpen && !this.loading) {
      this.paintBody({ entrance: false });
    }
  }

  updateReports(reports: ProviderUsageReport[]): void {
    this.reports = reports;
    this.hasLoaded = true;
    if (this.isOpen && !this.loading) {
      this.paintBody({ entrance: false });
    }
  }

  async refresh(): Promise<void> {
    this.loading = true;
    // Hidden in context-only mode (transcript snapshots, not provider reports).
    if (!this.isContextOnly) this.refreshBtn.disabled = true;
    this.el.classList.add("loading");
    this.paintBody({ entrance: false });
    try {
      this.reports = await this.refreshReports();
      this.hasLoaded = true;
    } catch {
      // Keep last reports; the tracker retries independently.
    } finally {
      this.loading = false;
      this.refreshBtn.disabled = false;
      this.el.classList.remove("loading");
      this.paintBody({ entrance: true });
    }
  }

  close(): void {
    this.endReorderInstant();
    if (this.el.hidden) return;
    popoverMotion.animatePopoverClose(this.el, () => {
      this.el.hidden = true;
    });
  }

  private buildChrome(): void {
    const header = document.createElement("header");
    header.className = "usage-header";

    const title = document.createElement("h2");
    title.textContent = "Provider Quotas";

    const actions = document.createElement("div");
    actions.className = "usage-header-actions";

    this.refreshBtn = document.createElement("button");
    this.refreshBtn.type = "button";
    this.refreshBtn.className = "usage-icon-btn";
    this.refreshBtn.title = "Refresh provider quotas (omp usage)";
    this.refreshBtn.setAttribute("aria-label", "Refresh provider quotas (omp usage)");
    this.refreshBtn.innerHTML = REFRESH_ICON;
    this.refreshBtn.addEventListener("click", () => void this.refresh());

    this.closeBtn = document.createElement("button");
    this.closeBtn.type = "button";
    this.closeBtn.className = "usage-close";
    this.closeBtn.textContent = "×";
    this.closeBtn.title = "Close";
    this.closeBtn.addEventListener("click", () => this.close());

    actions.append(this.refreshBtn, this.closeBtn);
    header.append(title, actions);

    this.body = document.createElement("div");
    this.body.className = "usage-body";

    this.footer = document.createElement("footer");
    this.footer.className = "usage-footer";
    this.el.append(header, this.body, this.footer);
    this.paintFooter();

    for (const btn of [this.refreshBtn, this.closeBtn]) {
      attachButtonSpring(btn);
    }
  }

  private paintFooter(): void {
    this.footer.replaceChildren();

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "usage-footer-btn";
    doneBtn.textContent = "Close";
    doneBtn.addEventListener("click", () => {
      if (this.isReordering) this.setReordering(false);
      else this.close();
    });

    if (this.isContextOnly) {
      const left = document.createElement("div");
      left.className = "usage-footer-left";

      const compactBtn = document.createElement("button");
      compactBtn.type = "button";
      compactBtn.className = "usage-footer-btn";
      compactBtn.textContent = "Run /compact";
      compactBtn.title = "Run /compact in the active session";
      compactBtn.addEventListener("click", () => {
        this.close();
        this.onRunSlash("/compact");
      });

      const refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.className = "usage-footer-btn";
      refreshBtn.textContent = "Refresh";
      refreshBtn.title = "Refresh context usage from this session's saved transcript";
      refreshBtn.addEventListener("click", () => this.onRefreshContext());

      left.append(refreshBtn, compactBtn);
      this.footer.append(left, doneBtn);
      for (const btn of [refreshBtn, compactBtn, doneBtn]) {
        attachButtonSpring(btn);
      }
      return;
    }

    const statsBtn = document.createElement("button");
    statsBtn.type = "button";
    statsBtn.className = "usage-footer-btn accent";
    statsBtn.textContent = "Run /stats";
    statsBtn.title = "Run /stats in the active session";
    statsBtn.addEventListener("click", () => {
      this.close();
      this.onOpenStatsCallback();
    });

    const reorderBtn = document.createElement("button");
    reorderBtn.type = "button";
    reorderBtn.className = "usage-footer-btn";
    reorderBtn.classList.toggle("accent", this.isReordering);
    reorderBtn.textContent = this.isReordering ? "Done" : "Reorder";
    reorderBtn.title = this.isReordering
      ? "Finish reordering"
      : "Reorder providers, accounts, and quota cards by dragging";
    reorderBtn.addEventListener("click", () => this.setReordering(!this.isReordering));

    const left = document.createElement("div");
    left.className = "usage-footer-left";
    left.append(statsBtn, reorderBtn);
    this.footer.append(left, doneBtn);
    for (const btn of [statsBtn, reorderBtn, doneBtn]) {
      attachButtonSpring(btn);
    }
  }

  private centerExpanded(): void {
    const el = this.el;
    el.style.left = `${Math.round((window.innerWidth - el.offsetWidth) / 2)}px`;
    el.style.top = `${Math.round((window.innerHeight - el.offsetHeight) / 2)}px`;
  }

  /** Expands the popover itself to the screen center (and back), animating its box so the card grid reflows live. */
  private setReordering(on: boolean): void {
    if (on === this.isReordering) return;
    this.isReordering = on;
    const el = this.el;
    const first = el.getBoundingClientRect();
    const apply = (expanded: boolean) => {
      el.classList.toggle("usage-expanded", expanded);
      if (expanded) this.centerExpanded();
      else this.position();
    };
    this.body.classList.toggle("usage-reordering", on);
    this.paintFooter();

    apply(on);
    const last = el.getBoundingClientRect();
    if (!on) apply(true); // stay expanded (same layout) until the shrink finishes

    const backdrop = this.backdrop ?? this.createBackdrop();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const box = (r: DOMRect) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const done = () => {
      if (on) return;
      apply(false);
      backdrop.remove();
      this.backdrop = null;
    };
    if (reduced) {
      done();
      return;
    }
    backdrop.animate([{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], { duration: 320, easing: "ease-out", fill: "both" });
    const anim = el.animate([box(first), box(last)], { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    anim.onfinish = done;
    anim.oncancel = done;
  }

  private createBackdrop(): HTMLDivElement {
    const backdrop = document.createElement("div");
    backdrop.className = "usage-reorder-backdrop";
    backdrop.addEventListener("mousedown", () => this.setReordering(false));
    document.body.insertBefore(backdrop, this.el);
    this.backdrop = backdrop;
    return backdrop;
  }

  /** Drops reorder mode without animation (popover is closing or changing mode). */
  private endReorderInstant(): void {
    this.isReordering = false;
    this.el.classList.remove("usage-expanded");
    this.body.classList.remove("usage-reordering");
    this.backdrop?.remove();
    this.backdrop = null;
  }

  private paintBody(opts: { entrance: boolean }): void {
    this.paintFooter();
    this.body.replaceChildren();
    if (this.loading) {
      renderUsageSkeleton(this.body);
      return;
    }

    if (this.isContextOnly) {
      renderContextCard(this.body, this.contextUsage);
    } else {
      // Combined view: Render Context card if selected as "combined" or if context usage exists
      if (this.dockContextStyle === "combined" || this.contextUsage) {
        renderContextCard(this.body, this.contextUsage);
      }
      renderUsageCards(this.body, this.reports, this.getProviderIconUrls(), { order: this.getOrder() });
    }

    if (opts.entrance) animateUsageReveal(this.body);
  }
}
