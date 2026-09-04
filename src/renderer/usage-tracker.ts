import type { ProviderLimit, ProviderUsageReport } from "../shared/ipc";
import {
  type UsageTrackerQuota,
  type UsageTrackerSettings,
  usageTrackerDelay,
  usageTrackerQuotaKey,
} from "../shared/usage-tracker";
import { getProviderIcon } from "./provider-icons";
import { attachButtonSpring } from "./motion-utils";

export type UsageTrackerStatus = {
  loading: boolean;
  lastUpdatedAt?: number;
  error?: string;
};

type UsageTrackerOptions = {
  getProviderUsage: () => Promise<ProviderUsageReport[]>;
  settings: UsageTrackerSettings;
  onReports: (reports: ProviderUsageReport[]) => void;
  onRender?: () => void;
};

type MatchedQuota = {
  quota: UsageTrackerQuota;
  report: ProviderUsageReport;
  limit: ProviderLimit;
};

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Owns the single provider-usage request pipeline and compact chrome surface. */
export class UsageTracker {
  readonly el: HTMLDivElement;
  private settings: UsageTrackerSettings;
  private reports: ProviderUsageReport[] = [];
  private status: UsageTrackerStatus = { loading: false };
  private inFlight: Promise<ProviderUsageReport[]> | null = null;
  private timer: number | undefined;
  private failures = 0;
  private readonly getProviderUsage: () => Promise<ProviderUsageReport[]>;
  private readonly onReports: (reports: ProviderUsageReport[]) => void;
  private readonly onRender?: () => void;

  constructor(opts: UsageTrackerOptions) {
    this.getProviderUsage = opts.getProviderUsage;
    this.settings = opts.settings;
    this.onReports = opts.onReports;
    this.onRender = opts.onRender;
    this.el = document.createElement("div");
    this.el.id = "usage-tracker";
    this.el.hidden = true;
    this.render();
    this.reschedule(true);
  }

  get currentReports(): readonly ProviderUsageReport[] {
    return this.reports;
  }

  get currentStatus(): Readonly<UsageTrackerStatus> {
    return this.status;
  }

  updateSettings(settings: UsageTrackerSettings): void {
    const scheduleChanged =
      this.settings.enabled !== settings.enabled ||
      this.settings.refreshIntervalMs !== settings.refreshIntervalMs;
    this.settings = settings;
    this.render();
    if (scheduleChanged) this.reschedule(true);
  }

  refresh(): Promise<ProviderUsageReport[]> {
    if (this.inFlight) return this.inFlight;
    this.status = { ...this.status, loading: true, error: undefined };
    this.render();
    this.inFlight = this.getProviderUsage()
      .then((reports) => {
        this.reports = reports;
        this.failures = 0;
        this.status = { loading: false, lastUpdatedAt: Date.now() };
        this.onReports(reports);
        return reports;
      })
      .catch((error: unknown) => {
        this.failures += 1;
        this.status = {
          ...this.status,
          loading: false,
          error: error instanceof Error && error.message ? error.message : "Refresh failed",
        };
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
        this.render();
        this.reschedule(false);
      });
    return this.inFlight;
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private reschedule(refreshNow: boolean): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.settings.enabled) return;
    if (refreshNow && !this.inFlight) {
      void this.refresh().catch(() => undefined);
      return;
    }
    if (this.settings.refreshIntervalMs === null || this.inFlight) return;
    const delay = usageTrackerDelay(this.settings.refreshIntervalMs, this.failures);
    this.timer = window.setTimeout(() => void this.refresh().catch(() => undefined), delay);
  }

  private matchingQuotas(): MatchedQuota[] {
    const limits = new Map<string, { report: ProviderUsageReport; limit: ProviderLimit }>();
    for (const report of this.reports) {
      for (const limit of report.limits) {
        limits.set(
          usageTrackerQuotaKey({ provider: report.provider, account: report.account, label: limit.label }),
          { report, limit },
        );
      }
    }
    return this.settings.quotas.flatMap((quota) => {
      const matched = limits.get(usageTrackerQuotaKey(quota));
      return quota.enabled && matched ? [{ quota, ...matched }] : [];
    });
  }

  private renderIcon(provider: string): HTMLElement {
    const override = this.settings.providerIconUrls[provider];
    if (override) {
      const image = document.createElement("img");
      image.className = "usage-tracker-icon";
      image.src = override;
      image.alt = "";
      image.addEventListener("error", () => {
        image.replaceWith(this.renderFallbackIcon(provider));
      }, { once: true });
      return image;
    }
    return this.renderFallbackIcon(provider);
  }

  private renderFallbackIcon(provider: string): HTMLSpanElement {
    const icon = document.createElement("span");
    icon.className = "usage-tracker-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = getProviderIcon(provider);
    return icon;
  }

  private renderGauge(entry: MatchedQuota): HTMLElement {
    const usedPercent = clampPercent(entry.limit.usedPercent);
    const tier = usedPercent >= 80 ? "high" : usedPercent >= 50 ? "med" : "low";
    const gauge = document.createElement("span");
    gauge.style.setProperty("--usage-fill", `${usedPercent}%`);
    gauge.style.setProperty("--usage-remaining-fill", `${100 - usedPercent}%`);
    gauge.style.setProperty("--usage-ring-offset", String(94.25 * (1 - usedPercent / 100)));
    gauge.className = `usage-tracker-gauge usage-tracker-${entry.quota.style} ${tier}`;
    if (entry.quota.style === "circle") {
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      ring.setAttribute("class", "usage-tracker-ring");
      ring.setAttribute("viewBox", "0 0 36 36");
      ring.innerHTML = '<circle class="usage-tracker-ring-track" cx="18" cy="18" r="15" /><circle class="usage-tracker-ring-progress" cx="18" cy="18" r="15" />';
      gauge.append(ring);
    } else {
      const fill = document.createElement("span");
      fill.className = "usage-tracker-fill";
      gauge.append(fill);
    }
    if (this.settings.iconPlacement === "inside") {
      gauge.append(this.renderIcon(entry.report.provider));
    }
    return gauge;
  }

  render(): void {
    this.el.replaceChildren();
    this.el.classList.toggle("loading", this.status.loading);
    const entries = this.matchingQuotas();
    const visible = this.settings.enabled && entries.length > 0;
    this.el.hidden = !visible;
    if (!visible) {
      this.el.classList.remove("vertical");
      this.onRender?.();
      return;
    }

    const isVertical =
      this.settings.orientation === "vertical" ||
      (this.settings.orientation === "auto" &&
        typeof document !== "undefined" &&
        document.body?.getAttribute("data-tab-layout") === "stack");
    this.el.classList.toggle("vertical", isVertical);

    const items = document.createElement("div");
    items.className = "usage-tracker-items";
    for (const entry of entries) {
      const usedPercent = Math.round(clampPercent(entry.limit.usedPercent));
      const item = document.createElement("div");
      item.className = "usage-tracker-item";
      const tier = usedPercent >= 80 ? "high" : usedPercent >= 50 ? "med" : "low";
      item.classList.add(tier);
      item.style.setProperty("--usage-fill", `${usedPercent}%`);
      item.style.setProperty("--usage-remaining-fill", `${100 - usedPercent}%`);
      item.setAttribute(
        "aria-label",
        `${entry.report.providerName} ${entry.limit.label}: ${usedPercent}% used`,
      );
      item.title = `${entry.report.providerName} · ${entry.limit.label} · ${usedPercent}% used`;
      const besideIcon =
        this.settings.iconPlacement === "beside"
          ? this.renderIcon(entry.report.provider)
          : undefined;
      if (besideIcon) item.append(besideIcon);
      if (this.settings.showPercent) {
        const percent = document.createElement("span");
        percent.className = "usage-tracker-percent";
        percent.classList.add(tier);
        percent.textContent = `${usedPercent}%`;
        percent.setAttribute("aria-hidden", "true");
        item.append(percent);
      }
      item.append(this.renderGauge(entry));
      items.appendChild(item);
    }

    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "usage-tracker-refresh";
    refresh.disabled = this.status.loading;
    refresh.title = this.status.error ?? "Refresh provider quotas";
    refresh.setAttribute("aria-label", this.status.loading ? "Refreshing provider quotas" : "Refresh provider quotas");
    refresh.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3.15-6.85"/><polyline points="21 3 21 9 15 9"/></svg>';
    refresh.addEventListener("click", () => void this.refresh().catch(() => undefined));
    attachButtonSpring(refresh);

    this.el.append(items, refresh);
    this.onRender?.();
  }
}
