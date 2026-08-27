import { describe, expect, it } from "vitest";

import { formatElapsed } from "../src/shared/elapsed";

describe("formatElapsed", () => {
  it("renders sub-minute durations in seconds", () => {
    expect(formatElapsed(12_000)).toBe("12s");
  });

  it("zero-pads seconds past a minute", () => {
    expect(formatElapsed(245_000)).toBe("4m 05s");
  });

  it("switches to hours and zero-padded minutes", () => {
    expect(formatElapsed(3_720_000)).toBe("1h 02m");
  });

  it("floors partial seconds and clamps negatives", () => {
    expect(formatElapsed(1_999)).toBe("1s");
    expect(formatElapsed(-5)).toBe("0s");
  });
});
