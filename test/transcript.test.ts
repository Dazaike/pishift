import { describe, expect, it } from "vitest";
import {
  buildTranscriptRows,
  parseTranscriptLine,
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
