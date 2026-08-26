import { describe, expect, it } from "vitest";
import { isJobLifecycleUpdate, type InstalledModel } from "../src/shared/ipc";
import { findInstalledModel } from "../src/shared/model-match";
import {
  buildThinkingLevelsForModel,
  clampThinkingToLevels,
  formatThinkingLevel,
  normalizeThinkingToken,
  toThinkingCommandToken,
} from "../src/renderer/dock";
import { getThinkingIconSvg, normalizeThinkingLevelKey } from "../src/renderer/thinking-icons";

/** Mirrors real models.db ordering: openrouter rows come first and collide by bare name. */
const CATALOG: InstalledModel[] = [
  {
    id: "x-ai/grok-4",
    name: "Grok 4",
    provider: "openrouter",
    reasoning: true,
    thinkingEfforts: ["minimal", "low", "medium", "high"],
  },
  {
    id: "google/gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    provider: "openrouter",
    reasoning: true,
    thinkingEfforts: ["low", "medium", "high"],
  },
  {
    id: "x-ai/grok-4.6",
    name: "Grok 4.6",
    provider: "openrouter",
    reasoning: true,
    thinkingEfforts: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    provider: "xai-oauth",
    reasoning: true,
    thinkingEfforts: ["minimal", "low", "medium", "high", "xhigh"],
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    provider: "google-antigravity",
    reasoning: true,
    thinkingEfforts: ["minimal", "low", "medium", "high"],
  },
];

describe("findInstalledModel", () => {
  it("prefers the same-provider row over a bare-name collision", () => {
    const m = findInstalledModel("xai-oauth/grok-4.6", CATALOG);
    expect(m?.provider).toBe("xai-oauth");
    expect(m?.thinkingEfforts).toContain("xhigh");
  });

  it("does not let grok-4 absorb grok-4.6", () => {
    expect(findInstalledModel("xai-oauth/grok-4.6", CATALOG)?.id).not.toBe("x-ai/grok-4");
    expect(findInstalledModel("nanogpt/grok-4.6", CATALOG)?.name).toBe("Grok 4.6");
  });

  it("routes google-antigravity to its own gemini row", () => {
    const m = findInstalledModel("google-antigravity/gemini-3.7-flash", CATALOG);
    expect(m?.provider).toBe("google-antigravity");
    expect(m?.thinkingEfforts).toContain("minimal");
  });

  it("handles a provider prefix in front of a slashed model id", () => {
    expect(findInstalledModel("openrouter/x-ai/grok-4.6", CATALOG)?.id).toBe("x-ai/grok-4.6");
  });

  it("truncates provider ids at ':' the way models.db does", () => {
    expect(findInstalledModel("xai-oauth:beta/grok-4.6", CATALOG)?.provider).toBe("xai-oauth");
  });

  it("matches a bare name when no provider hint is given", () => {
    expect(findInstalledModel("grok-4", CATALOG)?.id).toBe("x-ai/grok-4");
  });

  it("returns undefined rather than a substring guess", () => {
    expect(findInstalledModel("openrouter/does-not-exist", CATALOG)).toBeUndefined();
    expect(findInstalledModel("", CATALOG)).toBeUndefined();
  });
});

describe("model thinking capabilities ladder", () => {
  it("filters thinking levels based on model metadata", () => {
    const grok = findInstalledModel("xai-oauth/grok-4.6", CATALOG);
    expect(buildThinkingLevelsForModel(grok)).toEqual([
      "auto",
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);

    const gemini = findInstalledModel("google-antigravity/gemini-3.7-flash", CATALOG);
    expect(buildThinkingLevelsForModel(gemini)).toEqual([
      "auto",
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);

    const geminiRequiresEffort = {
      reasoning: true,
      thinkingEfforts: ["low", "medium", "high"],
      thinkingRequiresEffort: true,
    };
    expect(buildThinkingLevelsForModel(geminiRequiresEffort)).toEqual([
      "auto",
      "off",
      "low",
      "medium",
      "high",
    ]);
    const maxModel = {
      reasoning: true,
      thinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
    };
    expect(buildThinkingLevelsForModel(maxModel)).toEqual([
      "auto",
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);

    expect(buildThinkingLevelsForModel({ reasoning: false })).toEqual(["off"]);
    expect(buildThinkingLevelsForModel(undefined)).toEqual([
      "auto",
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("clamps unsupported levels to nearest available capability", () => {
    const grokLevels = buildThinkingLevelsForModel(findInstalledModel("xai-oauth/grok-4.6", CATALOG));
    expect(clampThinkingToLevels("max", grokLevels)).toBe("xhigh");

    const geminiLevels = buildThinkingLevelsForModel(findInstalledModel("google-antigravity/gemini-3.7-flash", CATALOG));
    expect(clampThinkingToLevels("max", geminiLevels)).toBe("high");
    expect(clampThinkingToLevels("xhigh", geminiLevels)).toBe("high");
  });

  it("normalizes display, command, and clamp aliases consistently", () => {
    const allLevels = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"];
    const cases = [
      ["auto", "auto", "Auto", "auto"],
      ["off", "off", "Off", "off"],
      ["min", "minimal", "Min", "min"],
      ["minimal", "minimal", "Min", "min"],
      ["low", "low", "Low", "low"],
      ["med", "medium", "Medium", "med"],
      ["medium", "medium", "Medium", "med"],
      ["high", "high", "High", "high"],
      ["xhi", "xhigh", "XHigh", "xhigh"],
      ["xhigh", "xhigh", "XHigh", "xhigh"],
      ["max", "max", "Max", "max"],
    ] as const;

    for (const [raw, normalized, display, command] of cases) {
      expect(normalizeThinkingToken(raw)).toBe(normalized);
      expect(formatThinkingLevel(raw)).toBe(display);
      expect(toThinkingCommandToken(raw)).toBe(command);
      expect(clampThinkingToLevels(raw, allLevels)).toBe(normalized);
    }

    const normalizationAliases = [
      ["extrahigh", "xhigh", "XHigh", "xhigh"],
      ["maximum", "max", "Max", "max"],
      ["none", "off", "Off", "off"],
      ["disabled", "off", "Off", "off"],
    ] as const;
    for (const [raw, normalized, display, command] of normalizationAliases) {
      expect(normalizeThinkingToken(raw)).toBe(normalized);
      expect(formatThinkingLevel(raw)).toBe(display);
      expect(toThinkingCommandToken(raw)).toBe(command);
      expect(clampThinkingToLevels(raw, allLevels)).toBe(normalized);
    }
  });

  it("keeps Max and XHigh as distinct icon levels", () => {
    for (const alias of ["xhigh", "xhi", "extrahigh", "5"]) {
      expect(normalizeThinkingLevelKey(alias)).toBe("xhigh");
    }
    for (const alias of ["max", "maximum", "6"]) {
      expect(normalizeThinkingLevelKey(alias)).toBe("max");
    }

    const maxSvg = getThinkingIconSvg("max");
    expect(maxSvg).toContain("thinking-icon-max");
    expect(maxSvg).toContain("M14.5 0.5 L15.5 1.5 L14.5 2.5 L13.5 1.5 Z");
    expect(getThinkingIconSvg("xhigh")).not.toBe(maxSvg);
  });
});

describe("control bridge update ownership", () => {
  it("keeps job lifecycle publications out of terminal session state", () => {
    expect(isJobLifecycleUpdate({ updateKind: "jobs" })).toBe(true);
    expect(isJobLifecycleUpdate({ updateKind: "session" })).toBe(false);
  });
});
