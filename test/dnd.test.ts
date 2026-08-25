import { describe, expect, it } from "vitest";
import { DragTracker, INTERNAL_DRAG_TYPE, isExternalDrag } from "../src/renderer/dnd";

describe("isExternalDrag", () => {
  it("rejects drags marked by the app's own dragstart handlers", () => {
    expect(isExternalDrag([INTERNAL_DRAG_TYPE, "text/plain"])).toBe(false);
  });

  it("claims file drags from the OS", () => {
    expect(isExternalDrag(["Files"])).toBe(true);
  });

  it("claims external text drags that carry no Files entry", () => {
    // Previously dropped on the floor by the text/plain-without-Files heuristic.
    expect(isExternalDrag(["text/plain"])).toBe(true);
  });
});

describe("DragTracker", () => {
  it("reports activation only on the outermost dragenter", () => {
    const tracker = new DragTracker();
    expect(tracker.enter(0)).toBe(true);
    expect(tracker.enter(0)).toBe(false);
    expect(tracker.active).toBe(true);
  });

  it("reports full exit only after the nesting depth unwinds", () => {
    const tracker = new DragTracker();
    tracker.enter(0);
    tracker.enter(0);
    expect(tracker.leave()).toBe(false);
    expect(tracker.leave()).toBe(true);
    expect(tracker.active).toBe(false);
  });

  it("never lets an unmatched dragleave drive the depth negative", () => {
    const tracker = new DragTracker();
    expect(tracker.leave()).toBe(true);
    expect(tracker.leave()).toBe(true);
    expect(tracker.enter(0)).toBe(true);
  });

  it("goes stale only once the dragover timeout elapses", () => {
    const tracker = new DragTracker();
    tracker.enter(1000);
    expect(tracker.isStale(1400, 500)).toBe(false);
    expect(tracker.isStale(1600, 500)).toBe(true);
  });

  it("keeps a drag fresh while dragover keeps firing", () => {
    const tracker = new DragTracker();
    tracker.enter(1000);
    tracker.over(1500);
    expect(tracker.isStale(1800, 500)).toBe(false);
  });

  it("clears once and reports no in-flight drag afterwards", () => {
    const tracker = new DragTracker();
    tracker.enter(1000);
    expect(tracker.end()).toBe(true);
    expect(tracker.end()).toBe(false);
    expect(tracker.isStale(9999, 500)).toBe(false);
  });
});
