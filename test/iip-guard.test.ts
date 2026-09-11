// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { asOscEndHandler, guardOscEnd } from "../src/renderer/iip-guard";

afterEach(() => {
  vi.useRealTimers();
});

describe("guardOscEnd", () => {
  it("settles true when the handler promise never settles", async () => {
    vi.useFakeTimers();
    const guarded = guardOscEnd(() => new Promise<boolean>(() => {}), 2500);
    const pending = guarded(true);
    expect(pending instanceof Promise).toBe(true);
    const assertion = expect(pending).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    await assertion;
  });

  it("settles true when the handler promise rejects", async () => {
    const guarded = guardOscEnd(() => Promise.reject(new Error("bad bitmap")), 2500);
    await expect(guarded(true)).resolves.toBe(true);
  });

  it("passes sync results through untouched", () => {
    expect(guardOscEnd(() => false, 2500)(true)).toBe(false);
    expect(guardOscEnd(() => true, 2500)(false)).toBe(true);
  });

  it("returns true when the handler throws synchronously", () => {
    const guarded = guardOscEnd(() => {
      throw new Error("parser fault");
    }, 2500);
    expect(guarded(true)).toBe(true);
  });

  it("preserves a settled value and clears the timer", async () => {
    vi.useFakeTimers();
    const guarded = guardOscEnd(() => Promise.resolve(false), 10);
    await expect(guarded(true)).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("asOscEndHandler", () => {
  it("accepts a handler-shaped value", () => {
    const end = (): boolean => true;
    expect(asOscEndHandler({ end })?.end).toBe(end);
  });

  it("rejects values without a callable end", () => {
    expect(asOscEndHandler(null)).toBeNull();
    expect(asOscEndHandler({})).toBeNull();
    expect(asOscEndHandler({ end: 42 })).toBeNull();
  });
});
