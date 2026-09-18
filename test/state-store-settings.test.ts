import { describe, expect, it } from "vitest";

import { DEFAULT_PERSISTED_SETTINGS } from "../src/shared/defaults";
import { normalizeSettings } from "../src/main/state-store";

describe("normalizeSettings", () => {
  it("round-trips a well-formed export payload back to the same settings", () => {
    const exported = normalizeSettings(DEFAULT_PERSISTED_SETTINGS, DEFAULT_PERSISTED_SETTINGS);
    const reimported = normalizeSettings(exported, DEFAULT_PERSISTED_SETTINGS);
    expect(reimported).toEqual(exported);
    expect(reimported.themeName).toBe(DEFAULT_PERSISTED_SETTINGS.themeName);
    expect(reimported.customModels).toEqual(DEFAULT_PERSISTED_SETTINGS.customModels);
  });

  it("falls back field-by-field to defaults for a malformed or foreign import file", () => {
    const settings = normalizeSettings(
      {
        themeName: "Dracula",
        fontSize: "not a number" as unknown as number,
        chatZoom: "nope" as unknown as number,
        collapseReasoningOnReply: "yes" as unknown as boolean,
        panelPosition: "bottom-left" as never,
        pasteMode: "garbage" as never,
        toolDensity: "ultra" as never,
        tabLayout: "diagonal" as never,
        customModels: "not-an-array" as unknown as never,
      },
      DEFAULT_PERSISTED_SETTINGS,
    );

    expect(settings.themeName).toBe("Dracula");
    expect(settings.fontSize).toBe(DEFAULT_PERSISTED_SETTINGS.fontSize);
    expect(settings.chatZoom).toBe(DEFAULT_PERSISTED_SETTINGS.chatZoom);
    expect(settings.collapseReasoningOnReply).toBe(DEFAULT_PERSISTED_SETTINGS.collapseReasoningOnReply);
    expect(settings.panelPosition).toBe(DEFAULT_PERSISTED_SETTINGS.panelPosition);
    expect(settings.pasteMode).toBe(DEFAULT_PERSISTED_SETTINGS.pasteMode);
    expect(settings.toolDensity).toBe(DEFAULT_PERSISTED_SETTINGS.toolDensity);
    expect(settings.tabLayout).toBe(DEFAULT_PERSISTED_SETTINGS.tabLayout);
    expect(settings.customModels).toBe(DEFAULT_PERSISTED_SETTINGS.customModels);
  });

  it("never leaks machine-specific fields into the normalized settings shape", () => {
    const settings = normalizeSettings(
      {
        ompPath: "C:/some/local/omp.exe",
        recentFolders: ["C:/private/project"],
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        tabs: [{ cwd: "C:/private/project" }],
        activeIndex: 3,
      } as never,
      DEFAULT_PERSISTED_SETTINGS,
    );

    expect(settings).not.toHaveProperty("ompPath");
    expect(settings).not.toHaveProperty("recentFolders");
    expect(settings).not.toHaveProperty("bounds");
    expect(settings).not.toHaveProperty("tabs");
    expect(settings).not.toHaveProperty("activeIndex");
  });
});
