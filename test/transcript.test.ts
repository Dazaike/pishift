import { describe, expect, it } from "vitest";
import {
  buildTranscriptRows,
  extractContextUsage,
  parseTranscriptLine,
  partitionContextWindow,
  reconcileDetailedContextUsage,
  type ContextUsageSnapshot,
  type TranscriptNode,
  type TranscriptRow,
} from "../src/shared/transcript";

/** Parse hand-written JSONL exactly the way the tailer does. */
function rows(lines: readonly string[]): TranscriptRow[] {
  const nodes: TranscriptNode[] = [];
  for (const line of lines) {
    const node = parseTranscriptLine(line);
    if (node) nodes.push(node);
  }
  return buildTranscriptRows(nodes);
}

const SESSION = JSON.stringify({
  type: "session",
  version: 3,
  id: "sess-1",
  timestamp: "2026-09-01T18:00:00.000Z",
  cwd: "C:\\repo",
});

function message(id: string, parentId: string | null, body: unknown, at = "2026-09-01T18:00:01.000Z"): string {
  return JSON.stringify({ type: "message", id, parentId, timestamp: at, message: body });
}

describe("buildTranscriptRows", () => {
  it("folds a tool result into its call and drops the standalone row", () => {
    const out = rows([
      SESSION,
      message("u1", null, { role: "user", content: [{ type: "text", text: "hi" }] }),
      message("a1", "u1", {
        role: "assistant",
        model: "claude-opus-5",
        content: [
          { type: "thinking", thinking: "pondering", thinkingSignature: "sig" },
          { type: "text", text: "reading now" },
          { type: "toolCall", id: "call_1", name: "read", intent: "Reading README", arguments: { path: "README.md" } },
        ],
      }),
      message("t1", "a1", {
        role: "toolResult",
        toolName: "read",
        toolCallId: "call_1",
        isError: false,
        content: [{ type: "text", text: "# Title" }],
      }),
    ]);

    // Two rows, not three: the result lives inside the call's part.
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "entry", entry: { role: "user" } });

    const assistant = out[1];
    if (assistant.type !== "entry") throw new Error("expected an entry row");
    expect(assistant.entry.model).toBe("claude-opus-5");
    // The thinking payload lives in `thinking`, not `text`.
    expect(assistant.entry.parts).toEqual([
      { kind: "thinking", text: "pondering" },
      { kind: "text", text: "reading now" },
      {
        kind: "tool",
        callId: "call_1",
        name: "read",
        intent: "Reading README",
        args: JSON.stringify({ path: "README.md" }, null, 2),
        result: "# Title",
        isError: false,
      },
    ]);
  });

  it("groups consecutive tool-only assistant entries into one activity turn", () => {
    const out = rows([
      SESSION,
      message("a1", null, {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "glob", arguments: { path: "src/**" } }],
      }),
      message("t1", "a1", {
        role: "toolResult",
        toolCallId: "call_1",
        content: [{ type: "text", text: "src/a.ts" }],
      }),
      message("a2", "t1", {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_2", name: "grep", arguments: { pattern: "TODO" } }],
      }),
      message("t2", "a2", {
        role: "toolResult",
        toolCallId: "call_2",
        content: [{ type: "text", text: "none" }],
      }),
    ]);

    expect(out).toHaveLength(1);
    const row = out[0];
    if (row.type !== "entry") throw new Error("expected an entry row");
    expect(row.entry.id).toBe("a1");
    expect(row.entry.parts).toMatchObject([
      { kind: "tool", name: "glob", result: "src/a.ts" },
      { kind: "tool", name: "grep", result: "none" },
    ]);
  });

  it("leaves a call without a result marked as still running", () => {
    const out = rows([
      SESSION,
      message("a1", null, {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } }],
      }),
    ]);

    const row = out[0];
    if (row.type !== "entry") throw new Error("expected an entry row");
    expect(row.entry.parts[0]).toMatchObject({ kind: "tool", result: null, isError: false });
  });

  it("still renders a result whose call fell outside the chain", () => {
    const out = rows([
      SESSION,
      message("t1", null, {
        role: "toolResult",
        toolName: "read",
        toolCallId: "orphan",
        isError: true,
        content: [{ type: "text", text: "boom" }],
      }),
    ]);

    expect(out).toHaveLength(1);
    const row = out[0];
    if (row.type !== "entry") throw new Error("expected an entry row");
    expect(row.entry.role).toBe("tool");
    expect(row.entry.parts[0]).toEqual({
      kind: "tool",
      callId: "orphan",
      name: "read",
      intent: null,
      args: "",
      result: "boom",
      isError: true,
    });
  });

  it("keeps interleaved thinking, text, and tool calls in order", () => {
    const out = rows([
      SESSION,
      message("a1", null, {
        role: "assistant",
        model: "m",
        content: [
          { type: "thinking", thinking: "first thought" },
          { type: "text", text: "middle" },
          { type: "thinking", thinking: "second thought" },
          { type: "toolCall", id: "call_1", name: "read", arguments: { path: "README.md" } },
        ],
      }),
      message("t1", "a1", {
        role: "toolResult",
        toolName: "read",
        toolCallId: "call_1",
        isError: false,
        content: [{ type: "text", text: "# Title" }],
      }),
    ]);

    expect(out).toHaveLength(1);
    const row = out[0];
    if (row.type !== "entry") throw new Error("expected an entry row");
    expect(row.entry.parts).toEqual([
      { kind: "thinking", text: "first thought" },
      { kind: "text", text: "middle" },
      { kind: "thinking", text: "second thought" },
      {
        kind: "tool",
        callId: "call_1",
        name: "read",
        intent: null,
        args: JSON.stringify({ path: "README.md" }, null, 2),
        result: "# Title",
        isError: false,
      },
    ]);
  });

  it("folds tool-result text into the call and appends its image", () => {
    const out = rows([
      SESSION,
      message("a1", null, {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "screenshot", arguments: {} }],
      }),
      message("t1", "a1", {
        role: "toolResult",
        toolName: "screenshot",
        toolCallId: "call_1",
        isError: false,
        content: [
          { type: "text", text: "captured" },
          { type: "image", data: "blob:sha256:shot", mimeType: "image/png" },
        ],
      }),
    ]);

    expect(out).toHaveLength(1);
    const row = out[0];
    if (row.type !== "entry") throw new Error("expected an entry row");
    expect(row.entry.parts).toEqual([
      {
        kind: "tool",
        callId: "call_1",
        name: "screenshot",
        intent: null,
        args: JSON.stringify({}, null, 2),
        result: "captured",
        isError: false,
      },
      { kind: "image", src: "blob:sha256:shot", mimeType: "image/png" },
    ]);
  });

  it("renders an orphan image-bearing tool result as tool plus image", () => {
    const out = rows([
      SESSION,
      message("t1", null, {
        role: "toolResult",
        toolName: "screenshot",
        toolCallId: "orphan-shot",
        isError: false,
        content: [
          { type: "text", text: "captured" },
          { type: "image", data: "blob:sha256:orphan", mimeType: "image/png" },
        ],
      }),
    ]);

    expect(out).toHaveLength(1);
    const row = out[0];
    if (row.type !== "entry") throw new Error("expected an entry row");
    expect(row.entry.parts).toEqual([
      {
        kind: "tool",
        callId: "orphan-shot",
        name: "screenshot",
        intent: null,
        args: "",
        result: "captured",
        isError: false,
      },
      { kind: "image", src: "blob:sha256:orphan", mimeType: "image/png" },
    ]);
  });

  it("follows only the branch the newest entry sits on", () => {
    const out = rows([
      SESSION,
      message("u1", null, { role: "user", content: [{ type: "text", text: "root" }] }),
      message("a1", "u1", { role: "assistant", content: [{ type: "text", text: "abandoned" }] }),
      message("a2", "u1", { role: "assistant", content: [{ type: "text", text: "kept" }] }),
    ]);

    const texts = out.flatMap((row) => (row.type === "entry" ? row.entry.parts : []));
    expect(texts).toEqual([
      { kind: "text", text: "root" },
      { kind: "text", text: "kept" },
    ]);
  });

  it("drops everything before the newest reset boundary and marks the cut", () => {
    const out = rows([
      SESSION,
      message("u1", null, { role: "user", content: [{ type: "text", text: "before" }] }),
      JSON.stringify({ type: "reset_boundary", id: "r1", parentId: "u1", timestamp: "2026-09-01T18:00:02.000Z" }),
      message("u2", "r1", { role: "user", content: [{ type: "text", text: "after" }] }),
    ]);

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      type: "marker",
      marker: { id: "r1", kind: "reset", at: Date.parse("2026-09-01T18:00:02.000Z"), text: "Context cleared" },
    });
    expect(out[1]).toMatchObject({ type: "entry", entry: { parts: [{ kind: "text", text: "after" }] } });
  });

  it("terminates on a parentId cycle instead of hanging", () => {
    const out = rows([
      message("a", "b", { role: "user", content: [{ type: "text", text: "a" }] }),
      message("b", "a", { role: "user", content: [{ type: "text", text: "b" }] }),
    ]);

    expect(out).toHaveLength(2);
  });

  it("skips the title slot, the session header and unparseable lines", () => {
    const out = rows([
      `${JSON.stringify({ type: "title", title: "" })}${" ".repeat(32)}`,
      SESSION,
      "{not json",
      "",
      message("u1", null, { role: "user", content: [{ type: "text", text: "only me" }] }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "entry", entry: { id: "u1" } });
  });

  it("ignores tool_execution_start so tool calls are not rendered twice", () => {
    const out = rows([
      SESSION,
      message("a1", null, {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } }],
      }),
      JSON.stringify({
        type: "custom",
        customType: "tool_execution_start",
        id: "c1",
        parentId: "a1",
        timestamp: "2026-09-01T18:00:03.000Z",
        data: { toolCallId: "call_1", toolName: "bash", args: { command: "ls" } },
      }),
    ]);

    expect(out).toHaveLength(1);
    const row = out[0];
    if (row.type !== "entry") throw new Error("expected an entry row");
    expect(row.entry.parts).toHaveLength(1);
  });

  it("renders a compaction as a summary divider", () => {
    const out = rows([
      SESSION,
      JSON.stringify({
        type: "compaction",
        id: "k1",
        parentId: null,
        timestamp: "2026-09-01T18:00:04.000Z",
        summary: "long summary",
        shortSummary: "short summary",
      }),
    ]);

    expect(out).toEqual([
      {
        type: "marker",
        marker: {
          id: "k1",
          kind: "compaction",
          at: Date.parse("2026-09-01T18:00:04.000Z"),
          text: "short summary",
        },
      },
    ]);
  });

  it("keeps user images and drops messages with no renderable parts", () => {
    const out = rows([
      SESSION,
      message("u1", null, {
        role: "user",
        content: [{ type: "image", data: "blob:sha256:abc", mimeType: "image/png" }],
      }),
      message("a1", "u1", { role: "assistant", content: [] }),
    ]);

    expect(out).toHaveLength(1);
    const row = out[0];
    if (row.type !== "entry") throw new Error("expected an entry row");
    expect(row.entry.parts).toEqual([{ kind: "image", src: "blob:sha256:abc", mimeType: "image/png" }]);
  });
});

describe("extractContextUsage", () => {
  it("returns null when nodes list is empty", () => {
    expect(extractContextUsage([])).toBeNull();
  });

  it("extracts usage from latest assistant message", () => {
    const nodes: TranscriptNode[] = [
      parseTranscriptLine(message("u1", null, { role: "user", content: "hello" }))!,
      parseTranscriptLine(
        message("a1", "u1", {
          role: "assistant",
          model: "gemini-3.8-flash",
          usage: {
            input: 10000,
            output: 500,
            cacheRead: 20000,
            cacheWrite: 0,
            totalTokens: 30500,
          },
          contextSnapshot: {
            promptTokens: 30000,
            nonMessageTokens: 5000,
            compactionEpoch: 0,
          },
        }),
      )!,
    ];

    const usage = extractContextUsage(nodes, 100000);
    expect(usage).not.toBeNull();
    expect(usage?.promptTokens).toBe(30000);
    expect(usage?.cacheReadTokens).toBe(20000);
    expect(usage?.outputTokens).toBe(500);
    expect(usage?.nonMessageTokens).toBe(5000);
    expect(usage?.totalTokens).toBe(30500);
    expect(usage?.contextWindow).toBe(100000);
    expect(usage?.percent).toBe(30);
    expect(usage?.modelId).toBe("gemini-3.8-flash");
  });

  it("parses historyRewriteTokensRemoved from the context snapshot", () => {
    const nodes: TranscriptNode[] = [
      parseTranscriptLine(message("u1", null, { role: "user", content: "hello" }))!,
      parseTranscriptLine(
        message("a1", "u1", {
          role: "assistant",
          model: "gemini-3.8-flash",
          usage: { input: 10000, output: 500, cacheRead: 20000, cacheWrite: 0, totalTokens: 30500 },
          contextSnapshot: {
            promptTokens: 30000,
            nonMessageTokens: 5000,
            historyRewriteTokensRemoved: 2000,
            compactionEpoch: 0,
          },
        }),
      )!,
    ];

    const usage = extractContextUsage(nodes, 100000);
    expect(usage?.historyRewriteTokensRemoved).toBe(2000);
    expect(usage?.totalTokens).toBe(30500);
    expect(usage?.percent).toBe(30);
  });

  it("skips a trailing aborted turn with zeroed usage and no snapshot, using the prior turn's data", () => {
    const nodes: TranscriptNode[] = [
      parseTranscriptLine(message("u1", null, { role: "user", content: "hello" }))!,
      parseTranscriptLine(
        message("a1", "u1", {
          role: "assistant",
          model: "gemini-3.8-flash",
          usage: { input: 4354, output: 24, cacheRead: 32497, cacheWrite: 0, totalTokens: 36875 },
          contextSnapshot: { promptTokens: 36851, nonMessageTokens: 45846, compactionEpoch: 0 },
        }),
      )!,
      parseTranscriptLine(
        message("a2", "a1", {
          role: "assistant",
          model: "gemini-3.8-flash",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        }),
      )!,
    ];

    const usage = extractContextUsage(nodes, 1_000_000);
    expect(usage).not.toBeNull();
    expect(usage?.promptTokens).toBe(36851);
    expect(usage?.totalTokens).toBe(36875);
  });

  it("respects reset boundaries and stops before cleared messages", () => {
    const nodes: TranscriptNode[] = [
      parseTranscriptLine(
        message("a1", null, {
          role: "assistant",
          model: "gemini-3.8-flash",
          usage: { input: 50000, output: 100, cacheRead: 0, cacheWrite: 0 },
        }),
      )!,
      parseTranscriptLine(JSON.stringify({ type: "reset_boundary", id: "reset1", parentId: "a1" }))!,
      parseTranscriptLine(message("u2", "reset1", { role: "user", content: "new" }))!,
    ];

    const usage = extractContextUsage(nodes, 200000);
    expect(usage).toBeNull();
  });
});

function contextSnap(partial: Partial<ContextUsageSnapshot>): ContextUsageSnapshot {
  return {
    promptTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    nonMessageTokens: 0,
    historyRewriteTokensRemoved: 0,
    totalTokens: 0,
    contextWindow: 0,
    percent: 0,
    modelId: null,
    ...partial,
  };
}

describe("partitionContextWindow", () => {
  it("partitions a screenshot-shaped 500k window", () => {
    const partition = partitionContextWindow(
      contextSnap({
        promptTokens: 145000,
        nonMessageTokens: 46000,
        outputTokens: 1300,
        cacheReadTokens: 144000,
        contextWindow: 500000,
        percent: 29,
        totalTokens: 146300,
        historyRewriteTokensRemoved: 0,
        cacheWriteTokens: 0,
        modelId: "grok-4.6",
      }),
    );

    expect(partition.usedTokens).toBe(145000);
    expect(partition.autoCompactBufferTokens).toBe(75000);
    expect(partition.freeTokens).toBe(280000);
    expect(partition.slices.map((s) => [s.label, s.tokens])).toEqual([
      ["System / Overhead", 46000],
      ["Messages", 99000],
      ["Free space", 280000],
      ["Autocompact buffer", 75000],
    ]);
    expect(46000 + 99000 + 280000 + 75000).toBe(500000);
  });

  it("uses the exact /context breakdown instead of aggregate overhead", () => {
    const partition = partitionContextWindow(
      contextSnap({
        promptTokens: 999999,
        nonMessageTokens: 999999,
        contextWindow: 100000,
        detailedBreakdown: {
          usedTokens: 40000,
          contextWindow: 100000,
          systemPromptTokens: 5000,
          systemToolsTokens: 8000,
          systemContextTokens: 7000,
          skillsTokens: 2000,
          messagesTokens: 18000,
          freeTokens: 45000,
          autoCompactBufferTokens: 15000,
        },
      }),
    );

    expect(partition.usedTokens).toBe(40000);
    expect(partition.freeTokens).toBe(45000);
    expect(partition.autoCompactBufferTokens).toBe(15000);
    expect(partition.slices.map((slice) => [slice.label, slice.tokens])).toEqual([
      ["System prompt", 5000],
      ["System tools", 8000],
      ["System context", 7000],
      ["Skills", 2000],
      ["Messages", 18000],
      ["Free space", 45000],
      ["Autocompact buffer", 15000],
    ]);
  });

  it("updates captured details from transcript usage without issuing /context", () => {
    const previous = contextSnap({
      promptTokens: 40000,
      nonMessageTokens: 22000,
      contextWindow: 100000,
      modelId: "provider/test",
      detailedBreakdown: {
        usedTokens: 40000,
        contextWindow: 100000,
        systemPromptTokens: 5000,
        systemToolsTokens: 8000,
        systemContextTokens: 7000,
        skillsTokens: 2000,
        messagesTokens: 18000,
        freeTokens: 45000,
        autoCompactBufferTokens: 15000,
      },
    });
    const next = contextSnap({
      promptTokens: 50000,
      nonMessageTokens: 22000,
      contextWindow: 200000,
      modelId: "provider/test",
    });

    expect(reconcileDetailedContextUsage(previous, next)).toMatchObject({
      promptTokens: 50000,
      contextWindow: 100000,
      percent: 50,
      detailedBreakdown: {
        messagesTokens: 28000,
        usedTokens: 50000,
        freeTokens: 35000,
        autoCompactBufferTokens: 15000,
      },
    });
  });

  it("subtracts history rewrite tokens from used occupancy", () => {
    const partition = partitionContextWindow(
      contextSnap({
        promptTokens: 145000,
        nonMessageTokens: 46000,
        outputTokens: 1300,
        cacheReadTokens: 144000,
        contextWindow: 500000,
        percent: 29,
        totalTokens: 146300,
        historyRewriteTokensRemoved: 5000,
        cacheWriteTokens: 0,
        modelId: "grok-4.6",
      }),
    );

    expect(partition.usedTokens).toBe(140000);
    expect(partition.slices.find((s) => s.kind === "messages")?.tokens).toBe(94000);
    expect(partition.autoCompactBufferTokens).toBe(75000);
    expect(partition.freeTokens).toBe(285000);
  });

  it("shrinks the autocompact buffer near a full window and omits free space", () => {
    const partition = partitionContextWindow(
      contextSnap({
        promptTokens: 490000,
        nonMessageTokens: 40000,
        contextWindow: 500000,
      }),
    );

    expect(partition.autoCompactBufferTokens).toBe(10000);
    expect(partition.freeTokens).toBe(0);
    expect(partition.slices.find((s) => s.kind === "messages")?.tokens).toBe(450000);
    expect(partition.slices.some((s) => s.kind === "free")).toBe(false);
  });

  it("omits overhead when nonMessageTokens is zero", () => {
    const partition = partitionContextWindow(
      contextSnap({
        promptTokens: 10000,
        nonMessageTokens: 0,
        contextWindow: 200000,
      }),
    );

    expect(partition.slices.some((s) => s.kind === "overhead")).toBe(false);
    expect(partition.slices.find((s) => s.kind === "messages")?.tokens).toBe(10000);
    expect(partition.autoCompactBufferTokens).toBe(30000);
    expect(partition.freeTokens).toBe(160000);
  });
});
