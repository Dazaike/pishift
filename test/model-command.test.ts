import { describe, expect, it } from "vitest";
import { parseModelSlashCommand } from "../src/shared/model-command";

describe("parseModelSlashCommand", () => {
  it("extracts plan on from /m plan on", () => {
    expect(parseModelSlashCommand("/m plan on")).toEqual({
      targetPlan: "on",
      remainingSlashCommand: undefined,
    });
  });

  it("extracts plan off from /m plan off", () => {
    expect(parseModelSlashCommand("/m plan off")).toEqual({
      targetPlan: "off",
      remainingSlashCommand: undefined,
    });
  });

  it("extracts plan toggle from /m plan", () => {
    expect(parseModelSlashCommand("/m plan")).toEqual({
      targetPlan: "toggle",
      remainingSlashCommand: undefined,
    });
  });

  it("handles colon and equals syntax (plan:on, plan=off)", () => {
    expect(parseModelSlashCommand("/m plan:on")).toEqual({
      targetPlan: "on",
      remainingSlashCommand: undefined,
    });
    expect(parseModelSlashCommand("/m plan=off")).toEqual({
      targetPlan: "off",
      remainingSlashCommand: undefined,
    });
  });

  it("extracts plan directive while retaining model spec", () => {
    expect(parseModelSlashCommand("/m claude-3-7-sonnet plan on")).toEqual({
      targetPlan: "on",
      remainingSlashCommand: "/m claude-3-7-sonnet",
    });
  });

  it("extracts plan directive while retaining model spec and thinking level", () => {
    expect(parseModelSlashCommand("/m claude-3-7-sonnet high plan:on")).toEqual({
      targetPlan: "on",
      remainingSlashCommand: "/m claude-3-7-sonnet high",
    });
  });

  it("retains model command without plan directive", () => {
    expect(parseModelSlashCommand("/m gpt-4o")).toEqual({
      targetPlan: undefined,
      remainingSlashCommand: "/m gpt-4o",
    });
  });

  it("ignores non-/m text", () => {
    expect(parseModelSlashCommand("/plan")).toEqual({});
    expect(parseModelSlashCommand("hello world plan on")).toEqual({});
  });
});
