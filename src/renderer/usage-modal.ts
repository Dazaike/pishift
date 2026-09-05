import type { ProviderUsageReport } from "../shared/ipc";
import { attachButtonSpring, popoverMotion } from "./motion-utils";
import { animateUsageReveal, renderUsageCards, renderUsageSkeleton } from "./usage-render";

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
  private body!: HTMLDivElement;

  constructor(onOpenStats: () => void, refreshReports: () => Promise<ProviderUsageReport[]>) {
    this.onOpenStatsCallback = onOpenStats;
    this.refreshReports = refreshReports;

    this.el = document.createElement("div");
    this.el.id = "usage-popover";
    this.el.className = "usage-popover";
    this.el.hidden = true;
    this.buildChrome();
    this.paintBody({ entrance: false });

    document.addEventListener("mousedown", (ev) => {
      if (!this.el.hidden && !this.el.contains(ev.target as Node)) {
        const usageBtn = document.getElementById("dock-usage-btn");
        const headerUsage = document.getElementById("header-usage");
        if (
          (usageBtn && usageBtn.contains(ev.target as Node)) ||
          (headerUsage && headerUsage.contains(ev.target as Node))
        ) {
          return;
        }
        this.close();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (!this.el.hidden && ev.key === "Escape") this.close();
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
    popoverMotion.animatePopoverOpen(this.el);
    if (!this.hasLoaded) {
      await this.refresh();
    } else {
      this.paintBody({ entrance: true });
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
    this.refreshBtn.disabled = true;
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

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "usage-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", () => this.close());

    actions.append(this.refreshBtn, closeBtn);
    header.append(title, actions);

    this.body = document.createElement("div");
    this.body.className = "usage-body";

    const footer = document.createElement("footer");
    footer.className = "usage-footer";

    const statsBtn = document.createElement("button");
    statsBtn.type = "button";
    statsBtn.className = "usage-footer-btn accent";
    statsBtn.textContent = "Run /stats";
    statsBtn.title = "Run /stats in the active session";
    statsBtn.addEventListener("click", () => {
      this.close();
      this.onOpenStatsCallback();
    });

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "usage-footer-btn";
    doneBtn.textContent = "Close";
    doneBtn.addEventListener("click", () => this.close());

    footer.append(statsBtn, doneBtn);
    this.el.append(header, this.body, footer);

    for (const btn of [this.refreshBtn, closeBtn, statsBtn, doneBtn]) {
      attachButtonSpring(btn);
    }
  }

  private paintBody(opts: { entrance: boolean }): void {
    this.body.replaceChildren();
    if (this.loading) {
      renderUsageSkeleton(this.body);
      return;
    }
    renderUsageCards(this.body, this.reports);
    if (opts.entrance) animateUsageReveal(this.body);
  }
}
