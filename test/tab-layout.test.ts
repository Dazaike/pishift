import { describe, expect, it } from "vitest";

import {
  isTabLayoutMode,
  planTabOverflow,
  TAB_LAYOUT_LABELS,
  TAB_LAYOUT_MODES,
} from "../src/shared/tab-layout";

/** Every mode is offered in settings, so each needs a label. */
describe("tab layout modes", () => {
  it("labels every mode", () => {
    for (const mode of TAB_LAYOUT_MODES) {
      expect(TAB_LAYOUT_LABELS[mode]).toBeTruthy();
    }
  });

  it("rejects values that are not modes", () => {
    expect(isTabLayoutMode("scroll")).toBe(true);
    expect(isTabLayoutMode("stack")).toBe(true);
    expect(isTabLayoutMode("menu")).toBe(true);
    expect(isTabLayoutMode("vertical")).toBe(false);
    expect(isTabLayoutMode(undefined)).toBe(false);
    expect(isTabLayoutMode(0)).toBe(false);
  });
});

describe("planTabOverflow", () => {
  const gap = 3;
  const chipWidth = 48;

  it("hides nothing when every tab fits", () => {
    const widths = [100, 100, 100];
    expect(
      planTabOverflow({ widths, available: 400, activeIndex: 0, gap, chipWidth }).hidden,
    ).toEqual([]);
  });

  it("hides nothing when the tabs fit exactly", () => {
    // 3 * 100 + 2 * 3 = 306
    expect(
      planTabOverflow({ widths: [100, 100, 100], available: 306, activeIndex: 0, gap, chipWidth }).hidden,
    ).toEqual([]);
  });

  it("keeps a left-to-right prefix and hides the rest", () => {
    // budget = 300 - 48 - 3 = 249 -> 100 + 3 + 100 = 203 fits, third would be 306.
    const plan = planTabOverflow({
      widths: [100, 100, 100, 100],
      available: 300,
      activeIndex: 0,
      gap,
      chipWidth,
    });
    expect(plan.hidden).toEqual([2, 3]);
  });

  it("always keeps the active tab, even far right", () => {
    const plan = planTabOverflow({
      widths: [100, 100, 100, 100, 100],
      available: 300,
      activeIndex: 4,
      gap,
      chipWidth,
    });
    expect(plan.hidden).not.toContain(4);
    // Active claims 100, leaving 249 - 103 for the prefix: index 0 only.
    expect(plan.hidden).toEqual([1, 2, 3]);
  });

  it("shows the active tab alone when the strip is narrower than two tabs", () => {
    const plan = planTabOverflow({
      widths: [180, 180, 180],
      available: 200,
      activeIndex: 1,
      gap,
      chipWidth,
    });
    expect(plan.hidden).toEqual([0, 2]);
  });

  it("keeps the active tab even when it alone exceeds the budget", () => {
    const plan = planTabOverflow({
      widths: [220, 220],
      available: 100,
      activeIndex: 1,
      gap,
      chipWidth,
    });
    expect(plan.hidden).toEqual([0]);
  });

  it("never hides a lone tab", () => {
    expect(
      planTabOverflow({ widths: [400], available: 50, activeIndex: 0, gap, chipWidth }).hidden,
    ).toEqual([]);
  });

  it("hides the prefix tail rather than reordering when a later tab would fit", () => {
    // A narrow tab at index 3 must not leapfrog the wide tab at index 2.
    const plan = planTabOverflow({
      widths: [100, 100, 200, 20],
      available: 300,
      activeIndex: 0,
      gap,
      chipWidth,
    });
    expect(plan.hidden).toEqual([2, 3]);
  });

  it("tolerates no active tab", () => {
    const plan = planTabOverflow({
      widths: [100, 100, 100, 100],
      available: 300,
      activeIndex: -1,
      gap,
      chipWidth,
    });
    expect(plan.hidden).toEqual([2, 3]);
  });
});
