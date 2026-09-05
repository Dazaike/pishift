// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULT_TAB_LAYOUT, isTabLayout, TAB_LAYOUTS } from "../src/shared/tab-layout";

describe("tab-layout", () => {
  it("defines default layout as vertical", () => {
    expect(DEFAULT_TAB_LAYOUT).toBe("vertical");
    expect(TAB_LAYOUTS).toEqual(["vertical", "vertical-floating", "horizontal"]);
  });

  it("validates tab layout mode correctly", () => {
    expect(isTabLayout("vertical")).toBe(true);
    expect(isTabLayout("vertical-floating")).toBe(true);
    expect(isTabLayout("horizontal")).toBe(true);
    expect(isTabLayout("scroll")).toBe(false);
    expect(isTabLayout("stack")).toBe(false);
    expect(isTabLayout("")).toBe(false);
    expect(isTabLayout(null)).toBe(false);
    expect(isTabLayout(undefined)).toBe(false);
    expect(isTabLayout(123)).toBe(false);
  });
});
