// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ChatView, MAX_CHAT_ZOOM, MIN_CHAT_ZOOM, type ChatViewHooks } from "../src/renderer/chat-view";
import type { TranscriptRow, TranscriptSnapshot } from "../src/shared/transcript";

function makeView(overrides: Partial<ChatViewHooks> = {}): { view: ChatView; hooks: ChatViewHooks } {
  const hooks: ChatViewHooks = {
    copyText: vi.fn(),
    openExternal: vi.fn(),
    resolveLocalImage: vi.fn(async () => null),
    resolveBlob: vi.fn(async () => null),
    openImage: vi.fn(),
    onRevertToTerminal: vi.fn(),
    onStarterPrompt: vi.fn(),
    onPlanAction: vi.fn(),
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
    expect(reasoning?.querySelector(".chat-thinking-label")?.textContent).toBe("Thought");
    expect(reasoning?.querySelector(".chat-summary-text")?.textContent).toBe("internal");
    expect(tool?.open).toBe(false);
    expect(tool?.querySelector(".chat-act-verb")?.textContent).toBe("Read");
    expect(tool?.querySelector(".chat-act-subject")?.textContent).toBe("README.md");
  });

  it("collapses a multi-line thought into a single-line summary preview", () => {
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
            model: "m",
            parts: [{ kind: "thinking", text: "Let me check the file.\n\nIt looks fine." }],
          },
        },
      ]),
    );

    const summary = view.el.querySelector<HTMLDetailsElement>("details.chat-thinking .chat-summary-text");
    expect(summary?.textContent).toBe("Let me check the file. It looks fine.");
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

    const sections = view.el.querySelectorAll<HTMLDetailsElement>(".chat-rows details.chat-activity");
    expect(sections).toHaveLength(1);
    expect(sections[0].querySelectorAll(".chat-activity-steps > *")).toHaveLength(5);
    expect(sections[0].querySelector(".chat-activity-count")?.textContent).toBe("\u00b7 2 reads");

    // Prose ends the sequence; a later call opens a new section.
    view.apply(snapshot([call("c3")], false));
    expect(view.el.querySelectorAll(".chat-rows details.chat-activity")).toHaveLength(2);
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

    const closed = view.el.querySelectorAll<HTMLDetailsElement>(".chat-rows details.chat-activity, .chat-rows details.chat-act, .chat-rows details.chat-thinking");
    expect(closed).toHaveLength(3);
    expect(Array.from(closed).every((node) => !node.open)).toBe(true);

    view.setToolDensity("detailed");
    const open = view.el.querySelectorAll<HTMLDetailsElement>(".chat-rows details.chat-activity, .chat-rows details.chat-act, .chat-rows details.chat-thinking");
    expect(open).toHaveLength(3);
    expect(Array.from(open).every((node) => node.open)).toBe(true);

    view.setToolDensity("compact");
    const reclosed = view.el.querySelectorAll<HTMLDetailsElement>(".chat-rows details.chat-activity, .chat-rows details.chat-act, .chat-rows details.chat-thinking");
    expect(Array.from(reclosed).every((node) => !node.open)).toBe(true);
  });

  it("auto-expands activity sections in compact mode only when enabled", () => {
    const { view } = makeView();
    const row: TranscriptRow = {
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
    };

    view.setAutoExpandActivity(true);
    view.apply(snapshot([row]));
    const opened = view.el.querySelectorAll<HTMLDetailsElement>(".chat-rows details.chat-activity, .chat-rows details.chat-act, .chat-rows details.chat-thinking");
    expect(opened).toHaveLength(3);
    expect(Array.from(opened).every((node) => node.open)).toBe(true);

    view.setAutoExpandActivity(false);
    const closed = view.el.querySelectorAll<HTMLDetailsElement>(".chat-rows details.chat-activity, .chat-rows details.chat-act, .chat-rows details.chat-thinking");
    expect(Array.from(closed).every((node) => !node.open)).toBe(true);
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
    view.setActivity("thinking", Date.now());
    expect(view.el.querySelector<HTMLDivElement>(".chat-live")?.hidden).toBe(false);
    view.clearTranscript();
    expect(view.el.querySelector<HTMLDivElement>(".chat-live")?.hidden).toBe(true);
    expect(view.el.querySelectorAll(".chat-rows .chat-row")).toHaveLength(0);
  });

  it("folds persisted and live reasoning once reply prose starts when enabled", () => {
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

    const view = makeView().view;
    view.setToolDensity("detailed");
    view.setCollapseReasoningOnReply(true);
    view.apply(snapshot([reasoningRow]));
    const persisted = view.el.querySelector<HTMLDetailsElement>(".chat-rows details.chat-thinking");
    expect(persisted?.open).toBe(true);

    view.setStream({ thinking: "still weighing", text: "" });
    const band = view.el.querySelector<HTMLDivElement>(".chat-live-thought");
    expect(band?.hidden).toBe(false);

    view.setStream({ thinking: "still weighing", text: "here is the answer" });
    expect(persisted?.open).toBe(false);
    expect(band?.hidden).toBe(true);
    // The thought joins the sequence already on screen rather than opening a
    // second `ACTIVITY` beside it.
    const folded = view.el.querySelectorAll<HTMLDetailsElement>(".chat-rows details.chat-thinking");
    expect(folded[folded.length - 1]?.textContent).toContain("still weighing");
    expect(folded[folded.length - 1]?.open).toBe(false);
  });

  it("streams reasoning in its own band, then folds it into Activity as a Thought", () => {
    const { view } = makeView();
    view.setStream({ thinking: "weighing", text: "" });
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    const agent = live?.querySelector<HTMLDivElement>(".chat-row.chat-assistant");
    const band = live?.querySelector<HTMLDivElement>(".chat-live-thought");
    // Nothing has been written yet, so no empty Agent box under the band.
    expect(agent?.hidden).toBe(true);
    expect(band?.hidden).toBe(false);
    expect(band?.textContent).toBe("weighing");
    // No disclosure while it is live: the band is plain streaming prose.
    expect(live?.querySelector("details.chat-thinking")).toBeNull();

    view.setStream({ thinking: "weighing", text: "answer" });
    const folded = live?.querySelector<HTMLDetailsElement>("details.chat-activity details.chat-thinking");
    expect(band?.hidden).toBe(true);
    expect(folded?.querySelector(".chat-thinking-label")?.textContent).toBe("Thought");
    expect(folded?.querySelector(".chat-summary-text")?.textContent).toBe("weighing");
    expect(agent?.hidden).toBe(false);
    expect(agent?.querySelector(".chat-who")?.textContent).toBe("Agent");
    expect(live?.querySelector(".chat-live-text-body")?.textContent).toContain("answer");
  });

  it("mints one Thought per thought, not one per streamed update", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    const band = () => live?.querySelector<HTMLDivElement>(".chat-live-thought");
    const folded = () => live?.querySelectorAll("details.chat-activity details.chat-thinking") ?? [];

    view.setStream({ thinking: "picking a file", text: "" });
    // Activity republishes on every delta; none of that may fold the band.
    view.setActivity("thinking", Date.now());
    view.setStream({ thinking: "picking a file to read", text: "" });
    view.setActivity("reading", Date.now());
    view.setStream({ thinking: "picking a file to read now", text: "" });
    expect(band()?.hidden).toBe(false);
    expect(folded()).toHaveLength(0);

    // A buffer that is not an extension of the last one is a second thought:
    // the first is finished, folds exactly once, and the band takes the new one.
    view.setStream({ thinking: "the file is large", text: "" });
    expect(band()?.hidden).toBe(false);
    expect(band()?.textContent).toBe("the file is large");
    expect(folded()).toHaveLength(1);
    expect(folded()[0]?.textContent).toContain("picking a file to read now");

    // A thought still growing keeps the band even though a reply exists.
    view.setStream({ thinking: "the file is large, so I will skim", text: "here" });
    expect(band()?.hidden).toBe(false);
    expect(folded()).toHaveLength(1);

    // Prose moving while the thought stands still is what ends it — once.
    view.setStream({ thinking: "the file is large, so I will skim", text: "here is" });
    view.setStream({ thinking: "the file is large, so I will skim", text: "here is more" });
    expect(band()?.hidden).toBe(true);
    expect(folded()).toHaveLength(2);
    expect(folded()[1]?.textContent).toContain("so I will skim");
    view.dispose();
  });

  it("keeps reasoning out of the live band when the setting is off", () => {
    const { view } = makeView();
    view.setAutoShowLiveThinking(false);
    view.setStream({ thinking: "weighing", text: "" });
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    // Off means it never streams in the open: it lands folded in the sequence.
    expect(live?.querySelector<HTMLDivElement>(".chat-live-thought")?.hidden).toBe(true);
    const folded = live?.querySelector<HTMLDetailsElement>("details.chat-thinking");
    expect(folded?.textContent).toContain("weighing");
    expect(folded?.open).toBe(false);
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
    view.setSessionMeta({ model: "claude-opus-5", cwd: "C:/repo", mcpServers: ["chrome-devtools"], mcpFailed: ["classroom"] });
    view.apply({ ptySessionId: "pty-1", ompSessionId: null, file: null, replace: true, rows: [] });

    const empty = view.el.querySelector<HTMLDivElement>(".chat-empty");
    expect(empty?.hidden).toBe(false);

    expect(view.el.querySelector(".chat-landing-mcp-label")?.textContent).toBe("MCP");
    const chips = Array.from(view.el.querySelectorAll(".chat-landing-chip")).map((c) => c.textContent);
    expect(chips).toEqual(["claude-opus-5", "C:/repo", "chrome-devtools", "classroom"]);
    expect(view.el.querySelector(".chat-landing-chip-mcp")?.textContent).toBe("chrome-devtools");
    expect(view.el.querySelector(".chat-landing-chip-mcp-failed")?.textContent).toBe("classroom");

    const prompts = view.el.querySelectorAll<HTMLButtonElement>(".chat-landing-prompt");
    expect(prompts.length).toBeGreaterThan(0);
    prompts[0].click();
    expect(hooks.onStarterPrompt).toHaveBeenCalledWith(prompts[0].textContent);

    view.el.querySelector<HTMLButtonElement>(".chat-empty-action")?.click();
    expect(hooks.onRevertToTerminal).toHaveBeenCalled();
  });

  it("echoes a just-sent prompt and retires it when the persisted row lands", () => {
    const { view } = makeView();

    view.showPendingUser("build me a thing", []);
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

  it("echoes text and local image attachments before the transcript persists", async () => {
    let resolvePreview: (url: string | null) => void = () => {};
    const resolveLocalImage = vi.fn(
      () => new Promise<string | null>((resolve) => { resolvePreview = resolve; }),
    );
    const { view } = makeView({ resolveLocalImage });

    view.showPendingUser("look at this", ["C:/tmp/screenshot.png"]);

    const pending = view.el.querySelectorAll(".chat-rows .chat-user");
    expect(pending).toHaveLength(1);
    expect(pending[0].textContent).toContain("look at this");
    expect(pending[0].querySelector(".chat-image-pending")?.textContent).toBe("Loading image…");
    expect(resolveLocalImage).toHaveBeenCalledWith("C:/tmp/screenshot.png");

    resolvePreview("data:image/png;base64,preview");
    await vi.waitFor(() => {
      expect(pending[0].querySelector<HTMLImageElement>(".chat-image")?.src).toBe("data:image/png;base64,preview");
    });

    view.apply(
      snapshot(
        [{
          type: "entry",
          entry: {
            id: "u10",
            role: "user",
            at: 0,
            model: null,
            parts: [
              { kind: "text", text: "look at this" },
              { kind: "image", src: "data:image/png;base64,persisted", mimeType: "image/png" },
            ],
          },
        }],
        false,
      ),
    );

    expect(view.el.querySelectorAll(".chat-rows .chat-user")).toHaveLength(1);
    expect(view.el.querySelector<HTMLImageElement>(".chat-image")?.src).toBe("data:image/png;base64,persisted");
  });

  it("echoes image-only submissions before the transcript persists", async () => {
    const resolveLocalImage = vi.fn(async () => "data:image/png;base64,preview");
    const { view } = makeView({ resolveLocalImage });

    view.showPendingUser("", ["C:/tmp/screenshot.png"]);

    expect(view.el.querySelectorAll(".chat-rows .chat-user")).toHaveLength(1);
    expect(resolveLocalImage).toHaveBeenCalledWith("C:/tmp/screenshot.png");
    await vi.waitFor(() => {
      expect(view.el.querySelector<HTMLImageElement>(".chat-image")?.src).toBe("data:image/png;base64,preview");
    });
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

    view.setStream({ thinking: "", text: "partial reply" });
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

  it("shows live Activity before a stable Agent card and hands it off to persistence", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    expect(live?.hidden).toBe(true);

    view.setActivity("thinking", Date.now());
    const activity = live?.querySelector<HTMLDetailsElement>("details.chat-activity");
    const agent = live?.querySelector<HTMLDivElement>(".chat-row.chat-assistant");
    expect(live?.hidden).toBe(false);
    expect(activity?.querySelector(".chat-activity-title")?.textContent).toBe("Activity");
    expect(live?.firstElementChild).toBe(activity);
    expect(live?.lastElementChild).toBe(agent);
    expect(agent?.querySelector(".chat-who")?.textContent).toBe("Agent");

    // While it is being written, reasoning streams in its own band — not inside
    // the Activity box and not behind a disclosure.
    view.setStream({ thinking: "weighing options", text: "" });
    expect(agent?.hidden).toBe(true);
    const thought = live?.querySelector<HTMLDivElement>(".chat-live-thought");
    expect(thought?.hidden).toBe(false);
    expect(thought?.textContent).toContain("weighing options");
    expect(live?.querySelector("details.chat-thinking")).toBeNull();

    // Reply prose means the thought is finished, so it folds into the sequence.
    view.setStream({ thinking: "weighing options", text: "**partial** rep" });
    expect(agent?.hidden).toBe(false);
    expect(thought?.hidden).toBe(true);
    const folded = activity?.querySelector<HTMLDetailsElement>("details.chat-thinking");
    expect(folded?.textContent).toContain("weighing options");
    expect(folded?.open).toBe(false);
    expect(live?.querySelector(".chat-live-text-body")?.innerHTML).toContain("<strong>partial</strong>");
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

  it("keeps streaming into the live turn after a mid-turn row persists", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");

    vi.useFakeTimers();
    try {
      view.setStream({ thinking: "weighing", text: "" });
      // omp persists an assistant message mid-turn whenever the agent hands off
      // to a tool; the turn itself keeps running.
      view.apply(
        snapshot([
          {
            type: "entry",
            entry: {
              id: "a1",
              role: "assistant",
              at: 0,
              model: null,
              parts: [{ kind: "text", text: "first reply" }],
            },
          },
        ]),
      );
      expect(live?.classList.contains("chat-live-handoff")).toBe(true);

      view.setStream({ thinking: "weighing\nnow verifying", text: "" });
      expect(live?.hidden).toBe(false);
      expect(live?.classList.contains("chat-live-handoff")).toBe(false);
      expect(live?.querySelector<HTMLDivElement>(".chat-live-thought")?.textContent).toContain("now verifying");

      // New content cancelled the settle timer, so the rest of the turn stays visible.
      vi.advanceTimersByTime(3100);
      expect(live?.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a stream echo of the message that just persisted", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");

    vi.useFakeTimers();
    try {
      view.setStream({ thinking: "weighing", text: "first reply" });
      view.apply(
        snapshot([
          {
            type: "entry",
            entry: {
              id: "a1",
              role: "assistant",
              at: 0,
              model: null,
              parts: [{ kind: "text", text: "first reply" }],
            },
          },
        ]),
      );
      expect(live?.classList.contains("chat-live-handoff")).toBe(true);

      // A trailing republish of the same buffers must not resurrect the wrapper
      // as a duplicate of the row now rendered below it.
      view.setStream({ thinking: "weighing", text: "first reply" });
      expect(live?.classList.contains("chat-live-handoff")).toBe(true);

      vi.advanceTimersByTime(3100);
      expect(live?.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the live Activity section only when the density says so", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    const section = () => live?.querySelector<HTMLDetailsElement>("details.chat-activity");

    // Reasoning streams in its own band, so compact density keeps the finished
    // steps folded exactly like a persisted row.
    view.setActivity("thinking", Date.now());
    expect(section()?.open).toBe(false);

    view.setAutoExpandActivity(true);
    view.clearTranscript();
    view.setActivity("thinking", Date.now());
    expect(section()?.open).toBe(true);
    view.dispose();
  });

  it("renders the live thinking band as markdown", () => {
    const { view } = makeView();
    const band = () => view.el.querySelector<HTMLDivElement>(".chat-live-thought-text");

    view.setStream({ thinking: "**Planning** the layout", text: "" });
    expect(band()?.querySelector("strong")?.textContent).toBe("Planning");
    expect(band()?.textContent).not.toContain("**");

    view.setStream({ thinking: "**Planning** the layout\n\nNow `routing`", text: "" });
    expect(band()?.querySelector("code")?.textContent).toBe("routing");
  });

  it("keeps one Activity header: its own when alone, the persisted one otherwise", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    const section = () => live?.querySelector<HTMLDetailsElement>("details.chat-activity");

    // Nothing persisted yet: this header is the turn's only one, and the only
    // place the activity orb can live.
    view.setActivity("thinking", Date.now());
    view.setStream({ thinking: "weighing", text: "" });
    expect(live?.hidden).toBe(false);
    expect(section()?.hidden).toBe(false);

    // A persisted sequence lands: an empty live header beside it is a duplicate.
    view.apply(
      snapshot([
        {
          type: "entry",
          entry: {
            id: "a1",
            role: "assistant",
            at: 0,
            model: null,
            parts: [
              { kind: "tool", callId: "c0", name: "read", intent: null, args: "", result: "ok", isError: false },
            ],
          },
        },
      ]),
    );
    expect(section()?.hidden).toBe(true);
    view.dispose();
  });

  it("shows tool calls of the running turn before the transcript has them", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    const rows = () => live?.querySelectorAll<HTMLElement>(".chat-act-live") ?? [];

    view.setLiveSteps([
      { id: "c1", name: "edit", subject: "src/app.ts", running: true, isError: false, preview: null },
    ]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("Editing");
    expect(rows()[0]?.textContent).toContain("src/app.ts");
    expect(rows()[0]?.classList.contains("chat-act-running")).toBe(true);

    // The same call finishing updates its own row instead of adding another.
    view.setLiveSteps([
      { id: "c1", name: "edit", subject: "src/app.ts", running: false, isError: false, preview: null },
      { id: "c2", name: "bash", subject: "npm test", running: true, isError: false, preview: null },
    ]);
    expect(rows()).toHaveLength(2);
    expect(rows()[0]?.classList.contains("chat-act-running")).toBe(false);
    expect(rows()[1]?.textContent).toContain("npm test");

    // omp clears the list once the message persists; the transcript owns it now.
    view.setLiveSteps([]);
    expect(rows()).toHaveLength(0);
  });

  it("shows the payload a call is writing while its arguments stream", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    const preview = () => live?.querySelector<HTMLElement>(".chat-act-preview");

    view.setLiveSteps([
      {
        id: "c1",
        name: "write",
        subject: "notes.txt",
        running: true,
        isError: false,
        preview: "line one\nline two",
      },
    ]);
    // Rendered as added lines, like the persisted edit row it becomes.
    const lines = Array.from(preview()?.querySelectorAll(".chat-diff-add") ?? []).map((n) => n.textContent);
    expect(lines).toEqual(["+ line one", "+ line two"]);

    // Arguments finished: the transcript owns the content from here.
    view.setLiveSteps([
      { id: "c1", name: "write", subject: "notes.txt", running: true, isError: false, preview: null },
    ]);
    expect(preview()).toBeNull();
    view.dispose();
  });

  it("updates a streaming preview in place instead of rebuilding it", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    const step = (preview: string) => ({
      id: "c1",
      name: "write",
      subject: "notes.txt",
      running: true,
      isError: false,
      preview,
    });

    view.setLiveSteps([step("one\ntwo")]);
    const row = live?.querySelector<HTMLElement>(".chat-act-live");
    const box = live?.querySelector<HTMLElement>(".chat-act-preview");

    view.setLiveSteps([step("one\ntwo\nthree")]);
    // Same nodes: a rebuild restarts the animation and drops scroll position.
    expect(live?.querySelector(".chat-act-live")).toBe(row);
    expect(live?.querySelector(".chat-act-preview")).toBe(box);
    expect(Array.from(box?.children ?? []).map((n) => n.textContent)).toEqual([
      "+ one",
      "+ two",
      "+ three",
    ]);

    // The window slides as the tail moves, without leaving stale lines behind.
    view.setLiveSteps([step("two\nthree")]);
    expect(Array.from(box?.children ?? []).map((n) => n.textContent)).toEqual(["+ two", "+ three"]);
    view.dispose();
  });

  it("treats a slid reasoning buffer as one thought, not one per update", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    const folded = () => live?.querySelectorAll("details.chat-thinking") ?? [];

    // The bridge caps its buffer and keeps the tail, so a long thought starts
    // dropping characters from the front on every update.
    const body = "x".repeat(400);
    view.setStream({ thinking: `${body} one`, text: "" });
    view.setStream({ thinking: `${body.slice(3)} one two`, text: "" });
    view.setStream({ thinking: `${body.slice(9)} one two three`, text: "" });

    expect(folded()).toHaveLength(0);
    expect(live?.querySelector(".chat-live-thought")?.textContent).toContain("one two three");

    // A genuinely different thought is still recognised as one.
    view.setStream({ thinking: "a completely unrelated line of reasoning", text: "" });
    expect(folded()).toHaveLength(1);
    view.dispose();
  });

  it("does not re-open the live card for a reply the transcript already shows", () => {
    vi.useFakeTimers();
    try {
      const { view } = makeView();
      const live = view.el.querySelector<HTMLDivElement>(".chat-live");

      view.setStream({ thinking: "", text: "all done" });
      expect(live?.hidden).toBe(false);

      view.apply(
        snapshot([
          {
            type: "entry",
            entry: {
              id: "a1",
              role: "assistant",
              at: 0,
              model: null,
              parts: [{ kind: "text", text: "all done" }],
            },
          },
        ]),
      );

      // The bridge republishes that reply for the rest of the turn, with a
      // trailing newline the persisted copy does not have.
      view.setStream({ thinking: "", text: "all done\n" });
      vi.advanceTimersByTime(3100);
      expect(live?.hidden).toBe(true);
      expect(view.el.querySelectorAll(".chat-rows .chat-assistant")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the hosting sequence so a running tool is not hidden behind it", () => {
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
            parts: [
              { kind: "tool", callId: "c0", name: "read", intent: null, args: "", result: "ok", isError: false },
            ],
          },
        },
      ]),
    );
    const tail = view.el.querySelector<HTMLDetailsElement>(".chat-rows details.chat-activity");
    // Compact density leaves the persisted sequence collapsed.
    expect(tail?.open).toBe(false);

    view.setLiveSteps([{ id: "c1", name: "write", subject: "index.html", running: true, isError: false, preview: null }]);
    expect(tail?.open).toBe(true);
    expect(tail?.textContent).toContain("index.html");

    // Turn over: the section goes back to how the reader left it.
    view.clearTranscript();
    expect(tail?.open).toBe(false);

    view.dispose();
  });

  it("never repeats a thought the transcript already shows", () => {
    const { view } = makeView();
    const band = () => view.el.querySelector<HTMLDivElement>(".chat-live-thought");

    view.setStream({ thinking: "planning the file", text: "" });
    expect(band()?.hidden).toBe(false);

    // omp persists the message; its reasoning is now a `Thought` row.
    view.apply(
      snapshot([
        {
          type: "entry",
          entry: {
            id: "a1",
            role: "assistant",
            at: 0,
            model: null,
            parts: [{ kind: "thinking", text: "planning the file" }],
          },
        },
      ]),
    );

    // The bridge keeps its buffer until the next turn, so the same text arrives
    // again — it must not paint beside the row that now owns it.
    view.setStream({ thinking: "planning the file", text: "writing now" });
    expect(band()?.hidden).toBe(true);

    // Still true after the live wrapper settles and resets its own state: the
    // bridge republishes that buffer for the rest of the turn.
    vi.useFakeTimers();
    try {
      view.setStream(null);
      vi.advanceTimersByTime(3100);
    } finally {
      vi.useRealTimers();
    }
    view.setStream({ thinking: "planning the file", text: "writing now" });
    expect(band()?.hidden).toBe(true);

    // Genuinely new reasoning still reaches the band.
    view.setStream({ thinking: "checking the result", text: "writing now" });
    expect(band()?.hidden).toBe(false);
    expect(band()?.textContent).toContain("checking the result");
  });

  it("renders a persisted Thought as markdown, not raw markers", () => {
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
            parts: [{ kind: "thinking", text: "**Planning** the `file`" }],
          },
        },
      ]),
    );

    const thought = view.el.querySelector<HTMLDetailsElement>(".chat-rows details.chat-thinking");
    expect(thought?.querySelector(".chat-thinking-body strong")?.textContent).toBe("Planning");
    expect(thought?.querySelector(".chat-thinking-body code")?.textContent).toBe("file");
    // The collapsed summary is one plain line: markers are stripped, not shown.
    expect(thought?.querySelector(".chat-summary-text")?.textContent).toBe("Planning the file");
  });

  it("streams reasoning and reply together, folding the thought when prose moves on", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");

    // Some providers emit both halves at once; the thought is still live.
    view.setStream({ thinking: "weighing", text: "answer" });
    expect(live?.querySelector(".chat-who")?.textContent).toBe("Agent");
    expect(live?.querySelector<HTMLDivElement>(".chat-live-thought")?.hidden).toBe(false);
    expect(live?.querySelector(".chat-live-text-body")?.textContent).toContain("answer");

    view.setStream({ thinking: "weighing", text: "answer continues" });
    expect(live?.querySelector<HTMLDivElement>(".chat-live-thought")?.hidden).toBe(true);
    expect(live?.querySelector(".chat-activity details.chat-thinking")?.textContent).toContain("weighing");
  });

  it("keeps word spacing intact in the animated stream tail", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");

    view.setStream({ thinking: "", text: "the value must" });
    view.setStream({ thinking: "", text: "the value must be false" });

    const body = live?.querySelector<HTMLDivElement>(".chat-live-text-body");
    expect(body?.textContent).toContain("must be false");
    // The spans are inline-block, which collapses whitespace at their own
    // edges, so each one must hold exactly one word and never a space.
    const marked = body?.querySelectorAll<HTMLSpanElement>(".chat-stream-new") ?? [];
    expect(marked.length).toBeGreaterThan(0);
    for (const span of marked) expect(span.textContent).not.toMatch(/\s/);
  });

  it("maps a stale single-slot bridge payload into the live thought band", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");

    view.setStream({ kind: "thinking", text: "weighing" } as unknown as { thinking: string; text: string });
    expect(live?.hidden).toBe(false);
    expect(live?.querySelector<HTMLDivElement>(".chat-live-thought")?.textContent).toContain("weighing");
    // Thinking-only payload: the reply card stays out of the way.
    expect(live?.querySelector<HTMLDivElement>(".chat-assistant")?.hidden).toBe(true);
  });

  it("keeps the finished reply on screen until the transcript catches up", () => {
    vi.useFakeTimers();
    try {
      const { view } = makeView();
      const live = view.el.querySelector<HTMLDivElement>(".chat-live");

      view.setStream({ thinking: "", text: "all done" });
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
    view.setStream({ thinking: "", text: "Hello" });
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");
    // The first delta has nothing to diff against, so nothing is marked fresh yet.
    expect(live?.querySelectorAll(".chat-stream-new")).toHaveLength(0);

    view.setStream({ thinking: "", text: "Hello world" });
    const fresh = Array.from(live?.querySelectorAll(".chat-stream-new") ?? []);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.some((span) => span.textContent?.includes("world"))).toBe(true);
    expect(fresh.some((span) => span.textContent?.trim() === "Hello")).toBe(false);
  });

  it("renders markdown while the reply is still being written", () => {
    const { view } = makeView();
    const live = (): HTMLElement | null => view.el.querySelector(".chat-live .chat-live-text-body");

    view.setStream({ thinking: "", text: "## Plan" });
    expect(live()?.querySelector("h2")?.textContent).toBe("Plan");

    view.setStream({ thinking: "", text: "## Plan\n\nUse **bold**" });
    expect(live()?.querySelector("strong")?.textContent).toBe("bold");

    // A finished earlier block is not re-rendered as the tail grows.
    const heading = live()?.querySelector("h2");
    view.setStream({ thinking: "", text: "## Plan\n\nUse **bold** and `code`" });
    expect(live()?.querySelector("code")?.textContent).toBe("code");
    expect(live()?.querySelector("h2")).toBe(heading);

    // A half-typed fence stays one block instead of one paragraph per line.
    view.setStream({ thinking: "", text: "## Plan\n\nUse **bold** and `code`\n\n```ts\nconst a = 1;" });
    expect(live()?.querySelector("pre")).not.toBeNull();
  });

  it("keeps a word's trailing punctuation in the same box as the word", () => {
    const { view } = makeView();
    const live = view.el.querySelector<HTMLDivElement>(".chat-live");

    // omp splits a word across deltas constantly; each fragment in its own
    // inline-block span would let the "." or "’s" wrap onto the next line.
    view.setStream({ thinking: "", text: "Nutella is" });
    view.setStream({ thinking: "", text: "Nutella is Ferrero" });
    view.setStream({ thinking: "", text: "Nutella is Ferrero’s" });
    view.setStream({ thinking: "", text: "Nutella is Ferrero’s smear" });
    view.setStream({ thinking: "", text: "Nutella is Ferrero’s smear." });

    const boxes = Array.from(live?.querySelectorAll(".chat-stream-new") ?? []);
    // Only the newest delta animates; earlier words have settled into the
    // re-rendered markdown, so no orphaned "." or "’s" box can exist.
    expect(boxes).toHaveLength(1);
    expect(boxes[0].textContent).toBe("smear.");
    // Whitespace lives outside the animated boxes, so wrapped lines don't indent.
    expect(live?.querySelector(".chat-live-text-body")?.textContent).toBe("Nutella is Ferrero’s smear.");
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

  it("renders the inline ask at the tail and survives transcript rebuilds", () => {
    const { view } = makeView();
    view.apply(snapshot([userRow]));
    const submit = vi.fn();
    const dismiss = vi.fn();
    const pending = {
      toolCallId: "ask-1",
      questions: [
        {
          question: "Pick one?",
          options: [{ label: "Alpha" }, { label: "Beta" }],
        },
      ],
    };

    view.setAsk(pending, submit, dismiss);
    const slot = view.el.querySelector<HTMLDivElement>(".chat-ask-slot");
    expect(slot?.hidden).toBe(false);
    expect(slot?.querySelector(".chat-ask")).not.toBeNull();
    // Tail order: load-earlier, rows, live, inflight, ask slot.
    expect(slot?.parentElement?.lastElementChild).toBe(slot);

    // Clicking an option then re-setting the same ask keeps the selection.
    slot?.querySelectorAll<HTMLButtonElement>(".chat-ask-option")[0]?.click();
    view.setAsk(pending, submit, dismiss);
    expect(slot?.querySelectorAll(".chat-ask-option.selected")).toHaveLength(1);

    // A transcript rebuild must not drop the ephemeral card.
    view.apply(snapshot([userRow]));
    expect(view.el.querySelector(".chat-ask-slot .chat-ask")).not.toBeNull();

    // Submit fires the callback and hides the slot.
    slot?.querySelector<HTMLButtonElement>(".chat-ask-submit")?.click();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toEqual([
      {
        multi: false,
        optionsCount: 2,
        recommended: undefined,
        selectedIndices: [0],
      },
    ]);
    expect(slot?.hidden).toBe(true);

    // Dismiss path fires its callback too.
    view.setAsk(pending, submit, dismiss);
    expect(slot?.hidden).toBe(false);
    slot?.querySelector<HTMLButtonElement>(".chat-ask-x")?.click();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(slot?.hidden).toBe(true);

    view.setAsk(null, null, null);
    expect(slot?.hidden).toBe(true);
  });

  it("renders inline plan state, excerpt, actions, and compacting state", () => {
    const { view, hooks } = makeView();
    const review = view.el.querySelector<HTMLDivElement>(".chat-plan-review");
    expect(review?.hidden).toBe(true);

    const planRow: TranscriptRow = {
      type: "entry",
      entry: {
        id: "plan-1",
        role: "assistant",
        at: 1,
        model: "gpt-5",
        parts: [{ kind: "text", text: "## Plan\n\n1. Build the inline card." }],
      },
    };
    view.apply(snapshot([planRow]));
    view.setPlanState({
      mode: "on",
      pending: true,
      reviewOpen: true,
      contextStats: "(32k tokens)",
      compacting: false,
      planFile: "/tmp/PLAN.md",
      planText: "## Canonical plan\n\nThis replaces transcript chatter.",
    });

    expect(review?.hidden).toBe(false);
    expect(review?.textContent).toContain("Canonical plan");
    expect(review?.textContent).toContain("This replaces transcript chatter.");
    expect(review?.textContent).not.toContain("Build the inline card.");
    expect(review?.querySelector(".chat-plan-stats")?.textContent).toBe("(32k tokens)");
    const actions = Array.from(review?.querySelectorAll<HTMLButtonElement>("[data-plan-action]") ?? []);
    expect(actions.map((button) => button.dataset.planAction)).toEqual(["execute", "compact", "keep", "refine", "save", "quit"]);
    for (const button of actions) button.click();
    expect(hooks.onPlanAction).toHaveBeenCalledTimes(6);
    expect(vi.mocked(hooks.onPlanAction).mock.calls.map(([action]) => action)).toEqual([
      "execute",
      "compact",
      "keep",
      "refine",
      "save",
      "quit",
    ]);
    view.setPlanState({
      mode: "on",
      pending: false,
      reviewOpen: false,
      compacting: true,
      planFile: null,
      planText: null,
    });
    expect(review?.textContent).toContain("Compacting context…");
    expect(review?.querySelector("[data-plan-action]")).toBeNull();
    view.setPlanState({
      mode: "on",
      pending: false,
      reviewOpen: true,
      compacting: false,
      planFile: null,
      planText: null,
    });
    const secondPlanRow: TranscriptRow = {
      type: "entry",
      entry: {
        id: "plan-2",
        role: "assistant",
        at: 2,
        model: "gpt-5",
        parts: [{ kind: "text", text: "2. Verify the action buttons." }],
      },
    };
    view.apply(snapshot([secondPlanRow], false));
    expect(review?.textContent).toContain("Verify the action buttons.");
  });
});
