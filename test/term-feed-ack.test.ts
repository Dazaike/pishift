// @vitest-environment jsdom
import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TermView, type TermViewHooks } from "../src/renderer/term-view";

function makeView(): TermView {
  // TermView reads the preload bridge for the ConPTY hint; nothing else here
  // touches it, so the minimum viable stub is enough.
  Object.assign(window, { pishift: { windowsPty: undefined } });
  const hooks: TermViewHooks = {
    write: vi.fn(),
    resize: vi.fn(),
    setTitle: vi.fn(),
    setBusy: vi.fn(),
    notify: vi.fn(),
  };
  return new TermView(hooks);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TermView.feed", () => {
  it("acks once xterm's parser has consumed the chunk", async () => {
    const view = makeView();
    const ack = vi.fn();

    view.feed("hello", ack);
    await vi.waitFor(() => expect(ack).toHaveBeenCalledTimes(1));

    view.dispose();
  });

  it("acks on the deadline when xterm never invokes the write callback", () => {
    // An async parser handler (the image addon decodes off-thread) can hold the
    // callback indefinitely; a paused omp cannot read input either, so the ack
    // must not depend on it.
    vi.spyOn(Terminal.prototype, "write").mockImplementation(() => {});
    vi.useFakeTimers();
    const view = makeView();
    const ack = vi.fn();

    view.feed("hello", ack);
    expect(ack).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    expect(ack).toHaveBeenCalledTimes(1);

    // The late callback landing afterwards must not double-ack this chunk.
    vi.advanceTimersByTime(5000);
    expect(ack).toHaveBeenCalledTimes(1);

    view.dispose();
  });

  it("acks immediately when the write throws past xterm's discard watermark", () => {
    vi.spyOn(Terminal.prototype, "write").mockImplementation(() => {
      throw new Error("write data discarded, use flow control to avoid losing data");
    });
    const view = makeView();
    const ack = vi.fn();

    view.feed("hello", ack);
    expect(ack).toHaveBeenCalledTimes(1);

    view.dispose();
  });

  it("acks a chunk fed to a disposed view", () => {
    const view = makeView();
    view.dispose();
    const ack = vi.fn();

    view.feed("hello", ack);
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
