// @vitest-environment jsdom
import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RENDER_STALL_MS, TermView, type TermViewHooks } from "../src/renderer/term-view";

type WriteCallback = () => void;

function makeView(onRenderStall: (stalled: boolean) => void): TermView {
  Object.assign(window, { pishift: { windowsPty: undefined } });
  const hooks: TermViewHooks = {
    write: vi.fn(),
    resize: vi.fn(),
    setTitle: vi.fn(),
    setBusy: vi.fn(),
    notify: vi.fn(),
    onRenderStall,
  };
  return new TermView(hooks);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TermView render watchdog", () => {
  it("reports stalled once, then drained", async () => {
    const callbacks: WriteCallback[] = [];
    vi.spyOn(Terminal.prototype, "write").mockImplementation((_data, cb) => {
      if (cb) callbacks.push(cb as WriteCallback);
    });
    vi.useFakeTimers();
    const onRenderStall = vi.fn();
    const view = makeView(onRenderStall);

    view.feed("a", vi.fn());
    await vi.advanceTimersByTimeAsync(RENDER_STALL_MS);
    expect(onRenderStall).toHaveBeenCalledTimes(1);
    expect(onRenderStall).toHaveBeenCalledWith(true);

    // A second stuck chunk must not re-fire while latched.
    view.feed("b", vi.fn());
    await vi.advanceTimersByTimeAsync(RENDER_STALL_MS * 2);
    expect(onRenderStall).toHaveBeenCalledTimes(1);

    for (const cb of callbacks) cb();
    expect(onRenderStall).toHaveBeenCalledTimes(2);
    expect(onRenderStall).toHaveBeenLastCalledWith(false);

    view.dispose();
  });

  it("stays silent when callbacks drain normally", async () => {
    vi.spyOn(Terminal.prototype, "write").mockImplementation((_data, cb) => {
      (cb as WriteCallback | undefined)?.();
    });
    vi.useFakeTimers();
    const onRenderStall = vi.fn();
    const view = makeView(onRenderStall);

    const ack = vi.fn();
    view.feed("hello", ack);
    expect(ack).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RENDER_STALL_MS * 2);
    expect(onRenderStall).not.toHaveBeenCalled();

    view.dispose();
  });

  it("stays silent after dispose", async () => {
    vi.spyOn(Terminal.prototype, "write").mockImplementation(() => {});
    vi.useFakeTimers();
    const onRenderStall = vi.fn();
    const view = makeView(onRenderStall);

    view.feed("a", vi.fn());
    view.dispose();
    await vi.advanceTimersByTimeAsync(RENDER_STALL_MS * 2);
    expect(onRenderStall).not.toHaveBeenCalled();
  });
});
