// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ChatView, MAX_CHAT_ZOOM, MIN_CHAT_ZOOM, type ChatViewHooks } from "../src/renderer/chat-view";
import type { TranscriptRow, TranscriptSnapshot } from "../src/shared/transcript";

function makeView(overrides: Partial<ChatViewHooks> = {}): { view: ChatView; hooks: ChatViewHooks } {
  const hooks: ChatViewHooks = {
    copyText: vi.fn(),
    openExternal: vi.fn(),
    resolveBlob: vi.fn(async () => null),
    openImage: vi.fn(),
    onRevertToTerminal: vi.fn(),
    onStarterPrompt: vi.fn(),
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
  it("puts thinking and tool steps in one activity section, prose in its own row", () => {
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

    const activity = view.el.querySelector<HTMLDetailsElement>("details.chat-activity");
    expect(activity).not.toBeNull();
    expect(activity?.querySelector(".chat-activity-count")?.textContent).toBe("\u00b7 1 read");
    expect(activity?.querySelectorAll(".chat-activity-steps > *")).toHaveLength(2);
    expect(view.el.querySelector(".chat-rows .chat-assistant .chat-md")?.innerHTML).toContain("<strong>done</strong>");

    const reasoning = view.el.querySelector<HTMLDetailsElement>("details.chat-thinking");
    const tool = view.el.querySelector<HTMLDetailsElement>("details.chat-act");
    expect(activity?.open).toBe(false);
    expect(reasoning?.open).toBe(false);
    expect(tool?.open).toBe(false);
    expect(tool?.querySelector(".chat-act-verb")?.textContent).toBe("Read");
    expect(tool?.querySelector(".chat-act-subject")?.textContent).toBe("README.md");
  });

  it("keeps a think/tool/think run inside a single activity section", () => {
    const { view } = makeView();
    const think = (id: string): TranscriptRow => ({
      type: "entry",
      entry: { id, role: "assistant", at: 0, model: "m", parts: [{ kind: "thinking", text: id }] },
    });
    const call = (id: string): TranscriptRow => ({
      type: "entry",
      entry: {
        id,
        role: "assistant",
        at: 0,
        model: "m",
        parts: [{ kind: "tool", callId: id, name: "read", intent: null, args: "", result: "ok", isError: false }],
      },
    });
    const reply: TranscriptRow = {
      type: "entry",
      entry: { id: "r", role: "assistant", at: 0, model: "m", parts: [{ kind: "text", text: "answer" }] },
    };

    view.apply(snapshot([think("t1"), call("c1"), think("t2"), call("c2"), think("t3"), reply]));

    const sections = view.el.querySelectorAll<HTMLDetailsElement>("details.chat-activity");
    expect(sections).toHaveLength(1);
    expect(sections[0].querySelectorAll(".chat-activity-steps > *")).toHaveLength(5);
    expect(sections[0].querySelector(".chat-activity-count")?.textContent).toBe("\u00b7 2 reads");

    // Prose ends the sequence; a later call opens a new section.
    view.apply(snapshot([call("c3")], false));
    expect(view.el.querySelectorAll("details.chat-activity")).toHaveLength(2);
  });

  it("shows the call and its result inside one action row", () => {
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

    const card = view.el.querySelector<HTMLDetailsElement>("details.chat-act");
    expect(view.el.querySelectorAll("details.chat-act")).toHaveLength(1);
    expect(card?.querySelector(".chat-act-verb")?.textContent).toBe("Ran");
    expect(card?.querySelector(".chat-act-subject")?.textContent).toBe("Listing files");
    expect(card?.querySelector(".chat-act-detail")?.textContent).toBe("ls");
    expect(card?.querySelector(".chat-act-state")).toBeNull();
    // The same polished body in both densities: command card, then output.
    const pres = Array.from(card?.querySelectorAll("pre") ?? []).map((pre) => pre.textContent);
    expect(pres[0]).toBe("ls");
    expect(pres.join("\n")).toContain("a.txt");
    expect(card?.querySelector(".chat-act-raw")).toBeNull();
  });

  it("swaps the polished body for raw text only in compact, and only when asked", () => {
    const { view } = makeView();
    view.setRawTextOnExpand(true);
    view.apply(snapshot([{
      type: "entry",
      entry: {
        id: "a1",
        role: "assistant",
        at: 0,
        model: null,
        parts: [{
          kind: "tool",
          callId: "c1",
          name: "read",
          intent: "Reading chat view",
          args: '{"path":"src/renderer/chat-view.ts:24-61"}',
          result: "24 | const x = 1",
          isError: false,
        }],
      },
    }]));

    const raw = view.el.querySelector(".chat-act-raw")?.textContent ?? "";
    expect(raw).toContain("Read src/renderer/chat-view.ts:24-61");
    expect(raw).toContain("Lines 24\u201361");
    expect(raw).toContain("24 | const x = 1");
    expect(view.el.querySelector(".chat-act-args")).toBeNull();

    // Detailed always uses the polished body, whatever the saved preference.
    view.setToolDensity("detailed");
    expect(view.el.querySelector(".chat-act-raw")).toBeNull();
    expect(view.el.querySelector(".chat-act-out")).not.toBeNull();
    expect(view.el.querySelector(".chat-act-meta")?.textContent).toBe("Lines 24\u201361");

    // Preference survives the trip back.
    view.setToolDensity("compact");
    expect(view.el.querySelector(".chat-act-raw")).not.toBeNull();
  });

  it("renders a write as an all-green diff with every line, not a JSON dump", () => {
    const { view } = makeView();
    const content = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    view.setToolDensity("detailed");
    view.apply(snapshot([{
      type: "entry",
      entry: {
        id: "a1",
        role: "assistant",
        at: 0,
        model: null,
        parts: [{
          kind: "tool",
          callId: "c1",
          name: "write",
          intent: "Writing module",
          args: JSON.stringify({ path: "C:/temp/x.ts", content }),
          result: "Successfully wrote 300 bytes to C:/temp/x.ts",
        isError: false,
        }],
      },
    }]));

    const added = view.el.querySelectorAll(".chat-diff-add");
    expect(added).toHaveLength(30);
    expect(added[29].textContent).toBe("+ line 30");
    // Scrolled, never truncated; and no raw args / acknowledgement underneath.
    expect(view.el.querySelector(".chat-diff-more")).toBeNull();
    expect(view.el.querySelector(".chat-act-args")).toBeNull();
    expect(view.el.textContent).not.toContain("Successfully wrote");
  });

  it("adds the sequence duration to the activity header once the span is real", () => {
    const { view } = makeView();
    const call = (id: string, at: number): TranscriptRow => ({
      type: "entry",
      entry: {
        id,
        role: "assistant",
        at,
        model: "m",
        parts: [{ kind: "tool", callId: id, name: "read", intent: null, args: "", result: "ok", isError: false }],
      },
    });

    // Same timestamp on every row: no invented duration.
    view.apply(snapshot([call("c1", 1000), call("c2", 1000)]));
    expect(view.el.querySelector(".chat-activity-count")?.textContent).toBe("\u00b7 2 reads");

    view.apply(snapshot([call("c1", 1000), call("c2", 1000 + 184_000)]));
    expect(view.el.querySelector(".chat-activity-count")?.textContent).toBe("\u00b7 2 reads \u00b7 3m 04s");
  });

  it("gives every tool call its own borderless row, latest state wins for the run", () => {
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

    const rows = Array.from(view.el.querySelectorAll<HTMLDetailsElement>("details.chat-act"));
    expect(rows).toHaveLength(3);
    // No per-call card class at any density: only the open state changes.
    expect(rows.map((row) => row.classList.contains("chat-act-error"))).toEqual([false, true, false]);
  });

  it("lets density decide only what starts expanded", () => {
    const { view } = makeView();
    view.apply(snapshot([{
      type: "entry",
      entry: {
        id: "a1",
        role: "assistant",
        at: 0,
        model: null,
        parts: [
          { kind: "thinking", text: "weighing options" },
          { kind: "tool", callId: "c1", name: "glob", intent: null, args: "", result: "done", isError: false },
        ],
      },
    }]));

    const closed = view.el.querySelectorAll<HTMLDetailsElement>("details.chat-activity, details.chat-act, details.chat-thinking");
    expect(closed).toHaveLength(3);
    expect(Array.from(closed).every((node) => !node.open)).toBe(true);

    view.setToolDensity("detailed");
    const open = view.el.querySelectorAll<HTMLDetailsElement>("details.chat-activity, details.chat-act, details.chat-thinking");
    expect(open).toHaveLength(3);
    expect(Array.from(open).every((node) => node.open)).toBe(true);

    view.setToolDensity("compact");
    const reclosed = view.el.querySelectorAll<HTMLDetailsElement>("details.chat-activity, details.chat-act, details.chat-thinking");
    expect(Array.from(reclosed).every((node) => !node.open)).toBe(true);
  });

  it("keeps the rendered conversation when the watcher re-resolves an empty transcript", () => {
    const { view } = makeView();
    view.apply(snapshot([{
      type: "entry",
      entry: { id: "a1", role: "assistant", at: 0, model: null, parts: [{ kind: "text", text: "hello" }] },
    }]));
    expect(view.el.querySelectorAll(".chat-rows .chat-row")).toHaveLength(1);

    // Late `ompSessionId` → re-subscribe → brand-new, still-empty transcript file.
    view.apply({ ptySessionId: "pty-1", ompSessionId: "omp-2", file: "/tmp/new.jsonl", replace: true, rows: [] });
    expect(view.el.querySelectorAll(".chat-rows .chat-row")).toHaveLength(1);

    // A real session switch clears explicitly.
    view.clearTranscript();
    expect(view.el.querySelectorAll(".chat-rows .chat-row")).toHaveLength(0);
  });

  it("folds reasoning away once the reply's own text starts, only when enabled", () => {
    const reasoningRow: TranscriptRow = {
      type: "entry",
      entry: {
        id: "a1",
        role: "assistant",
        at: 0,
        model: null,
        parts: [{ kind: "thinking", text: "weighing options" }],
      },
    };

    const off = makeView().view;
    off.setToolDensity("detailed");
    off.apply(snapshot([reasoningRow]));
    off.setStream({ kind: "text", text: "here is the answer" });
    expect(off.el.querySelector<HTMLDetailsElement>("details.chat-thinking")?.open).toBe(true);

    const on = makeView().view;
    on.setToolDensity("detailed");
    on.setCollapseReasoningOnReply(true);
    on.apply(snapshot([reasoningRow]));
    const details = on.el.querySelector<HTMLDetailsElement>("details.chat-thinking");
    expect(details?.open).toBe(true);

    // Reasoning deltas must not trigger the fold — only the reply's prose does.
    on.setStream({ kind: "thinking", text: "still weighing" });
    expect(details?.open).toBe(true);

    on.setStream({ kind: "text", text: "here is the answer" });
    expect(details?.open).toBe(false);
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

    const cards = view.el.querySelectorAll<HTMLDetailsElement>("details.chat-act");
    expect(cards[0].classList.contains("chat-act-running")).toBe(true);
    expect(cards[0].querySelector(".chat-act-state")?.textContent).toBe("\u2026");
    expect(cards[0].querySelectorAll("pre")).toHaveLength(0);

    expect(cards[1].classList.contains("chat-act-error")).toBe(true);
    expect(cards[1].querySelector(".chat-act-state")?.textContent).toBe("\u2716");
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

  it("offers a landing screen with starter prompts when the session has no transcript", () => {
    const { view, hooks } = makeView();
    view.setSessionMeta({ model: "claude-opus-5", cwd: "C:/repo" });
    view.apply({ ptySessionId: "pty-1", ompSessionId: null, file: null, replace: true, rows: [] });

    const empty = view.el.querySelector<HTMLDivElement>(".chat-empty");
    expect(empty?.hidden).toBe(false);

    const chips = Array.from(view.el.querySelectorAll(".chat-landing-chip")).map((c) => c.textContent);
    expect(chips).toEqual(["claude-opus-5", "C:/repo"]);

    const prompts = view.el.querySelectorAll<HTMLButtonElement>(".chat-landing-prompt");
    expect(prompts.length).toBeGreaterThan(0);
    prompts[0].click();
    expect(hooks.onStarterPrompt).toHaveBeenCalledWith(prompts[0].textContent);

    view.el.querySelector<HTMLButtonElement>(".chat-empty-action")?.click();
    expect(hooks.onRevertToTerminal).toHaveBeenCalled();
  });

  it("echoes a just-sent prompt and retires it when the persisted row lands", () => {
    const { view } = makeView();

    view.showPendingUser("build me a thing");
    const echoed = view.el.querySelectorAll(".chat-rows .chat-user");
    expect(echoed).toHaveLength(1);
    expect(echoed[0].textContent).toContain("build me a thing");
    expect(view.el.querySelector<HTMLDivElement>(".chat-empty")?.hidden).toBe(true);

    view.apply(
      snapshot(
        [
          {
            type: "entry",
            entry: {
              id: "u9",
              role: "user",
              at: 0,
              model: null,
              parts: [{ kind: "text", text: "build me a thing" }],
            },
          },
        ],
        false,
      ),
    );

    // Exactly one copy: the optimistic echo is gone, the persisted row remains.
    expect(view.el.querySelectorAll(".chat-rows .chat-user")).toHaveLength(1);
  });

  it("keeps the rendered conversation when the watcher resolves no transcript", () => {
    const { view } = makeView();
    view.apply(snapshot([userRow]));
    expect(view.el.querySelectorAll(".chat-rows .chat-row")).toHaveLength(1);

    // What a `/resume` republish looks like: the bridge reports a session id
    // whose transcript file does not exist yet, so nothing resolves.
    view.apply({ ptySessionId: "pty-1", ompSessionId: "new-id", file: null, replace: true, rows: [] });

    expect(view.el.querySelectorAll(".chat-rows .chat-row")).toHaveLength(1);
    expect(view.el.querySelector<HTMLDivElement>(".chat-empty")?.hidden).toBe(true);

    // A real transcript still replaces the view.
    view.apply(
      snapshot([
        {
          type: "entry",
          entry: { id: "a1", role: "assistant", at: 0, model: null, parts: [{ kind: "text", text: "resumed" }] },
        },
      ]),
    );
    expect(view.el.querySelector(".chat-rows .chat-assistant")?.textContent).toContain("resumed");
  });

  it("dismisses the empty overlay as soon as a turn starts, before any row persists", () => {
    const { view } = makeView();
    view.setEmptyReason("no-session");
    const empty = view.el.querySelector<HTMLDivElement>(".chat-empty");
    expect(empty?.hidden).toBe(false);

    // omp only writes a transcript row once a turn completes; the activity
    // pill and live stream card must still surface through the overlay.
    view.setActivity("responding", Date.now());
    expect(empty?.hidden).toBe(true);
  });

  it("dismisses the empty overlay once live stream text arrives", () => {
    const { view } = makeView();
    view.setEmptyReason("loading");
    const empty = view.el.querySelector<HTMLDivElement>(".chat-empty");
    expect(empty?.hidden).toBe(false);

    view.setStream({ kind: "text", text: "partial reply" });
    expect(empty?.hidden).toBe(true);
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
    vi.useFakeTimers();
    try {
      // The persisted assistant row is authoritative, but the live view lingers 3s
      // so the reader sees the final blur/animation settle completely.
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
      expect(live?.hidden).toBe(false);

      vi.advanceTimersByTime(3100);
      expect(live?.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  it("zooms via the CSS zoom factor and clamps at the range edges", () => {
    const { view } = makeView();
    const wrap = view.el.querySelector<HTMLDivElement>(".chat-zoom-wrap");
    expect(view.getZoom()).toBe(1);

    view.zoomIn();
    view.zoomIn();
    view.zoomIn();
    expect(view.getZoom()).toBe(1.3);
    expect(wrap?.style.zoom).toBe("1.3");

    for (let i = 0; i < 20; i++) view.zoomIn();
    expect(view.getZoom()).toBe(MAX_CHAT_ZOOM);

    view.resetZoom();
    expect(view.getZoom()).toBe(1);

    for (let i = 0; i < 20; i++) view.zoomOut();
    expect(view.getZoom()).toBe(MIN_CHAT_ZOOM);
  });

  it("fades in only the newly streamed tail, not the already-rendered prefix", () => {
    const { view } = makeView();
    view.setStream({ kind: "text", text: "Hello" });
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    // The first delta has nothing to diff against, so nothing is marked fresh yet.
    expect(live?.querySelectorAll(".chat-stream-new")).toHaveLength(0);

    view.setStream({ kind: "text", text: "Hello world" });
    const fresh = Array.from(live?.querySelectorAll(".chat-stream-new") ?? []);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.some((span) => span.textContent?.includes("world"))).toBe(true);
    expect(fresh.some((span) => span.textContent?.trim() === "Hello")).toBe(false);
  });

  it("renders markdown while the reply is still being written", () => {
    const { view } = makeView();
    const live = (): HTMLElement | null => view.el.querySelector(".chat-live .chat-md");

    view.setStream({ kind: "text", text: "## Plan" });
    expect(live()?.querySelector("h2")?.textContent).toBe("Plan");

    view.setStream({ kind: "text", text: "## Plan\n\nUse **bold**" });
    expect(live()?.querySelector("strong")?.textContent).toBe("bold");

    // A finished earlier block is not re-rendered as the tail grows.
    const heading = live()?.querySelector("h2");
    view.setStream({ kind: "text", text: "## Plan\n\nUse **bold** and `code`" });
    expect(live()?.querySelector("code")?.textContent).toBe("code");
    expect(live()?.querySelector("h2")).toBe(heading);

    // A half-typed fence stays one block instead of one paragraph per line.
    view.setStream({ kind: "text", text: "## Plan\n\nUse **bold** and `code`\n\n```ts\nconst a = 1;" });
    expect(live()?.querySelector("pre")).not.toBeNull();
  });

  it("keeps a word's trailing punctuation in the same box as the word", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");

    // omp splits a word across deltas constantly; each fragment in its own
    // inline-block span would let the "." or "’s" wrap onto the next line.
    view.setStream({ kind: "text", text: "Nutella is" });
    view.setStream({ kind: "text", text: "Nutella is Ferrero" });
    view.setStream({ kind: "text", text: "Nutella is Ferrero’s" });
    view.setStream({ kind: "text", text: "Nutella is Ferrero’s smear" });
    view.setStream({ kind: "text", text: "Nutella is Ferrero’s smear." });

    const boxes = Array.from(live?.querySelectorAll(".chat-stream-new") ?? []);
    // Only the newest delta animates; earlier words have settled into the
    // re-rendered markdown, so no orphaned "." or "’s" box can exist.
    expect(boxes).toHaveLength(1);
    expect(boxes[0].textContent).toBe("smear.");
    // Whitespace lives outside the animated boxes, so wrapped lines don't indent.
    expect(live?.querySelector(".chat-md")?.textContent).toBe("Nutella is Ferrero’s smear.");
  });

  it("collapses a repeated same-model assistant header", () => {
    const { view } = makeView();
    const entryA: TranscriptRow = {
      type: "entry",
      entry: { id: "a1", role: "assistant", at: 1000, model: "gpt-5", parts: [{ kind: "text", text: "first" }] },
    };
    const entryB: TranscriptRow = {
      type: "entry",
      entry: { id: "a2", role: "assistant", at: 2000, model: "gpt-5", parts: [{ kind: "text", text: "second" }] },
    };
    const entryC: TranscriptRow = {
      type: "entry",
      entry: { id: "a3", role: "assistant", at: 3000, model: "claude", parts: [{ kind: "text", text: "third" }] },
    };
    view.apply(snapshot([entryA, entryB, entryC]));

    const rows = view.el.querySelectorAll(".chat-rows .chat-row");
    expect(rows).toHaveLength(3);

    expect(rows[0].querySelector(".chat-head")).not.toBeNull();
    expect(rows[0].classList.contains("chat-row-grouped")).toBe(false);

    // Same role, same model as the previous row: the header collapses.
    expect(rows[1].querySelector(".chat-head")).toBeNull();
    expect(rows[1].classList.contains("chat-row-grouped")).toBe(true);

    // Different model breaks the run: full header returns.
    expect(rows[2].querySelector(".chat-head")).not.toBeNull();
    expect(rows[2].classList.contains("chat-row-grouped")).toBe(false);
  });
});
