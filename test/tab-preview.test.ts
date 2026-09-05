// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabPreviewPopover, type TabPreviewInfo } from "../src/renderer/tab-preview";

describe("TabPreviewPopover", () => {
  let scroller: HTMLElement;
  let tab1: HTMLElement;
  let tab2: HTMLElement;
  let mockInfo: Record<number, TabPreviewInfo>;

  beforeEach(() => {
    document.body.innerHTML = "";
    scroller = document.createElement("div");
    scroller.id = "tabs";

    tab1 = document.createElement("button");
    tab1.className = "tab active";
    tab1.dataset.tabKey = "1";
    tab1.getBoundingClientRect = () => ({
      left: 10,
      top: 10,
      right: 110,
      bottom: 40,
      width: 100,
      height: 30,
      x: 10,
      y: 10,
      toJSON: () => {},
    });

    tab2 = document.createElement("button");
    tab2.className = "tab";
    tab2.dataset.tabKey = "2";
    tab2.getBoundingClientRect = () => ({
      left: 120,
      top: 10,
      right: 220,
      bottom: 40,
      width: 100,
      height: 30,
      x: 120,
      y: 10,
      toJSON: () => {},
    });

    scroller.append(tab1, tab2);
    document.body.appendChild(scroller);

    mockInfo = {
      1: {
        sessionNumber: 1,
        title: "Workspace 1",
        cwd: "C:/Projects/App1",
        modelName: "gemini-2.5-pro",
        activity: "idle",
        viewMode: "terminal",
        lines: ["npm run build", "Compiled in 240ms"],
      },
      2: {
        sessionNumber: 2,
        title: "Workspace 2",
        cwd: "C:/Projects/App2",
        modelName: "claude-3-7-sonnet",
        activity: "thinking",
        viewMode: "chat",
        lines: ["Agent: I am examining the codebase...", "Tool: Reading src/index.ts"],
      },
    };
  });

  it("mounts preview popover in document.body", () => {
    const popover = new TabPreviewPopover(scroller, (key) => mockInfo[key] ?? null);
    expect(popover.el.parentElement).toBe(document.body);
    expect(popover.el.classList.contains("tab-preview-popover")).toBe(true);
    expect(popover.el.hidden).toBe(true);
    expect(popover.isEnabled).toBe(true);
  });

  it("shows tab preview with formatted information on showForTab", () => {
    const popover = new TabPreviewPopover(scroller, (key) => mockInfo[key] ?? null);
    popover.showForTab(tab2);

    expect(popover.el.hidden).toBe(false);
    expect(popover.currentTabKey).toBe(2);

    const title = popover.el.querySelector(".tab-preview-title")?.textContent;
    expect(title).toBe("Workspace 2");

    const cwd = popover.el.querySelector(".tab-preview-cwd")?.textContent;
    expect(cwd).toBe("C:/Projects/App2");

    const model = popover.el.querySelector(".tab-preview-model")?.textContent;
    expect(model).toContain("claude-3-7-sonnet");

    const mode = popover.el.querySelector(".tab-preview-mode")?.textContent;
    expect(mode).toBe("Chat");

    const activity = popover.el.querySelector(".tab-preview-activity")?.textContent;
    expect(activity).toBe("thinking");

    const content = popover.el.querySelector(".tab-preview-content")?.textContent;
    expect(content).toContain("Agent: I am examining the codebase...");
    expect(content).toContain("Tool: Reading src/index.ts");
  });

  it("shows fallback text when lines are empty", () => {
    const popover = new TabPreviewPopover(scroller, (key) => ({
      ...mockInfo[key],
      lines: [],
    }));
    popover.showForTab(tab1);

    const content = popover.el.querySelector(".tab-preview-content")?.textContent;
    expect(content).toBe("(no output in session)");
  });

  it("respects enabled/disabled flag", () => {
    vi.useFakeTimers();
    const popover = new TabPreviewPopover(scroller, (key) => mockInfo[key] ?? null);
    popover.setEnabled(false);
    expect(popover.isEnabled).toBe(false);

    // Trigger pointerover event on tab
    tab2.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    vi.advanceTimersByTime(400);

    expect(popover.el.hidden).toBe(true);
    vi.useRealTimers();
  });

  it("hides popover on hideImmediate", () => {
    const popover = new TabPreviewPopover(scroller, (key) => mockInfo[key] ?? null);
    popover.showForTab(tab1);
    expect(popover.el.hidden).toBe(false);

    popover.hideImmediate();
    expect(popover.el.hidden).toBe(true);
    expect(popover.currentTabKey).toBeNull();
  });
});
