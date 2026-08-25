import type { ProviderUsageReport } from "../shared/ipc";
import { renderUsageCards } from "./usage-render";

export class UsageModal {
  readonly el: HTMLDivElement;
  private reports: ProviderUsageReport[] = [];
  private onOpenStatsCallback: () => void;
  private loading = false;
  private hasLoaded = false;

  constructor(onOpenStats: () => void) {
    this.onOpenStatsCallback = onOpenStats;

    this.el = document.createElement("div");
    this.el.id = "usage-popover";
    this.el.className = "usage-popover";
    this.el.hidden = true;
    this.render();

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
    this.el.hidden = false;
    if (!this.hasLoaded) {
      await this.refresh();
    } else {
      this.render();
    }
  }

  updateReports(reports: ProviderUsageReport[]): void {
    this.reports = reports;
    this.hasLoaded = true;
    if (this.isOpen) {
      this.render();
    }
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.render();
    try {
      this.reports = await window.omphif.getProviderUsage();
      this.hasLoaded = true;
    } catch {
      this.reports = [];
    } finally {
      this.loading = false;
      this.render();
    }
  }

  close(): void {
    this.el.hidden = true;
  }

  private render(): void {
    this.el.replaceChildren();

    const header = document.createElement("header");
    header.className = "usage-header";

    const title = document.createElement("h2");
    title.textContent = "Provider Quotas";

    const actions = document.createElement("div");
    actions.className = "usage-header-actions";

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "model-btn-pill";
    refreshBtn.title = "Refresh provider quotas (omp usage)";
    refreshBtn.textContent = "\u21bb Refresh";
    refreshBtn.addEventListener("click", () => void this.refresh());

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "model-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", () => this.close());

    actions.append(refreshBtn, closeBtn);
    header.append(title, actions);

    const body = document.createElement("div");
    body.className = "usage-body";

    if (this.loading) {
      const loadingBox = document.createElement("div");
      loadingBox.className = "usage-loading-box";
      const spinner = document.createElement("span");
      spinner.className = "usage-spinner";
      const text = document.createElement("span");
      text.textContent = "Querying live provider quotas...";
      loadingBox.append(spinner, text);
      body.appendChild(loadingBox);
    } else {
      renderUsageCards(body, this.reports);
    }

    const footer = document.createElement("footer");
    footer.className = "usage-footer";

    const terminalBtn = document.createElement("button");
    terminalBtn.type = "button";
    terminalBtn.className = "model-btn-pill accent";
    terminalBtn.textContent = "Run /stats";
    terminalBtn.title = "Run /stats in the active session";
    terminalBtn.addEventListener("click", () => {
      this.close();
      this.onOpenStatsCallback();
    });

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "model-btn-pill";
    doneBtn.textContent = "Close";
    doneBtn.addEventListener("click", () => this.close());

    footer.append(terminalBtn, doneBtn);

    this.el.append(header, body, footer);
  }
}
