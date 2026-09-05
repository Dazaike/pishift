import { afterEach, beforeEach, vi } from "vitest";
import { UsageTracker } from "../src/renderer/usage-tracker";
import { describe, expect, it } from "vitest";

import type { ProviderUsageReport } from "../src/shared/ipc";
import {
  DEFAULT_USAGE_TRACKER_SETTINGS,
  MIN_USAGE_TRACKER_REFRESH_MS,
  normalizeSettingsSectionCollapsed,
  normalizeUsageTrackerSettings,
  usageTrackerDelay,
  usageTrackerQuotaKey,
} from "../src/shared/usage-tracker";

describe("usage tracker settings", () => {
  it("keys equal labels separately for different accounts", () => {
    expect(usageTrackerQuotaKey({ provider: "openai", account: "one", label: "Weekly" }))
      .not.toBe(usageTrackerQuotaKey({ provider: "openai", account: "two", label: "Weekly" }));
  });

  it("normalizes malformed values, duplicate quotas, and custom intervals", () => {
    const normalized = normalizeUsageTrackerSettings({
      enabled: true,
      refreshIntervalMs: 1,
      quotas: [
        { provider: "openai", label: "Weekly", enabled: true, style: "circle" },
        { provider: "openai", label: "Weekly", enabled: false, style: "battery" },
        { provider: "", label: "Broken", enabled: true, style: "bar" },
      ],
      providerIconUrls: { openai: "https://example.test/icon.png", broken: 42 },
      iconPlacement: "beside",
      showPercent: true,
    });

    expect(normalized.refreshIntervalMs).toBe(MIN_USAGE_TRACKER_REFRESH_MS);
    expect(normalized.quotas).toEqual([
      { provider: "openai", label: "Weekly", enabled: true, style: "circle" },
    ]);
    expect(normalized.iconPlacement).toBe("beside");
    expect(normalized.showPercent).toBe(true);
    expect(normalized.providerIconUrls).toEqual({ openai: "https://example.test/icon.png" });
  });

  it("uses legacy defaults and retains manual mode", () => {
    expect(normalizeUsageTrackerSettings(undefined)).toEqual(DEFAULT_USAGE_TRACKER_SETTINGS);
    expect(normalizeUsageTrackerSettings({ refreshIntervalMs: null }).refreshIntervalMs).toBeNull();
  });

  it("bounds failure retry delays", () => {
    expect(usageTrackerDelay(10_000, 0)).toBe(10_000);
    expect(usageTrackerDelay(10_000, 2)).toBe(40_000);
    expect(usageTrackerDelay(10_000, 100)).toBe(600_000);
  });
  it("normalizes orientation setting", () => {
    expect(normalizeUsageTrackerSettings({ orientation: "vertical" }).orientation).toBe("vertical");
    expect(normalizeUsageTrackerSettings({ orientation: "horizontal" }).orientation).toBe("horizontal");
    expect(normalizeUsageTrackerSettings({ orientation: "auto" }).orientation).toBe("auto");
    expect(normalizeUsageTrackerSettings({ orientation: "invalid" as unknown as "auto" }).orientation).toBe("auto");
    expect(normalizeUsageTrackerSettings({}).orientation).toBe("auto");
  });
});

describe("settings accordion state", () => {
  it("keeps recognized boolean groups only", () => {
    expect(normalizeSettingsSectionCollapsed({
      appearance: true,
      composer: false,
      "usage-tracker": true,
      interface: true,
      unknown: true,
    })).toEqual({
      appearance: true,
      composer: false,
      "usage-tracker": true,
      interface: true,
    });
    expect(normalizeSettingsSectionCollapsed({ appearance: "yes" })).toEqual({});
  });
});

function createMockElement(tag: string) {
  const classListSet = new Set<string>();
  const children: any[] = [];
  const attrs = new Map<string, string>();
  let classNameVal = "";
  const el: any = {
    tagName: tag.toUpperCase(),
    hidden: false,
    textContent: "",
    title: "",
    style: {
      setProperty: vi.fn(),
      width: "",
      height: "",
    },
    get className() {
      return classNameVal;
    },
    set className(val: string) {
      classNameVal = val;
      classListSet.clear();
      for (const part of val.split(/\s+/).filter(Boolean)) {
        classListSet.add(part);
      }
    },
    classList: {
      add: (...cls: string[]) => {
        for (const c of cls) classListSet.add(c);
        classNameVal = Array.from(classListSet).join(" ");
      },
      remove: (...cls: string[]) => {
        for (const c of cls) classListSet.delete(c);
        classNameVal = Array.from(classListSet).join(" ");
      },
      contains: (c: string) => classListSet.has(c),
      toggle: (c: string, force?: boolean) => {
        const next = force !== undefined ? force : !classListSet.has(c);
        if (next) classListSet.add(c);
        else classListSet.delete(c);
        classNameVal = Array.from(classListSet).join(" ");
        return next;
      },
    },
    setAttribute: (k: string, v: string) => attrs.set(k, String(v)),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    removeAttribute: (k: string) => attrs.delete(k),
    replaceChildren: (...nodes: any[]) => {
      children.length = 0;
      children.push(...nodes);
    },
    append: (...nodes: any[]) => {
      children.push(...nodes);
    },
    appendChild: (node: any) => {
      children.push(node);
      return node;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    querySelectorAll: (selector: string): any[] => {
      const results: any[] = [];
      function walk(node: any) {
        if (!node) return;
        if (selector.startsWith(".") && node.classList?.contains(selector.slice(1))) {
          results.push(node);
        }
        if (node.children) {
          for (const child of node.children) walk(child);
        }
      }
      for (const child of children) walk(child);
      return results;
    },
    querySelector: (selector: string): unknown => el.querySelectorAll(selector)[0] ?? null,
    children,
  };
  return el;
}

describe("usage tracker refresh scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { setTimeout, clearTimeout },
    });
    const bodyEl = createMockElement("body");
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body: bodyEl,
        createElement: (tag: string) => createMockElement(tag),
        createElementNS: (_ns: string, tag: string) => createMockElement(tag),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates callers and never schedules another refresh in Manual mode", async () => {
    let resolve!: (reports: []) => void;
    const getProviderUsage = vi.fn(
      () => new Promise<[]>((done) => {
        resolve = done;
      }),
    );
    const tracker = new UsageTracker({
      getProviderUsage,
      settings: { enabled: false, refreshIntervalMs: null, quotas: [], providerIconUrls: {}, iconPlacement: "inside", showPercent: false },
      onReports: vi.fn(),
    });

    const first = tracker.refresh();
    const second = tracker.refresh();
    expect(first).toBe(second);
    expect(getProviderUsage).toHaveBeenCalledTimes(1);
    resolve([]);
    await first;

    tracker.updateSettings({ enabled: true, refreshIntervalMs: null, quotas: [], providerIconUrls: {}, iconPlacement: "inside", showPercent: false });
    await vi.runAllTicks();
    expect(getProviderUsage).toHaveBeenCalledTimes(2);
    resolve([]);
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(getProviderUsage).toHaveBeenCalledTimes(2);
    tracker.destroy();
  });

  it("clears a replaced automatic schedule", async () => {
    const getProviderUsage = vi.fn(async () => []);
    const tracker = new UsageTracker({
      getProviderUsage,
      settings: { enabled: false, refreshIntervalMs: 10_000, quotas: [], providerIconUrls: {}, iconPlacement: "inside", showPercent: false },
      onReports: vi.fn(),
    });
    tracker.updateSettings({ enabled: true, refreshIntervalMs: 10_000, quotas: [], providerIconUrls: {}, iconPlacement: "inside", showPercent: false });
    await vi.runAllTicks();
    tracker.updateSettings({ enabled: true, refreshIntervalMs: null, quotas: [], providerIconUrls: {}, iconPlacement: "inside", showPercent: false });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(getProviderUsage).toHaveBeenCalledTimes(1);
    tracker.destroy();
  });
});

describe("usage tracker percent rendering", () => {
  it("applies color classes based on usage thresholds", async () => {
    const sampleReports: ProviderUsageReport[] = [
      {
        provider: "anthropic",
        providerName: "Anthropic",
        limits: [{ label: "Session", used: 30, limit: 100, remaining: 70, unit: "tokens", usedPercent: 30 }],
      },
      {
        provider: "openai",
        providerName: "OpenAI",
        limits: [{ label: "Rate", used: 65, limit: 100, remaining: 35, unit: "req", usedPercent: 65 }],
      },
      {
        provider: "google",
        providerName: "Google",
        limits: [{ label: "Daily", used: 90, limit: 100, remaining: 10, unit: "req", usedPercent: 90 }],
      },
    ];

    const tracker = new UsageTracker({
      getProviderUsage: async () => sampleReports,
      settings: {
        enabled: true,
        refreshIntervalMs: null,
        quotas: [
          { provider: "anthropic", label: "Session", enabled: true, style: "bar" },
          { provider: "openai", label: "Rate", enabled: true, style: "bar" },
          { provider: "google", label: "Daily", enabled: true, style: "bar" },
        ],
        providerIconUrls: {},
        iconPlacement: "inside",
        showPercent: true,
      },
      onReports: vi.fn(),
    });

    await tracker.refresh();
    const percents = tracker.el.querySelectorAll(".usage-tracker-percent");
    expect(percents.length).toBe(3);
    expect(percents[0].classList.contains("low")).toBe(true);
    expect(percents[0].textContent).toBe("30%");
    expect(percents[1].classList.contains("med")).toBe(true);
    expect(percents[1].textContent).toBe("65%");
    expect(percents[2].classList.contains("high")).toBe(true);
    expect(percents[2].textContent).toBe("90%");

    const gauges = tracker.el.querySelectorAll(".usage-tracker-gauge");
    expect(gauges.length).toBe(3);
    expect(gauges[0].classList.contains("low")).toBe(true);
    expect(gauges[1].classList.contains("med")).toBe(true);
    expect(gauges[2].classList.contains("high")).toBe(true);
    tracker.destroy();
  });

  it("renders quotas in the exact order configured in settings", async () => {
    const sampleReports: ProviderUsageReport[] = [
      {
        provider: "anthropic",
        providerName: "Anthropic",
        limits: [{ label: "Session", used: 30, limit: 100, remaining: 70, unit: "tokens", usedPercent: 30 }],
      },
      {
        provider: "openai",
        providerName: "OpenAI",
        limits: [{ label: "Rate", used: 65, limit: 100, remaining: 35, unit: "req", usedPercent: 65 }],
      },
    ];

    const tracker = new UsageTracker({
      getProviderUsage: async () => sampleReports,
      settings: {
        enabled: true,
        refreshIntervalMs: null,
        quotas: [
          { provider: "openai", label: "Rate", enabled: true, style: "circle" },
          { provider: "anthropic", label: "Session", enabled: true, style: "bar" },
        ],
        providerIconUrls: {},
        iconPlacement: "inside",
        showPercent: true,
      },
      onReports: vi.fn(),
    });

    await tracker.refresh();
    let items = tracker.el.querySelectorAll(".usage-tracker-item");
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("aria-label")).toContain("OpenAI");
    expect(items[1].getAttribute("aria-label")).toContain("Anthropic");

    // Swap order
    tracker.updateSettings({
      enabled: true,
      refreshIntervalMs: null,
      quotas: [
        { provider: "anthropic", label: "Session", enabled: true, style: "bar" },
        { provider: "openai", label: "Rate", enabled: true, style: "circle" },
      ],
      providerIconUrls: {},
      iconPlacement: "inside",
      showPercent: true,
    });

    items = tracker.el.querySelectorAll(".usage-tracker-item");
    expect(items[0].getAttribute("aria-label")).toContain("Anthropic");
    expect(items[1].getAttribute("aria-label")).toContain("OpenAI");
    tracker.destroy();
  });
});

describe("usage tracker vertical orientation", () => {
  it("keeps the selected gauge style in a vertical grid", async () => {
    const sampleReports: ProviderUsageReport[] = [
      {
        provider: "openai",
        providerName: "OpenAI",
        limits: [{ label: "Rate", used: 65, limit: 100, remaining: 35, unit: "req", usedPercent: 65 }],
      },
    ];

    const tracker = new UsageTracker({
      getProviderUsage: async () => sampleReports,
      settings: {
        enabled: true,
        refreshIntervalMs: null,
        quotas: [{ provider: "openai", label: "Rate", enabled: true, style: "circle" }],
        providerIconUrls: {},
        iconPlacement: "inside",
        showPercent: true,
        orientation: "vertical",
      },
      onReports: vi.fn(),
    });

    await tracker.refresh();
    expect(tracker.el.classList.contains("vertical")).toBe(true);
    expect(tracker.el.querySelector(".usage-tracker-circle")).not.toBeNull();
    expect(tracker.el.querySelector(".usage-tracker-vertical-meter")).toBeNull();
    expect(tracker.el.querySelector(".usage-tracker-icon")).not.toBeNull();

    tracker.destroy();
  });

  it("keeps auto mode horizontal now that tabs live in the vertical rail", async () => {
    const sampleReports: ProviderUsageReport[] = [
      {
        provider: "openai",
        providerName: "OpenAI",
        limits: [{ label: "Rate", used: 65, limit: 100, remaining: 35, unit: "req", usedPercent: 65 }],
      },
    ];

    const tracker = new UsageTracker({
      getProviderUsage: async () => sampleReports,
      settings: {
        enabled: true,
        refreshIntervalMs: null,
        quotas: [{ provider: "openai", label: "Rate", enabled: true, style: "circle" }],
        providerIconUrls: {},
        iconPlacement: "inside",
        showPercent: true,
        orientation: "auto",
      },
      onReports: vi.fn(),
    });

    await tracker.refresh();
    expect(tracker.el.classList.contains("vertical")).toBe(false);
    expect(tracker.el.querySelector(".usage-tracker-circle")).not.toBeNull();

    tracker.render();
    expect(tracker.el.classList.contains("vertical")).toBe(false);

    tracker.destroy();
  });
});
