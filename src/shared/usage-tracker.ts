export type UsageTrackerStyle = "bar" | "circle" | "battery";
export type UsageTrackerIconPlacement = "inside" | "beside";

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
};

export type SettingsSectionId =
  | "appearance"
  | "composer"
  | "usage-tracker"
  | "interface";

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  "appearance",
  "composer",
  "usage-tracker",
  "interface",
];

export const DEFAULT_SETTINGS_SECTION_COLLAPSED: Record<SettingsSectionId, boolean> = {
  appearance: false,
  composer: false,
  "usage-tracker": false,
  interface: false,
};

export function usageTrackerQuotaKey(quota: Pick<UsageTrackerQuota, "provider" | "account" | "label">): string {
  return `${quota.provider}\u0000${quota.account ?? ""}\u0000${quota.label}`;
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
