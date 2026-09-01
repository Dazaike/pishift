// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ChatView, type ChatViewHooks } from "../src/renderer/chat-view";
import type { TranscriptRow, TranscriptSnapshot } from "../src/shared/transcript";

function makeView(overrides: Partial<ChatViewHooks> = {}): { view: ChatView; hooks: ChatViewHooks } {
  const hooks: ChatViewHooks = {
    copyText: vi.fn(),
    openExternal: vi.fn(),
    resolveBlob: vi.fn(async () => null),
    openImage: vi.fn(),
    onRevertToTerminal: vi.fn(),
    ...overrides,
  };
  return { view: new ChatView(hooks), hooks };
}

function snapshot(rows: TranscriptRow[], replace = true): TranscriptSnapshot {
  return { ptySessionId: "pty-1", ompSessionId: "s1", file: "/tmp/s1.jsonl", replace, rows };
}

const userRow: TranscriptRow = {
  type: "entry",
  entry: { id: "u1", role: "user", at: 0, model: null, parts: [{ kind: "text", text: "hello" }] },
};

describe("ChatView", () => {
  it("renders assistant thinking separately and expands it by default", () => {
    const { view } = makeView();
    view.apply(
      snapshot([
        userRow,
        {
          type: "entry",
          entry: {
            id: "a1",
            role: "assistant",
            at: 0,
            model: "claude-opus-5",
            parts: [
              { kind: "thinking", text: "internal" },
              { kind: "text", text: "**done**" },
              {
                kind: "tool",
                callId: "c1",
                name: "read",
                intent: "Reading README",
                args: '{"path":"README.md"}',
                result: "body",
                isError: false,
              },
            ],
          },
        },
      ]),
    );

    expect(view.el.querySelectorAll(".chat-rows .chat-row")).toHaveLength(3);
    expect(view.el.querySelector(".chat-thinking-row .chat-who")?.textContent).toBe("Thinking");
    expect(view.el.querySelector(".chat-rows .chat-assistant .chat-md")?.innerHTML).toContain("<strong>done</strong>");
    expect(view.el.querySelector(".chat-model")?.textContent).toBe("claude-opus-5");

    const reasoning = view.el.querySelector<HTMLDetailsElement>("details.chat-thinking");
    const tool = view.el.querySelector<HTMLDetailsElement>("details.chat-tool");
    expect(reasoning?.open).toBe(true);
    expect(tool?.open).toBe(false);
    expect(view.el.querySelector(".chat-tool-badge")?.textContent).toBe("read");
  });

  it("shows the call and its result inside one tool card", () => {
    const { view } = makeView();
    view.apply(
      snapshot([
        {
          type: "entry",
          entry: {
            id: "a1",
            role: "assistant",
            at: 0,
            model: null,
            parts: [{
              kind: "tool",
              callId: "c1",
              name: "bash",
              intent: "Listing files",
              args: '{"command":"ls"}',
              result: "a.txt",
              isError: false,
            }],
          },
        },
      ]),
    );

    const card = view.el.querySelector<HTMLDetailsElement>("details.chat-tool");
    expect(view.el.querySelectorAll("details")).toHaveLength(1);
    expect(card?.querySelector(".chat-summary-text")?.textContent).toBe("Listing files");
    expect(card?.querySelector(".chat-tool-state")?.textContent).toBe("\u2714");
    const bodies = Array.from(card?.querySelectorAll("pre") ?? []).map((p) => p.textContent);
    expect(bodies).toEqual(['{"command":"ls"}', "a.txt"]);
  });

  it("collapses a burst of tools into one activity group", () => {
    const { view } = makeView();
    const tools = ["glob", "grep", "read"].map((name, index) => ({
      kind: "tool" as const,
      callId: `c${index}`,
      name,
      intent: `Running ${name}`,
      args: "",
      result: "done",
      isError: false,
    }));

    view.apply(snapshot([{
      type: "entry",
      entry: { id: "a1", role: "assistant", at: 0, model: null, parts: tools },
    }]));

    const group = view.el.querySelector<HTMLDetailsElement>("details.chat-tool-group");
    expect(group?.open).toBe(false);
    expect(group?.querySelector(".chat-tool-badge")?.textContent).toBe("3 tools");
    expect(group?.querySelector(".chat-summary-text")?.textContent).toBe("Running read");
    expect(group?.querySelectorAll("details.chat-tool")).toHaveLength(3);
  });

  it("summarizes a tool burst with the latest tool instead of earlier failures", () => {
    const { view } = makeView();
    const tools = [
      { kind: "tool" as const, callId: "c1", name: "glob", intent: "Finding files", args: "", result: "done", isError: false },
      { kind: "tool" as const, callId: "c2", name: "bash", intent: "Checking status", args: "", result: "failed", isError: true },
      { kind: "tool" as const, callId: "c3", name: "read", intent: "Reading version", args: "", result: "done", isError: false },
    ];

    view.apply(snapshot([{
      type: "entry",
      entry: { id: "a1", role: "assistant", at: 0, model: null, parts: tools },
    }]));

    const group = view.el.querySelector<HTMLDetailsElement>("details.chat-tool-group");
    expect(group?.classList.contains("chat-tool-error")).toBe(false);
    expect(group?.querySelector(".chat-summary-text")?.textContent).toBe("Reading version");
    expect(group?.querySelector(".chat-tool-state")?.textContent).toBe("\u2714");
  });

  it("expands tool groups without exposing every tool payload", () => {
    const { view } = makeView();
    view.setAutoExpandTools(true);
    view.apply(snapshot([{
      type: "entry",
      entry: {
        id: "a1",
        role: "assistant",
        at: 0,
        model: null,
        parts: [
          { kind: "tool", callId: "c1", name: "glob", intent: null, args: "", result: "done", isError: false },
          { kind: "tool", callId: "c2", name: "grep", intent: null, args: "", result: "done", isError: false },
        ],
      },
    }]));

    const group = view.el.querySelector<HTMLDetailsElement>("details.chat-tool-group");
    const tools = Array.from(view.el.querySelectorAll<HTMLDetailsElement>("details.chat-tool"));
    expect(group?.open).toBe(true);
    expect(tools).toHaveLength(2);
    expect(tools.every((tool) => !tool.open)).toBe(true);

    view.setAutoExpandTools(false);
    expect(group?.open).toBe(false);
  });

  it("opens persisted reasoning by default and can collapse it", () => {
    const { view } = makeView();
    view.apply(snapshot([{
      type: "entry",
      entry: {
        id: "a1",
        role: "assistant",
        at: 0,
        model: null,
        parts: [{ kind: "thinking", text: "weighing options" }],
      },
    }]));

    const reasoning = view.el.querySelector<HTMLDetailsElement>("details.chat-thinking");
    expect(reasoning?.open).toBe(true);
    view.setAutoExpandReasoning(false);
    expect(reasoning?.open).toBe(false);
  });

  it("marks a tool still running and an errored one", () => {
    const { view } = makeView();
    const tool = (id: string, result: string | null, isError: boolean): TranscriptRow => ({
      type: "entry",
      entry: {
        id,
        role: "assistant",
        at: 0,
        model: null,
        parts: [{ kind: "tool", callId: id, name: "bash", intent: null, args: "", result, isError }],
      },
    });

    view.apply(snapshot([tool("a1", null, false), tool("a2", "boom", true)]));

    const cards = view.el.querySelectorAll<HTMLDetailsElement>("details.chat-tool");
    expect(cards[0].classList.contains("chat-tool-running")).toBe(true);
    expect(cards[0].querySelector(".chat-tool-state")?.textContent).toBe("\u2026");
    expect(cards[0].querySelectorAll("pre")).toHaveLength(0);

    expect(cards[1].classList.contains("chat-tool-error")).toBe(true);
    expect(cards[1].querySelector(".chat-tool-state")?.textContent).toBe("\u2716");
  });

  it("appends without rebuilding and replaces on demand", () => {
    const { view } = makeView();
    view.apply(snapshot([userRow]));
    const first = view.el.querySelector(".chat-rows .chat-row");

    view.apply(
      snapshot(
        [
          {
            type: "entry",
            entry: { id: "a1", role: "assistant", at: 0, model: null, parts: [{ kind: "text", text: "hi" }] },
          },
        ],
        false,
      ),
    );
    expect(view.el.querySelectorAll(".chat-rows .chat-row")).toHaveLength(2);
    // The pre-existing node survived: an append must not re-render the list.
    expect(view.el.querySelector(".chat-rows .chat-row")).toBe(first);

    view.apply(snapshot([userRow]));
    expect(view.el.querySelectorAll(".chat-rows .chat-row")).toHaveLength(1);
    expect(view.el.querySelector(".chat-rows .chat-row")).not.toBe(first);
  });

  it("renders a marker row as a divider", () => {
    const { view } = makeView();
    view.apply(
      snapshot([{ type: "marker", marker: { id: "r1", kind: "reset", at: 0, text: "Context cleared" } }]),
    );
    expect(view.el.querySelector(".chat-marker-reset .chat-marker-text")?.textContent).toBe("Context cleared");
  });

  it("routes markdown links to the host instead of navigating", () => {
    const { view, hooks } = makeView();
    view.apply(
      snapshot([
        {
          type: "entry",
          entry: {
            id: "a1",
            role: "assistant",
            at: 0,
            model: null,
            parts: [{ kind: "text", text: "[docs](https://example.com/a)" }],
          },
        },
      ]),
    );

    const link = view.el.querySelector<HTMLAnchorElement>("a.md-link");
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(hooks.openExternal).toHaveBeenCalledWith("https://example.com/a");
  });

  it("shows a revert affordance when the session has no transcript", () => {
    const { view, hooks } = makeView();
    view.apply({ ptySessionId: "pty-1", ompSessionId: null, file: null, replace: true, rows: [] });

    const empty = view.el.querySelector<HTMLDivElement>(".chat-empty");
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toContain("No transcript yet");

    view.el.querySelector<HTMLButtonElement>(".chat-empty-action")?.click();
    expect(hooks.onRevertToTerminal).toHaveBeenCalled();
  });

  it("shows and clears the in-flight row with the activity label", () => {
    const { view } = makeView();
    const inflight = view.el.querySelector<HTMLDivElement>(".chat-inflight");

    view.setActivity("reading", Date.now());
    expect(inflight?.hidden).toBe(false);
    expect(inflight?.textContent).toContain("Reading");

    view.setActivity("idle", null);
    expect(inflight?.hidden).toBe(true);
    view.dispose();
  });

  it("streams the reply live and hands off to the persisted row", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    expect(live?.hidden).toBe(true);

    view.setStream({ kind: "thinking", text: "weighing options" });
    expect(live?.hidden).toBe(false);
    expect(live?.classList.contains("chat-live-thinking")).toBe(true);
    expect(live?.querySelector(".chat-who")?.textContent).toBe("Thinking");

    view.setStream({ kind: "text", text: "**partial** rep" });
    expect(live?.classList.contains("chat-live-thinking")).toBe(false);
    expect(live?.querySelector(".chat-md")?.innerHTML).toContain("<strong>partial</strong>");

    // The persisted assistant row is authoritative; the shadow must step aside.
    view.apply(
      snapshot([
        {
          type: "entry",
          entry: {
            id: "a1",
            role: "assistant",
            at: 0,
            model: null,
            parts: [{ kind: "text", text: "partial reply" }],
          },
        },
      ]),
    );
    expect(live?.hidden).toBe(true);
  });

  it("keeps the finished reply on screen until the transcript catches up", () => {
    vi.useFakeTimers();
    try {
      const { view } = makeView();
      const live = view.el.querySelector<HTMLDivElement>(".chat-live");

      view.setStream({ kind: "text", text: "all done" });
      // Bridge reports the turn over before the 400 ms tail lands.
      view.setStream(null);
      expect(live?.hidden).toBe(false);

      vi.advanceTimersByTime(3100);
      expect(live?.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to a placeholder when an attachment blob is gone", async () => {
    const resolveBlob = vi.fn(async () => null);
    const { view } = makeView({ resolveBlob });
    view.apply(
      snapshot([
        {
          type: "entry",
          entry: {
            id: "u1",
            role: "user",
            at: 0,
            model: null,
            parts: [{ kind: "image", src: "blob:sha256:deadbeef", mimeType: "image/png" }],
          },
        },
      ]),
    );

    expect(resolveBlob).toHaveBeenCalledWith("blob:sha256:deadbeef", "image/png");
    await vi.waitFor(() => {
      expect(view.el.querySelector(".chat-image-missing")).not.toBeNull();
    });
  });
});
