// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { TopMenu } from "../src/renderer/top-menu";
import { TabContextMenu } from "../src/renderer/tab-menu";

describe("split screen ratio normalization", () => {
  function clampSplitRatio(val: unknown): number | undefined {
    if (typeof val === "number" && Number.isFinite(val) && val >= 0.1 && val <= 0.9) {
      return val;
    }
    return undefined;
  }

  it("accepts valid ratios between 0.1 and 0.9", () => {
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(0.2)).toBe(0.2);
    expect(clampSplitRatio(0.8)).toBe(0.8);
    expect(clampSplitRatio(0.35)).toBe(0.35);
  });

  it("rejects ratios outside 0.1 to 0.9 range or non-numbers", () => {
    expect(clampSplitRatio(0.05)).toBeUndefined();
    expect(clampSplitRatio(0.95)).toBeUndefined();
    expect(clampSplitRatio(-1)).toBeUndefined();
    expect(clampSplitRatio(NaN)).toBeUndefined();
    expect(clampSplitRatio("0.5")).toBeUndefined();
    expect(clampSplitRatio(null)).toBeUndefined();
  });
});

describe("TopMenu with split screen action", () => {
  it("renders Split Screen item and invokes onToggleSplit", () => {
    const anchor = document.createElement("button");
    const onToggleSplit = vi.fn();
    const menu = new TopMenu(anchor, {
      onOpenTodo: vi.fn(),
      onOpenSettings: vi.fn(),
      onToggleSplit,
      onRelaunch: vi.fn(),
      onQuit: vi.fn(),
    });

    menu.open();
    const splitBtn = menu.el.querySelector<HTMLButtonElement>('[data-action="split"]');
    expect(splitBtn).not.toBeNull();
    expect(splitBtn?.textContent).toContain("Split Screen");

    splitBtn?.click();
    expect(onToggleSplit).toHaveBeenCalledTimes(1);
    expect(menu.isOpen).toBe(false);
  });
});

describe("TabContextMenu with split screen action", () => {
  it("renders Split Screen item and invokes onSplit", () => {
    const onSplit = vi.fn();
    const menu = new TabContextMenu();

    menu.open(100, 100, { cwd: "/test" }, {
      onOpenExplorer: vi.fn(),
      onCopyPath: vi.fn(),
      onDuplicate: vi.fn(),
      onRename: vi.fn(),
      onSetColor: vi.fn(),
      onSplit,
      onClose: vi.fn(),
      onCloseOthers: vi.fn(),
      onCloseRight: vi.fn(),
    });

    const splitItem = menu.el.querySelector<HTMLDivElement>('[data-action="split"]');
    expect(splitItem).not.toBeNull();
    expect(splitItem?.textContent).toContain("Split Screen (Dual View)");

    splitItem?.click();
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(onSplit).toHaveBeenCalledWith({ cwd: "/test" });
  });
});
