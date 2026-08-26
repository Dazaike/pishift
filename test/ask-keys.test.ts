import { describe, expect, it } from "vitest";
import { buildAskQuestionKeys, sanitizeAskText } from "../src/shared/ask-keys";

describe("buildAskQuestionKeys", () => {
  it("moves up from the recommended row for single-select", () => {
    expect(
      buildAskQuestionKeys(
        {
          multi: false,
          optionsCount: 3,
          recommended: 2,
          selectedIndices: [0],
        },
        false,
      ),
    ).toBe("\x1b[A\x1b[A\r");
  });

  it("moves down from row zero for single-select", () => {
    expect(
      buildAskQuestionKeys(
        {
          multi: false,
          optionsCount: 3,
          selectedIndices: [2],
        },
        false,
      ),
    ).toBe("\x1b[B\x1b[B\r");
  });

  it("selects and fills the trailing Other row", () => {
    expect(
      buildAskQuestionKeys(
        {
          multi: false,
          optionsCount: 3,
          selectedIndices: [],
          customText: "my answer",
        },
        false,
      ),
    ).toBe("\x1b[B\x1b[B\x1b[B\rmy answer\r");
  });

  it("finishes multi-select in a multi-question ask with right arrow", () => {
    expect(
      buildAskQuestionKeys(
        {
          multi: true,
          optionsCount: 4,
          selectedIndices: [0, 2],
        },
        true,
      ),
    ).toBe("\r\x1b[B\x1b[B\r\x1b[C");
  });

  it("commits single-question multi-select through Done selecting", () => {
    expect(
      buildAskQuestionKeys(
        {
          multi: true,
          optionsCount: 4,
          selectedIndices: [1],
        },
        false,
      ),
    ).toBe("\x1b[B\r\x1b[B\x1b[B\x1b[B\r");
  });

  it("accounts for Done selecting before Other", () => {
    expect(
      buildAskQuestionKeys(
        {
          multi: true,
          optionsCount: 3,
          selectedIndices: [0],
          customText: "x",
        },
        false,
      ),
    ).toBe("\r\x1b[B\x1b[B\x1b[B\x1b[B\rx\r");
  });
});

describe("sanitizeAskText", () => {
  it("removes terminal control characters that submit or cancel", () => {
    expect(sanitizeAskText("a\r\nb\x1bc")).toBe("a bc");
  });
});
