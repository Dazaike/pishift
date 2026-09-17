import type { ProviderLimit, ProviderUsageReport } from "./ipc";

export type UsageTrackerStyle = "bar" | "circle" | "battery";
export type UsageTrackerIconPlacement = "inside" | "beside";
export type UsageTrackerOrientation = "auto" | "horizontal" | "vertical";
export type UsageTrackerQuota = {
  provider: string;
  account?: string;
  label: string;
  enabled: boolean;
  style: UsageTrackerStyle;
};

export type UsageTrackerSettings = {
  enabled: boolean;
  /** `null` means refresh only when the user asks. */
  refreshIntervalMs: number | null;
  quotas: UsageTrackerQuota[];
  providerIconUrls: Record<string, string>;
  iconPlacement: UsageTrackerIconPlacement;
  showPercent: boolean;
  orientation?: UsageTrackerOrientation;
  combineAccounts?: boolean;
  /**
   * Ceiling used when combining multi-account usage: `100` averages accounts
   * down to a flat 0-100 scale (legacy math); `200` sums each account's
   * percent and raises the ceiling by 100 per account (current default).
   */
  combineAccountsMax?: 100 | 200;
};

export const USAGE_TRACKER_REFRESH_PRESETS = [
  10_000,
  30_000,
  60_000,
  120_000,
  180_000,
  300_000,
  600_000,
] as const;

export const MIN_USAGE_TRACKER_REFRESH_MS = 10_000;
export const MAX_USAGE_TRACKER_RETRY_MS = 600_000;

export const DEFAULT_USAGE_TRACKER_SETTINGS: UsageTrackerSettings = {
  enabled: false,
  refreshIntervalMs: 60_000,
  quotas: [],
  providerIconUrls: {},
  iconPlacement: "inside",
  showPercent: false,
  orientation: "auto",
  combineAccounts: false,
  combineAccountsMax: 200,
};

export type SettingsSectionId =
  | "appearance"
  | "composer"
  | "usage-tracker"
  | "interface"
  | "backup";

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  "appearance",
  "composer",
  "usage-tracker",
  "interface",
  "backup",
];

export const DEFAULT_SETTINGS_SECTION_COLLAPSED: Record<SettingsSectionId, boolean> = {
  appearance: false,
  composer: false,
  "usage-tracker": false,
  interface: false,
  backup: false,
};

export function usageTrackerQuotaKey(quota: Pick<UsageTrackerQuota, "provider" | "account" | "label">): string {
  return `${quota.provider}\u0000${quota.account ?? ""}\u0000${quota.label}`;
}

/**
 * Format limit labels to disambiguate identical labels (e.g. Google Antigravity's
 * multiple "Usage (Google)" quotas for 5-hour vs weekly windows).
 * Appends window label in parentheses if not already present in the label.
 */
export function formatLimitLabel(label: string, windowLabel?: string): string {
  const cleanLabel = (label || "").trim();
  const cleanWindow = (windowLabel || "").trim();
  if (!cleanWindow) return cleanLabel;
  if (cleanLabel.toLowerCase().includes(cleanWindow.toLowerCase())) {
    return cleanLabel;
  }
  return `${cleanLabel} (${cleanWindow})`;
}

/**
 * Builds combined provider reports when `combineAccounts` is active or for
 * providers that have multiple accounts.
 * For providers with multiple reports/accounts, limits sharing the same label
 * are aggregated. When `max` is `200` (default, matches current behavior),
 * `usedPercent` is summed across accounts and `maxPercent` raised to `100 *
 * accountCount` — two accounts at 100% and 30% combine to 130% used out of
 * 200%. When `max` is `100` (legacy math), `usedPercent` is instead averaged
 * across accounts and `maxPercent` stays flat at 100 — the same two accounts
 * combine to 65% used out of 100%.
 */
export function buildCombinedReports(
  reports: readonly ProviderUsageReport[],
  max: 100 | 200 = 200,
): ProviderUsageReport[] {
  const providerGroups = new Map<string, ProviderUsageReport[]>();
  for (const rep of reports) {
    const list = providerGroups.get(rep.provider) ?? [];
    list.push(rep);
    providerGroups.set(rep.provider, list);
  }

  const result: ProviderUsageReport[] = [];

  for (const [provider, reps] of providerGroups) {
    if (reps.length <= 1) {
      result.push(...reps);
      continue;
    }

    // Multiple accounts for this provider -> synthesize a combined report
    const first = reps[0]!;
    const accountCount = reps.length;
    const accounts = reps.map((r) => r.account ?? r.email).filter(Boolean);
    const accountSummary = `${accountCount} accounts${accounts.length > 0 ? ` (${accounts.join(", ")})` : ""}`;

    // Group limits by label
    const limitMap = new Map<string, ProviderLimit[]>();
    for (const rep of reps) {
      for (const lim of rep.limits) {
        const list = limitMap.get(lim.label) ?? [];
        list.push(lim);
        limitMap.set(lim.label, list);
      }
    }

    const combinedLimits: ProviderLimit[] = [];
    for (const [label, limits] of limitMap) {
      const totalUsedPercent = limits.reduce((sum, l) => sum + l.usedPercent, 0);
      const totalUsed = limits.reduce((sum, l) => sum + l.used, 0);
      const totalLimit = limits.reduce((sum, l) => sum + l.limit, 0);
      const totalRemaining = limits.reduce((sum, l) => sum + l.remaining, 0);
      const resetsIn = limits.find((l) => l.resetsIn)?.resetsIn;

      combinedLimits.push({
        label,
        usedPercent: max === 100 ? Math.round(totalUsedPercent / limits.length) : totalUsedPercent,
        maxPercent: max === 100 ? 100 : 100 * limits.length,
        used: totalUsed,
        limit: totalLimit,
        remaining: totalRemaining,
        unit: limits[0]?.unit ?? "percent",
        resetsIn,
      });
    }

    result.push({
      provider,
      providerName: first.providerName,
      status: first.status,
      account: accountSummary,
      limits: combinedLimits,
    });
  }

  return result;
}

/**
 * Scales `usedPercent` against `maxPercent` (default 100) into a 0-100 fill
 * fraction, for gauges/bars/tier coloring. Combined accounts raise
 * `maxPercent` above 100, so a raw `usedPercent` of 130 out of 200 renders as
 * a 65% full bar rather than clipping to a maxed-out 100%.
 */
export function usagePercentOfMax(limit: Pick<ProviderLimit, "usedPercent" | "maxPercent">): number {
  const max = limit.maxPercent ?? 100;
  if (!Number.isFinite(max) || max <= 0) return 0;
  const value = Number.isFinite(limit.usedPercent) ? limit.usedPercent : 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export function isUsageTrackerStyle(value: unknown): value is UsageTrackerStyle {
  return value === "bar" || value === "circle" || value === "battery";
}

function normalizeQuota(value: unknown): UsageTrackerQuota | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Partial<UsageTrackerQuota>;
  if (
    typeof candidate.provider !== "string" ||
    !candidate.provider ||
    typeof candidate.label !== "string" ||
    !candidate.label ||
    typeof candidate.enabled !== "boolean" ||
    !isUsageTrackerStyle(candidate.style) ||
    (candidate.account !== undefined && typeof candidate.account !== "string")
  ) {
    return undefined;
  }
  return {
    provider: candidate.provider,
    ...(candidate.account ? { account: candidate.account } : {}),
    label: candidate.label,
    enabled: candidate.enabled,
    style: candidate.style,
  };
}

export function normalizeUsageTrackerSettings(value: unknown): UsageTrackerSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_USAGE_TRACKER_SETTINGS, quotas: [], providerIconUrls: {} };
  }
  const candidate = value as Partial<UsageTrackerSettings>;
  const quotas: UsageTrackerQuota[] = [];
  const seen = new Set<string>();
  if (Array.isArray(candidate.quotas)) {
    for (const rawQuota of candidate.quotas) {
      const quota = normalizeQuota(rawQuota);
      if (!quota) continue;
      const key = usageTrackerQuotaKey(quota);
      if (seen.has(key)) continue;
      seen.add(key);
      quotas.push(quota);
    }
  }

  const providerIconUrls: Record<string, string> = {};
  if (typeof candidate.providerIconUrls === "object" && candidate.providerIconUrls !== null && !Array.isArray(candidate.providerIconUrls)) {
    for (const [provider, url] of Object.entries(candidate.providerIconUrls)) {
      if (provider && typeof url === "string" && url.trim()) providerIconUrls[provider] = url;
    }
  }

  const refreshIntervalMs =
    candidate.refreshIntervalMs === null
      ? null
      : typeof candidate.refreshIntervalMs === "number" && Number.isFinite(candidate.refreshIntervalMs)
        ? Math.max(MIN_USAGE_TRACKER_REFRESH_MS, Math.round(candidate.refreshIntervalMs))
        : DEFAULT_USAGE_TRACKER_SETTINGS.refreshIntervalMs;

  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : DEFAULT_USAGE_TRACKER_SETTINGS.enabled,
    refreshIntervalMs,
    quotas,
    providerIconUrls,
    iconPlacement:
      candidate.iconPlacement === "beside" ? "beside" : DEFAULT_USAGE_TRACKER_SETTINGS.iconPlacement,
    showPercent:
      typeof candidate.showPercent === "boolean"
        ? candidate.showPercent
        : DEFAULT_USAGE_TRACKER_SETTINGS.showPercent,
    orientation:
      candidate.orientation === "horizontal" || candidate.orientation === "vertical"
        ? candidate.orientation
        : DEFAULT_USAGE_TRACKER_SETTINGS.orientation,
    combineAccounts:
      typeof candidate.combineAccounts === "boolean"
        ? candidate.combineAccounts
        : DEFAULT_USAGE_TRACKER_SETTINGS.combineAccounts,
    combineAccountsMax:
      candidate.combineAccountsMax === 100 || candidate.combineAccountsMax === 200
        ? candidate.combineAccountsMax
        : DEFAULT_USAGE_TRACKER_SETTINGS.combineAccountsMax,
  };
}

export function normalizeSettingsSectionCollapsed(value: unknown): Partial<Record<SettingsSectionId, boolean>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const candidate = value as Partial<Record<SettingsSectionId, unknown>>;
  const result: Partial<Record<SettingsSectionId, boolean>> = {};
  for (const section of SETTINGS_SECTION_IDS) {
    if (typeof candidate[section] === "boolean") result[section] = candidate[section];
  }
  return result;
}

/** Next automatic retry delay after a request settles. */
export function usageTrackerDelay(intervalMs: number, failures: number): number {
  const base = Math.max(MIN_USAGE_TRACKER_REFRESH_MS, intervalMs);
  return Math.min(MAX_USAGE_TRACKER_RETRY_MS, base * 2 ** Math.max(0, failures));
}
