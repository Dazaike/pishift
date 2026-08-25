import { describe, expect, it } from "vitest";
import {
  PLAN_MAX_ATTEMPTS,
  PLAN_STEP_TIMEOUT_MS,
  PlanReconciler,
  isPlanExitConfirm,
  nextPlanAfterToggle,
  parsePlanStatus,
  type PlanMode,
} from "../src/shared/plan-mode";

describe("nextPlanAfterToggle", () => {
  it("follows omp's native cycle", () => {
    expect(nextPlanAfterToggle("off")).toBe("on");
    expect(nextPlanAfterToggle("on")).toBe("paused");
    expect(nextPlanAfterToggle("paused")).toBe("off");
  });
});

describe("parsePlanStatus", () => {
  it("recognizes omp's three real status lines", () => {
    expect(parsePlanStatus("Plan mode enabled. Plan file: local://PLAN.md")).toBe("on");
    expect(parsePlanStatus("Plan mode paused.")).toBe("paused");
    expect(parsePlanStatus("Plan mode disabled.")).toBe("off");
  });

  it("ignores strings omp never prints", () => {
    expect(parsePlanStatus("plan mode on")).toBeNull();
    expect(parsePlanStatus("Plan mode set to on")).toBeNull();
    expect(parsePlanStatus("π  main · ⬢ Claude · Plan")).toBeNull();
    expect(parsePlanStatus("we should plan mode this out")).toBeNull();
  });
});

describe("isPlanExitConfirm", () => {
  it("matches omp's exit confirmation", () => {
    expect(
      isPlanExitConfirm("Exit plan mode?\nThis exits plan mode without approving a plan."),
    ).toBe(true);
    expect(isPlanExitConfirm("Plan mode paused.")).toBe(false);
  });
});

function harness() {
  const toggles: number[] = [];
  const confirms: number[] = [];
  const displays: Array<{ mode: PlanMode; pending: boolean }> = [];
  const plan = new PlanReconciler({
    sendToggle: () => toggles.push(1),
    answerConfirm: () => confirms.push(1),
    onDisplay: (mode, pending) => displays.push({ mode, pending }),
  });
  return { plan, toggles, confirms, displays };
}

describe("PlanReconciler", () => {
  it("OFF -> ON takes exactly one toggle and settles on observation", () => {
    const { plan, toggles } = harness();
    plan.request("on", 0);
    expect(toggles.length).toBe(1);
    plan.observe("on", 10);
    expect(toggles.length).toBe(1);
    expect(plan.pending).toBe(false);
    expect(plan.mode).toBe("on");
  });

  it("ON -> OFF walks ON -> PAUSED -> OFF with two toggles", () => {
    const { plan, toggles } = harness();
    plan.observe("on", 0);
    plan.request("off", 1);
    expect(toggles.length).toBe(1);
    plan.observe("paused", 2);
    expect(toggles.length).toBe(2);
    plan.observe("off", 3);
    expect(toggles.length).toBe(2);
    expect(plan.pending).toBe(false);
    expect(plan.mode).toBe("off");
  });

  it("PAUSED -> ON walks PAUSED -> OFF -> ON with two toggles", () => {
    const { plan, toggles } = harness();
    plan.observe("paused", 0);
    plan.request("on", 1);
    plan.observe("off", 2);
    plan.observe("on", 3);
    expect(toggles.length).toBe(2);
    expect(plan.mode).toBe("on");
    expect(plan.pending).toBe(false);
  });

  it("never toggles on unsolicited observations", () => {
    const { plan, toggles } = harness();
    for (let i = 0; i < 5; i++) plan.observe("on", i);
    expect(toggles.length).toBe(0);
    expect(plan.mode).toBe("on");
  });

  it("gives up after PLAN_MAX_ATTEMPTS and shows the truth", () => {
    const { plan, toggles } = harness();
    plan.observe("on", 0);
    plan.request("off", 1);
    for (let i = 0; i < 10; i++) plan.observe("on", 2 + i);
    expect(toggles.length).toBe(PLAN_MAX_ATTEMPTS);
    expect(plan.pending).toBe(false);
    expect(plan.mode).toBe("on");
  });

  it("retries once per step timeout via tick", () => {
    const { plan, toggles } = harness();
    plan.request("on", 1000);
    expect(toggles.length).toBe(1);
    plan.tick(1000 + PLAN_STEP_TIMEOUT_MS - 1);
    expect(toggles.length).toBe(1);
    plan.tick(1000 + PLAN_STEP_TIMEOUT_MS);
    expect(toggles.length).toBe(2);
  });

  it("answers the exit confirm only while leaving plan mode", () => {
    const { plan, toggles, confirms } = harness();
    plan.observe("on", 0);
    plan.request("off", 1);
    expect(toggles.length).toBe(1);
    plan.confirmPrompt(2);
    expect(confirms.length).toBe(1);
    expect(toggles.length).toBe(1);
  });

  it("leaves an unsolicited confirm to the user", () => {
    const { plan, confirms } = harness();
    plan.confirmPrompt(0);
    expect(confirms.length).toBe(0);
    expect(plan.pending).toBe(false);
  });

  it("does not answer the confirm when heading into plan mode", () => {
    const { plan, confirms } = harness();
    plan.request("on", 0);
    plan.confirmPrompt(1);
    expect(confirms.length).toBe(0);
    expect(plan.pending).toBe(false);
  });

  it("sends nothing when already at the requested target", () => {
    const { plan, toggles, displays } = harness();
    plan.observe("on", 0);
    plan.request("on", 1);
    expect(toggles.length).toBe(0);
    expect(displays.at(-1)).toEqual({ mode: "on", pending: false });
  });

  it("marks the display pending only while an intent is outstanding", () => {
    const { plan, displays } = harness();
    plan.request("on", 0);
    expect(displays.at(-1)).toEqual({ mode: "off", pending: true });
    plan.observe("on", 1);
    expect(displays.at(-1)).toEqual({ mode: "on", pending: false });
  });

  it("reset clears intent and repaints", () => {
    const { plan, displays } = harness();
    plan.request("on", 0);
    plan.reset("paused");
    expect(plan.mode).toBe("paused");
    expect(plan.pending).toBe(false);
    expect(displays.at(-1)).toEqual({ mode: "paused", pending: false });
  });
});
