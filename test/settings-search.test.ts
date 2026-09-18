// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { SettingsModal } from "../src/renderer/settings";
import { DEFAULT_PERSISTED_SETTINGS } from "../src/shared/defaults";
import { DEFAULT_USAGE_TRACKER_SETTINGS } from "../src/shared/usage-tracker";

/**
 * The modal's options are one large inline object type that is not exported, so
 * the fixture is cast once. Every callback is a spy; only the data the renderer
 * reads needs real values.
 */
function makeModal(): SettingsModal {
  const noop = vi.fn();
  const options = {
    preset: undefined,
    showUsageInHeader: false,
    fontFamily: "",
    activityColors: DEFAULT_PERSISTED_SETTINGS.activityColors,
    initialActivityColorsOnTabs: true,
    hideTopButtonLabels: false,
    hideBottomButtonLabels: false,
    collapseTopBarToMenu: false,
    panelPosition: "top-right",
    defaultViewMode: "terminal",
    toolDensity: "compact",
    collapseReasoningOnReply: false,
    rawTextOnExpand: false,
    tabPreviews: true,
    tabLayout: "vertical",
    tabRailSide: "left",
    tabRailHoverReachPx: 24,
    scrollSteps: 3,
    pasteMode: "ask",
    pasteMarkerStyle: "content",
    pasteMarkerPaint: "pill",
    pasteMarkerPulse: true,
    doneSoundEnabled: true,
    doneSoundVolume: 0.2,
    thinkingControlStyle: "horizontal",
    autoUpdateOmpOnOpen: false,
    usageTracker: DEFAULT_USAGE_TRACKER_SETTINGS,
    usageReports: [],
    settingsSectionCollapsed: {},
    onSelect: noop,
    onToggleUsageHeader: noop,
    onFontChange: noop,
    onActivityColorChange: noop,
    onResetActivityColors: noop,
    onToggleActivityColorsOnTabs: noop,
    onToggleHideTopButtonLabels: noop,
    onToggleHideBottomButtonLabels: noop,
    onToggleCollapseTopBarToMenu: noop,
    onToggleAutoUpdateOmpOnOpen: noop,
    onPanelPositionChange: noop,
    onDefaultViewModeChange: noop,
    onToolDensityChange: noop,
    onToggleCollapseReasoningOnReply: noop,
    onToggleRawTextOnExpand: noop,
    onToggleTabPreviews: noop,
    onTabLayoutChange: noop,
    onTabRailSideChange: noop,
    onTabRailHoverReachChange: noop,
    onScrollStepsChange: noop,
    onPasteModeChange: noop,
    onPasteMarkerStyleChange: noop,
    onPasteMarkerPaintChange: noop,
    onTogglePasteMarkerPulse: noop,
    onToggleDoneSound: noop,
    onDoneSoundVolumeChange: noop,
    onPreviewDoneSound: noop,
    onThinkingControlStyleChange: noop,
    onOmpUpdateChecked: noop,
    onUsageTrackerChange: noop,
    onSettingsSectionCollapsedChange: noop,
    onRefreshUsage: async () => {},
  };
  return new SettingsModal(options as never);
}

function visibleRows(modal: SettingsModal): string[] {
  return Array.from(modal.el.querySelectorAll<HTMLElement>("[data-section-id]"))
    .filter((section) => !section.hidden)
    .flatMap((section) =>
      Array.from(section.querySelectorAll<HTMLElement>(".settings-check-label, .settings-pos-row"))
        .filter((row) => !row.hidden)
        .map((row) => row.textContent ?? ""),
    );
}

function search(modal: SettingsModal, text: string): void {
  const input = modal.el.querySelector<HTMLInputElement>(".settings-search");
  if (!input) throw new Error("search field missing");
  input.value = text;
  input.dispatchEvent(new Event("input"));
}

describe("SettingsModal search", () => {
  it("shows only one section until a query spans them", () => {
    const modal = makeModal();
    modal.open();

    const sectionIds = (): string[] =>
      Array.from(modal.el.querySelectorAll<HTMLElement>("[data-section-id]"))
        .filter((section) => !section.hidden)
        .map((section) => section.dataset.sectionId ?? "");

    // Sidebar view: exactly the active section.
    expect(sectionIds()).toEqual(["appearance"]);

    // "reasoning" only exists in Chat View, so the pane must switch sections.
    search(modal, "reasoning");
    expect(sectionIds()).toEqual(["chat-view"]);
    const rows = visibleRows(modal);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.toLowerCase().includes("reasoning"))).toBe(true);
  });

  it("matches rows across several sections at once", () => {
    const modal = makeModal();
    modal.open();

    // "tab" appears in Interface (previews, layout, rail side) and elsewhere.
    search(modal, "tab");
    const sections = Array.from(modal.el.querySelectorAll<HTMLElement>("[data-section-id]")).filter(
      (section) => !section.hidden,
    );
    expect(sections.length).toBeGreaterThan(0);
    for (const row of visibleRows(modal)) {
      expect(row.toLowerCase()).toContain("tab");
    }
  });

  it("restores the single-section view when the query is cleared", () => {
    const modal = makeModal();
    modal.open();

    search(modal, "reasoning");
    search(modal, "");

    const visible = Array.from(modal.el.querySelectorAll<HTMLElement>("[data-section-id]")).filter(
      (section) => !section.hidden,
    );
    expect(visible).toHaveLength(1);
    // Every row of that section is visible again, none left hidden by the filter.
    const hidden = Array.from(
      visible[0].querySelectorAll<HTMLElement>(".settings-check-label, .settings-pos-row"),
    ).filter((row) => row.hidden);
    expect(hidden).toHaveLength(0);
  });

  it("reports when nothing matches", () => {
    const modal = makeModal();
    modal.open();

    search(modal, "zzzznotasetting");
    expect(
      Array.from(modal.el.querySelectorAll<HTMLElement>("[data-section-id]")).filter(
        (section) => !section.hidden,
      ),
    ).toHaveLength(0);
    expect(modal.el.querySelector(".settings-search-empty")?.textContent).toContain("zzzznotasetting");
  });
});
