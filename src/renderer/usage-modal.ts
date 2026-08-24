import type { ProviderUsageReport } from "../shared/ipc";

export class UsageModal {
  readonly el: HTMLDivElement;
  private reports: ProviderUsageReport[] = [];
  private onOpenStatsCallback: () => void;

  constructor(onOpenStats: () => void) {
    this.onOpenStatsCallback = onOpenStats;

    this.el = document.createElement("div");
    this.el.id = "usage-backdrop";
    this.el.hidden = true;
    this.render();

    this.el.addEventListener("mousedown", (ev) => {
      if (ev.target === this.el) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }
  private loading = false;

  async open(): Promise<void> {
    this.loading = true;
    this.el.hidden = false;
    this.render();
    try {
      this.reports = await window.omphif.getProviderUsage();
    } catch {
      this.reports = [];
    } finally {
      this.loading = false;
      if (!this.el.hidden) this.render();
    }
  }
  close(): void {
    this.el.hidden = true;
  }

  private render(): void {
    this.el.replaceChildren();

    const dialog = document.createElement("section");
    dialog.id = "usage-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "OMP Provider Usage Quotas");

    const header = document.createElement("header");
    header.className = "usage-header";
    const title = document.createElement("h2");
    title.textContent = "Live Provider Quotas & Rate Limits (omp usage)";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "usage-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", () => this.close());
    header.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "usage-body";

    if (this.loading) {
      const loadingBox = document.createElement("div");
      loadingBox.className = "usage-loading-box";
      const spinner = document.createElement("span");
      spinner.className = "usage-spinner";
      const text = document.createElement("span");
      text.textContent = "Querying live provider quotas (omp usage)...";
      loadingBox.append(spinner, text);
      body.appendChild(loadingBox);
    } else if (this.reports.length === 0) {
      const empty = document.createElement("div");
      empty.className = "usage-empty";
      empty.textContent = "No provider quotas returned by 'omp usage'.";
      body.appendChild(empty);
    } else {
      for (const rep of this.reports) {
        if (rep.rawText) {
          const pre = document.createElement("pre");
          pre.className = "usage-raw-pre";
          pre.textContent = rep.rawText;
          body.appendChild(pre);
          continue;
        }

        const card = document.createElement("div");
        card.className = "usage-provider-card";

        const titleRow = document.createElement("div");
        titleRow.className = "usage-provider-title-row";

        const nameSpan = document.createElement("span");
        nameSpan.className = "usage-provider-name";
        nameSpan.textContent = rep.providerName;

        titleRow.appendChild(nameSpan);
        card.appendChild(titleRow);
        if (rep.limits.length === 0) {
          const noLimits = document.createElement("div");
          noLimits.className = "usage-no-limits";
          noLimits.textContent = "Active — no strict rate window or unlimited tier.";
          card.appendChild(noLimits);
        } else {
          const limitList = document.createElement("div");
          limitList.className = "usage-limit-list";

          for (const lim of rep.limits) {
            const limRow = document.createElement("div");
            limRow.className = "usage-limit-row";

            const limTop = document.createElement("div");
            limTop.className = "usage-limit-top";

            const limLabel = document.createElement("span");
            limLabel.className = "usage-limit-label";
            limLabel.textContent = lim.label;

            const limPercent = document.createElement("span");
            limPercent.className = "usage-limit-percent";
            limPercent.textContent = `${lim.usedPercent}% used`;
            if (lim.usedPercent >= 80) limPercent.classList.add("high");
            else if (lim.usedPercent >= 50) limPercent.classList.add("med");

            limTop.append(limLabel, limPercent);

            const track = document.createElement("div");
            track.className = "usage-bar-track";
            const fill = document.createElement("div");
            fill.className = "usage-bar-fill";
            fill.style.width = `${Math.min(100, Math.max(1, lim.usedPercent))}%`;
            if (lim.usedPercent >= 80) fill.classList.add("high");
            else if (lim.usedPercent >= 50) fill.classList.add("med");
            track.appendChild(fill);

            const limSub = document.createElement("div");
            limSub.className = "usage-limit-sub";

            const remSpan = document.createElement("span");
            remSpan.textContent = `${100 - lim.usedPercent}% remaining`;

            limSub.appendChild(remSpan);

            if (lim.resetsIn) {
              const resetSpan = document.createElement("span");
              resetSpan.className = "usage-reset-countdown";
              resetSpan.textContent = `\u23F1 resets in ${lim.resetsIn}`;
              limSub.appendChild(resetSpan);
            }

            limRow.append(limTop, track, limSub);
            limitList.appendChild(limRow);
          }

          card.appendChild(limitList);
        }

        body.appendChild(card);
      }
    }

    const footer = document.createElement("footer");
    footer.className = "usage-footer";

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "usage-full-stats";
    refreshBtn.textContent = "Refresh (omp usage)";
    refreshBtn.addEventListener("click", () => void this.open());

    const terminalBtn = document.createElement("button");
    terminalBtn.type = "button";
    terminalBtn.className = "usage-full-stats";
    terminalBtn.textContent = "Run /stats in Session";
    terminalBtn.addEventListener("click", () => {
      this.onOpenStatsCallback();
      this.close();
    });

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "usage-done";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => this.close());

    const leftBtns = document.createElement("div");
    leftBtns.className = "usage-footer-left";
    leftBtns.append(refreshBtn, terminalBtn);

    footer.append(leftBtns, doneBtn);

    dialog.append(header, body, footer);
    this.el.appendChild(dialog);
  }
}
