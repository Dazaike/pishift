import { describe, expect, it } from "vitest";
import {
  activitySummary,
  isSupersededResult,
  readRangeLabel,
  rawToolText,
  summarizeToolPart,
  type ToolPart,
} from "../src/shared/tool-summary";

function tool(over: Partial<ToolPart> & { name: string }): ToolPart {
  return {
    kind: "tool",
    callId: "c1",
    intent: null,
    args: "",
    result: "ok",
    isError: false,
    ...over,
  };
}

describe("summarizeToolPart", () => {
  it("splits a multi-section patch into one action per file with stated counts", () => {
    const input = [
      "[src/math.ts#A1B2]",
      "PUT 4.=5:",
      "+export function add(a: number, b: number): number {",
      "+  return a + b;",
      "+}",
      "[src/index.ts#C3D4]",
      "CUT 9.=9",
      "PUT >20:",
      "+import { add } from \"./math\";",
    ].join("\n");

    const actions = summarizeToolPart(tool({
      name: "edit",
      args: JSON.stringify({ i: "Adding add()", input }),
    }));

    expect(actions.map((a) => [a.verb, a.subject, a.added, a.removed])).toEqual([
      ["Edited", "math.ts", 3, 2],
      ["Edited", "index.ts", 1, 1],
    ]);
    expect(actions[0].addedLines).toEqual([
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
    ]);
  });

  it("never invents a removal count for a block op", () => {
    const input = ["[src/app.ts#EEFF]", "PUT 12*:", "+const x = 1;"].join("\n");
    const [action] = summarizeToolPart(tool({
      name: "edit",
      args: JSON.stringify({ i: "Replacing block", input }),
    }));

    expect(action.added).toBe(1);
    expect(action.removed).toBe(0);
  });

  it("reads MV and REM as move and delete", () => {
    const moved = summarizeToolPart(tool({
      name: "edit",
      args: JSON.stringify({ i: "Moving", input: "[src/a.ts#1111]\nMV src/b.ts" }),
    }));
    const removed = summarizeToolPart(tool({
      name: "edit",
      args: JSON.stringify({ i: "Dropping", input: "[src/a.ts#1111]\nREM" }),
    }));

    expect(moved[0].verb).toBe("Moved");
    expect(removed[0].verb).toBe("Deleted");
  });

  it("counts written lines and leaves removals unstated", () => {
    const [action] = summarizeToolPart(tool({
      name: "write",
      args: JSON.stringify({ path: "src/shared/new.ts", content: "a\nb\nc" }),
    }));

    expect(action).toMatchObject({ kind: "edit", verb: "Wrote", subject: "new.ts", added: 3, removed: null });
  });

  it("describes a command by its intent and first line", () => {
    const [action] = summarizeToolPart(tool({
      name: "bash",
      intent: "Running focused tests",
      args: JSON.stringify({ command: "npm test -- tool-summary\necho done", i: "Running focused tests" }),
    }));

    expect(action).toMatchObject({
      kind: "run",
      verb: "Ran",
      subject: "Running focused tests",
      detail: "npm test -- tool-summary",
    });
  });

  it("strips a read selector off the file name", () => {
    const [action] = summarizeToolPart(tool({
      name: "read",
      args: JSON.stringify({ path: "src/renderer/chat-view.ts:50-200" }),
    }));

    expect(action).toMatchObject({ kind: "read", verb: "Read", subject: "chat-view.ts" });
  });

  it("classifies an unknown MCP tool and names it readably", () => {
    const [action] = summarizeToolPart(tool({ name: "mcp__chrome_devtools__list_pages" }));

    expect(action).toMatchObject({ kind: "read", verb: "Read", subject: "list pages" });
  });

  it("survives malformed arguments", () => {
    const [action] = summarizeToolPart(tool({ name: "read", intent: "Reading config", args: "{oops" }));

    expect(action).toMatchObject({ verb: "Read", subject: "Reading config" });
  });

  it("carries running and error state through", () => {
    const [running] = summarizeToolPart(tool({ name: "bash", result: null }));
    const [failed] = summarizeToolPart(tool({ name: "bash", isError: true }));

    expect(running.running).toBe(true);
    expect(failed.isError).toBe(true);
  });
});

describe("rawToolText", () => {
  it("echoes what a write actually wrote, not the harness acknowledgement", () => {
    const action = summarizeToolPart(tool({
      name: "write",
      args: JSON.stringify({ path: "C:/temp/x.txt", content: "line a\nline b\n" }),
      result: "Successfully wrote 35 bytes to C:/temp/x.txt",
    }))[0];

    const raw = rawToolText(action);
    expect(raw).toContain("C:/temp/x.txt");
    expect(raw).toContain("+ line a\n+ line b");
    expect(raw).not.toContain("Successfully wrote");
  });

  it("shows only the change for an edit", () => {
    const action = summarizeToolPart(tool({
      name: "edit",
      args: JSON.stringify({ input: "[x.txt#A1B2]\nCUT 2.=3\nPUT >1:\n+new-top\n" }),
      result: "[x.txt#B816]\n1:old1\n2:new-top",
    }))[0];

    const raw = rawToolText(action);
    expect(raw).toContain("+ new-top");
    expect(raw).not.toContain("1:old1");
    expect(raw).not.toContain("CUT 2.=3");
  });

  it("keeps command output for a run", () => {
    const action = summarizeToolPart(tool({
      name: "bash",
      args: JSON.stringify({ command: "npm test" }),
      result: "2 passed",
    }))[0];

    expect(rawToolText(action)).toContain("npm test");
    expect(rawToolText(action)).toContain("2 passed");
  });
});

describe("activitySummary", () => {
  it("names the work in a fixed order and pluralizes each bucket", () => {
    expect(activitySummary(["read"])).toBe("1 read");
    expect(activitySummary(["edit"])).toBe("1 edit");
    expect(activitySummary(["run", "edit", "read", "read"])).toBe("1 edit, 2 reads, 1 command");
  });

  it("returns nothing for a sequence with no tool calls", () => {
    expect(activitySummary([])).toBe("");
  });
});

describe("readRangeLabel", () => {
  it("prefers the path selector, else derives the range from printed numbers", () => {
    const selector = summarizeToolPart(tool({
      name: "read",
      args: JSON.stringify({ path: "src/a.ts:24-61" }),
      result: "24:const x = 1",
    }))[0];
    expect(readRangeLabel(selector)).toBe("Lines 24\u201361");

    const printed = summarizeToolPart(tool({
      name: "read",
      args: JSON.stringify({ path: "src/a.ts" }),
      result: "[src/a.ts#C9F0]\n1:export type A = {\n2:  b: boolean;\n3:};",
    }))[0];
    expect(readRangeLabel(printed)).toBe("Lines 1\u20133");
  });

  it("returns nothing when the payload carries no numbering", () => {
    const plain = summarizeToolPart(tool({ name: "read", args: "{}", result: "no numbers here" }))[0];
    expect(readRangeLabel(plain)).toBeNull();
  });
});

describe("summarizeEdit removedRanges", () => {
  it("records the spans a patch replaced, since the old text is never in the payload", () => {
    const [action] = summarizeToolPart(tool({
      name: "edit",
      args: JSON.stringify({ input: "[a.ts#A1B2]\nPUT 4.=13:\n+new\nCUT 20.=20\n" }),
    }));
    expect(action.removed).toBe(11);
    expect(action.removedRanges).toEqual([[4, 13], [20, 20]]);
  });
});

describe("isSupersededResult", () => {
  it("matches omp's reclaimed-read placeholder only", () => {
    expect(isSupersededResult("[Superseded by a newer read of this file]")).toBe(true);
    expect(isSupersededResult("  [Superseded by a newer read of this file]\n")).toBe(true);
    expect(isSupersededResult("[src/a.ts#C9F0]\n1:export const a = 1;")).toBe(false);
    expect(isSupersededResult(null)).toBe(false);
  });
});
