import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const START = "// ---8<--- activity-core (source of truth: src/shared/activity.ts) ---8<---";
const END = "// ---8<--- end activity-core ---8<---";

/** The sentinel block, with `export ` stripped so the two copies are comparable. */
function activityCore(path: string): string {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const from = text.indexOf(START);
  const to = text.indexOf(END);
  expect(from, `${path} is missing the activity-core start sentinel`).toBeGreaterThanOrEqual(0);
  expect(to, `${path} is missing the activity-core end sentinel`).toBeGreaterThan(from);
  return text
    .slice(from, to)
    .split("\n")
    .map((line) => (line.startsWith("export ") ? line.slice("export ".length) : line))
    .join("\n");
}

describe("activity-core copy in the control-bridge extension", () => {
  it("has not drifted from src/shared/activity.ts", () => {
    // The extension is copied standalone into ~/.omp/agent/extensions and cannot
    // import from src/, so the block is duplicated; drift is a silent runtime bug.
    const source = activityCore("../src/shared/activity.ts");
    const copy = activityCore("../extensions/control-bridge.ts");
    expect(source.length).toBeGreaterThan(0);
    expect(copy.length).toBeGreaterThan(0);
    expect(copy).toBe(source);
  });
});

describe("PiShift session environment contract", () => {
  it("uses PISHIFT_SESSION_ID in both the PTY host and standalone extension", () => {
    const host = readFileSync(new URL("../src/main/pty-env.ts", import.meta.url), "utf8");
    const extension = readFileSync(new URL("../extensions/control-bridge.ts", import.meta.url), "utf8");

    for (const text of [host, extension]) {
      expect(text).toContain("PISHIFT_SESSION_ID");
      expect(text).not.toContain(["OMP", "HIF_SESSION_ID"].join(""));
    }
  });
});
