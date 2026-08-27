import { describe, expect, it } from "vitest";
import { ASK_EDITOR_GAP_MS, buildAskDialogSteps, sanitizeAskText } from "../src/shared/ask-keys";

describe("buildAskDialogSteps", () => {
  it("moves up from the recommended row for single-select", () => {
    expect(
      buildAskDialogSteps([
        {
          multi: false,
          optionsCount: 3,
          recommended: 2,
          selectedIndices: [0],
        },
      ]),
    ).toEqual([
      { type: "arrow", dir: "up" },
      { type: "arrow", dir: "up" },
      { type: "enter" },
    ]);
  });

  it("moves down from row zero for single-select", () => {
    expect(
      buildAskDialogSteps([
        {
          multi: false,
          optionsCount: 3,
          selectedIndices: [2],
        },
      ]),
    ).toEqual([
      { type: "arrow", dir: "down" },
      { type: "arrow", dir: "down" },
      { type: "enter" },
    ]);
  });

  it("selects and fills the trailing Other row", () => {
    expect(
      buildAskDialogSteps([
        {
          multi: false,
          optionsCount: 3,
          selectedIndices: [],
          customText: "my answer",
        },
      ]),
    ).toEqual([
      { type: "arrow", dir: "down" },
      { type: "arrow", dir: "down" },
      { type: "arrow", dir: "down" },
      { type: "enter" },
      { type: "wait", ms: ASK_EDITOR_GAP_MS },
      { type: "text", value: "my answer" },
      { type: "enter" },
    ]);
  });

  it("toggles multi-select with space and submits without a Submit tab", () => {
    expect(
      buildAskDialogSteps([
        {
          multi: true,
          optionsCount: 4,
          selectedIndices: [0, 2],
        },
      ]),
    ).toEqual([
      { type: "space" },
      { type: "arrow", dir: "down" },
      { type: "arrow", dir: "down" },
      { type: "space" },
      { type: "enter" },
    ]);
  });

  it("opens Other on multi-select via space; confirming submits the sole question", () => {
    expect(
      buildAskDialogSteps([
        {
          multi: true,
          optionsCount: 3,
          selectedIndices: [0],
          customText: "x",
        },
      ]),
    ).toEqual([
      { type: "space" },
      { type: "arrow", dir: "down" },
      { type: "arrow", dir: "down" },
      { type: "arrow", dir: "down" },
      { type: "space" },
      { type: "wait", ms: ASK_EDITOR_GAP_MS },
      { type: "text", value: "x" },
      { type: "enter" },
    ]);
  });

  it("advances with an arrow key (not Enter) after Other text in a multi-question ask", () => {
    expect(
      buildAskDialogSteps([
        {
          multi: true,
          optionsCount: 2,
          selectedIndices: [0],
          customText: "x",
        },
        {
          multi: false,
          optionsCount: 3,
          selectedIndices: [0],
        },
      ]),
    ).toEqual([
      { type: "space" },
      { type: "arrow", dir: "down" },
      { type: "arrow", dir: "down" },
      { type: "space" },
      { type: "wait", ms: ASK_EDITOR_GAP_MS },
      { type: "text", value: "x" },
      { type: "enter" },
      { type: "arrow", dir: "right" },
      { type: "enter" },
      { type: "enter" },
    ]);
  });

  it("advances with an arrow key (not Enter) after single-select Other text in a multi-question ask", () => {
    expect(
      buildAskDialogSteps([
        {
          multi: false,
          optionsCount: 2,
          selectedIndices: [],
          customText: "y",
        },
        {
          multi: false,
          optionsCount: 3,
          selectedIndices: [0],
        },
      ]),
    ).toEqual([
      { type: "arrow", dir: "down" },
      { type: "arrow", dir: "down" },
      { type: "enter" },
      { type: "wait", ms: ASK_EDITOR_GAP_MS },
      { type: "text", value: "y" },
      { type: "enter" },
      { type: "arrow", dir: "right" },
      { type: "enter" },
      { type: "enter" },
    ]);
  });

  it("does not advance with an arrow key after Other text on the LAST question of a multi-question ask", () => {
    expect(
      buildAskDialogSteps([
        {
          multi: false,
          optionsCount: 3,
          selectedIndices: [0],
        },
        {
          multi: true,
          optionsCount: 2,
          selectedIndices: [0],
          customText: "zxc",
        },
      ]),
    ).toEqual([
      { type: "enter" },
      { type: "space" },
      { type: "arrow", dir: "down" },
      { type: "arrow", dir: "down" },
      { type: "space" },
      { type: "wait", ms: ASK_EDITOR_GAP_MS },
      { type: "text", value: "zxc" },
      { type: "enter" },
      { type: "enter" },
    ]);
  });

  it("adds a Submit-tab Enter after two single-select questions", () => {
    expect(
      buildAskDialogSteps([
        {
          multi: false,
          optionsCount: 3,
          selectedIndices: [0],
        },
        {
          multi: false,
          optionsCount: 3,
          selectedIndices: [0],
        },
      ]),
    ).toEqual([{ type: "enter" }, { type: "enter" }, { type: "enter" }]);
  });
});

describe("sanitizeAskText", () => {
  it("removes terminal control characters that submit or cancel", () => {
    expect(sanitizeAskText("a\r\nb\x1bc")).toBe("a bc");
  });
});
