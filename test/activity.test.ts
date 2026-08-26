import { describe, expect, it } from "vitest";
import {
  ActivityTracker,
  classifyToolActivity,
  extractStreamEventType,
  extractToolName,
} from "../src/shared/activity";

/** Wraps an `assistantMessageEvent` the way omp forwards `message_update`. */
function messageUpdate(inner: unknown) {
  return { type: "message_update", message: {}, assistantMessageEvent: inner };
}

describe("extractToolName", () => {
  it("names a streaming toolcall_start from partial.content[contentIndex]", () => {
    const event = messageUpdate({
      type: "toolcall_start",
      contentIndex: 1,
      partial: {
        content: [
          { type: "text", text: "x" },
          { type: "toolCall", id: "c1", name: "bash", arguments: {} },
        ],
      },
    });
    expect(extractToolName(event)).toBe("bash");
  });

  it("names a toolcall_delta whose delta is a bare argument string", () => {
    const event = messageUpdate({
      type: "toolcall_delta",
      contentIndex: 0,
      delta: '{"cmd":',
      partial: { content: [{ type: "toolCall", name: "edit" }] },
    });
    expect(extractToolName(event)).toBe("edit");
  });

  it("prefers toolCall.name on toolcall_end", () => {
    const event = messageUpdate({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { name: "write" },
      partial: { content: [] },
    });
    expect(extractToolName(event)).toBe("write");
  });

  it("reads the top-level toolName of tool_execution_* events", () => {
    expect(extractToolName({ toolName: "read", toolCallId: "t1" })).toBe("read");
  });

  it("returns undefined for non-tool stream events", () => {
    const event = messageUpdate({ type: "thinking_delta", contentIndex: 0, delta: "hm", partial: {} });
    expect(extractToolName(event)).toBeUndefined();
  });
});

describe("extractStreamEventType", () => {
  it("unwraps assistantMessageEvent before falling back to event.type", () => {
    expect(extractStreamEventType(messageUpdate({ type: "text_delta" }))).toBe("text_delta");
    expect(extractStreamEventType({ type: "tool_execution_start" })).toBe("tool_execution_start");
    expect(extractStreamEventType(undefined)).toBeUndefined();
  });
});

describe("classifyToolActivity", () => {
  it("maps omp's read-only tools to reading", () => {
    for (const name of ["read", "grep", "glob", "lsp", "github", "web_search"]) {
      expect(classifyToolActivity(name)).toBe("reading");
    }
  });

  it("maps omp's mutating tools to editing", () => {
    for (const name of ["edit", "write", "ast_edit", "memory_edit"]) {
      expect(classifyToolActivity(name)).toBe("editing");
    }
  });

  it("maps omp's execution tools to running", () => {
    for (const name of ["bash", "eval", "debug", "browser"]) {
      expect(classifyToolActivity(name)).toBe("running");
    }
  });

  it("maps orchestration tools to working", () => {
    for (const name of ["task", "hub", "todo", "ask"]) {
      expect(classifyToolActivity(name)).toBe("working");
    }
  });

  it("strips the mcp__server__ prefix", () => {
    expect(classifyToolActivity("mcp__node_repl__js")).toBe("running");
    expect(classifyToolActivity("mcp__node_repl_js")).toBe("running");
  });

  it("is case-insensitive", () => {
    expect(classifyToolActivity("Read")).toBe("reading");
  });

  it("never matches a bare substring", () => {
    expect(classifyToolActivity("threading_helper")).toBe("working");
  });

  it("falls back to working for unknown tools", () => {
    expect(classifyToolActivity("frobnicate")).toBe("working");
  });
});

describe("ActivityTracker", () => {
  it("tracks a full turn through every phase", () => {
    const tracker = new ActivityTracker();
    tracker.agentStart();
    // Request is out, nothing has streamed back yet.
    expect(tracker.activity).toBe("waiting");
    tracker.stream("thinking_delta", undefined);
    expect(tracker.activity).toBe("thinking");
    tracker.stream("thinking_end", undefined);
    expect(tracker.activity).toBe("waiting");
    tracker.stream("text_delta", undefined);
    expect(tracker.activity).toBe("responding");
    tracker.stream("toolcall_start", "bash");
    expect(tracker.activity).toBe("running");
    tracker.toolStart("t1", "bash");
    expect(tracker.activity).toBe("running");
    // Tool result submitted; the next model response has not arrived.
    tracker.toolEnd("t1");
    expect(tracker.activity).toBe("waiting");
    tracker.stream("text_delta", undefined);
    expect(tracker.activity).toBe("responding");
    tracker.agentEnd();
    expect(tracker.activity).toBe("idle");
  });

  it("keeps the surviving tool's activity when a parallel call finishes", () => {
    const tracker = new ActivityTracker();
    tracker.agentStart();
    tracker.toolStart("a", "read");
    expect(tracker.activity).toBe("reading");
    tracker.toolStart("b", "bash");
    expect(tracker.activity).toBe("running");
    tracker.toolEnd("b");
    expect(tracker.activity).toBe("reading");
    tracker.toolEnd("a");
    expect(tracker.activity).toBe("waiting");
  });

  it("stays live when agent_end reports willContinue", () => {
    const tracker = new ActivityTracker();
    tracker.agentStart();
    tracker.agentEnd(true);
    expect(tracker.activity).toBe("waiting");
  });

  it("recovers a tool execution it never saw start", () => {
    const tracker = new ActivityTracker();
    tracker.agentStart();
    tracker.toolUpdate("z", "bash");
    expect(tracker.activity).toBe("running");
    tracker.toolUpdate("z", undefined);
    expect(tracker.activity).toBe("running");
  });

  it("ignores late updates after a tool has ended", () => {
    const tracker = new ActivityTracker();
    tracker.agentStart();
    tracker.toolStart("late", "bash");
    tracker.toolEnd("late");
    tracker.toolUpdate("late", "bash");
    expect(tracker.activity).toBe("waiting");
  });

  it("ignores tool updates after the foreground agent has ended", () => {
    const tracker = new ActivityTracker();
    tracker.agentStart();
    tracker.toolStart("late", "bash");
    tracker.agentEnd();
    tracker.toolUpdate("late", "bash");
    tracker.toolUpdate("unknown", "bash");
    expect(tracker.activity).toBe("idle");
  });

  it("keeps ended tool IDs tombstoned until the session resets", () => {
    const tracker = new ActivityTracker();
    tracker.agentStart();
    tracker.toolStart("reused", "bash");
    tracker.toolEnd("reused");
    tracker.agentStart();
    tracker.toolUpdate("reused", "bash");
    expect(tracker.activity).toBe("waiting");

    tracker.reset();
    tracker.agentStart();
    tracker.toolUpdate("reused", "bash");
    expect(tracker.activity).toBe("running");
  });

  it("treats an unnamed streaming tool call as work, not waiting", () => {
    const tracker = new ActivityTracker();
    tracker.agentStart();
    tracker.stream("thinking_delta", undefined);
    tracker.stream("toolcall_delta", undefined);
    expect(tracker.activity).toBe("working");
  });

  it("keeps a named tool's classification across unnamed argument deltas", () => {
    const tracker = new ActivityTracker();
    tracker.agentStart();
    tracker.stream("toolcall_start", "bash");
    tracker.stream("toolcall_delta", undefined);
    expect(tracker.activity).toBe("running");
  });

  it("returns idle after reset", () => {
    const tracker = new ActivityTracker();
    tracker.agentStart();
    tracker.toolStart("t1", "bash");
    tracker.reset();
    expect(tracker.activity).toBe("idle");
  });
});
