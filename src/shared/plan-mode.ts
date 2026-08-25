/**
 * Single source of truth for omp's plan tri-state.
 *
 * omp's native `/plan` (and the `app.plan.toggle` keybinding) performs exactly
 * one step of the cycle OFF -> ON -> PAUSED -> OFF. Nothing in the extension
 * API can read or write plan state, so the host must drive the cycle one step
 * at a time and gate every step on a real observation (terminal status line or
 * a control-bridge publish). This module holds the pure logic for that.
 */

export type PlanMode = "off" | "on" | "paused";
export type PlanTarget = "on" | "off";

/** One native `/plan` step: OFF -> ON -> PAUSED -> OFF. */
export function nextPlanAfterToggle(mode: PlanMode): PlanMode {
  switch (mode) {
    case "off":
      return "on";
    case "on":
      return "paused";
    default:
      return "off";
  }
}

/**
 * Map omp's three real status lines to a plan mode. ANSI must already be
 * stripped by the caller. Returns null when the chunk says nothing about plan.
 */
export function parsePlanStatus(plain: string): PlanMode | null {
  if (/Plan mode enabled\. Plan file:/.test(plain)) return "on";
  if (/Plan mode paused\./.test(plain)) return "paused";
  if (/Plan mode disabled\./.test(plain)) return "off";
  return null;
}

/** True when the chunk contains omp's plan-exit confirmation prompt. */
export function isPlanExitConfirm(plain: string): boolean {
  return /Exit plan mode\?/.test(plain);
}

export interface PlanReconcilerHooks {
  /** Send one native cycle step (host: `view.runSlash("/plan")`). */
  sendToggle(): void;
  /** Answer the "Exit plan mode?" selector with Yes (host: `view.writeRaw("\r")`). */
  answerConfirm(): void;
  /** Repaint the button. `pending` = a user-requested target is still settling. */
  onDisplay(mode: PlanMode, pending: boolean): void;
}

export const PLAN_MAX_ATTEMPTS = 3;
export const PLAN_STEP_TIMEOUT_MS = 4000;

interface PlanIntent {
  target: PlanTarget;
  attempts: number;
  deadline: number;
}

export class PlanReconciler {
  private planMode: PlanMode = "off";
  private intent: PlanIntent | null = null;

  constructor(private readonly hooks: PlanReconcilerHooks) {}

  get mode(): PlanMode {
    return this.planMode;
  }

  get pending(): boolean {
    return this.intent !== null;
  }

  /** Truth arrived from omp (terminal status line or control-bridge publish). */
  observe(mode: PlanMode, now: number): void {
    this.planMode = mode;
    const intent = this.intent;
    if (intent) {
      if (mode === intent.target) {
        this.intent = null;
      } else if (intent.attempts < PLAN_MAX_ATTEMPTS) {
        intent.attempts++;
        intent.deadline = now + PLAN_STEP_TIMEOUT_MS;
        this.hooks.sendToggle();
      } else {
        // Give up; the display falls back to the truth.
        this.intent = null;
      }
    }
    this.hooks.onDisplay(this.planMode, this.intent !== null);
  }

  /** User asked for a target state. */
  request(target: PlanTarget, now: number): void {
    if (this.planMode === target) {
      this.intent = null;
      this.hooks.onDisplay(this.planMode, false);
      return;
    }
    this.intent = { target, attempts: 1, deadline: now + PLAN_STEP_TIMEOUT_MS };
    this.hooks.sendToggle();
    this.hooks.onDisplay(this.planMode, true);
  }

  /** Watchdog for a step swallowed by a modal. Only retry path. */
  tick(now: number): void {
    const intent = this.intent;
    if (!intent || now < intent.deadline) return;
    if (intent.attempts < PLAN_MAX_ATTEMPTS) {
      intent.attempts++;
      intent.deadline = now + PLAN_STEP_TIMEOUT_MS;
      this.hooks.sendToggle();
      return;
    }
    this.intent = null;
    this.hooks.onDisplay(this.planMode, false);
  }

  /** omp is asking "Exit plan mode?" — answer only if we asked to leave. */
  confirmPrompt(now: number): void {
    const intent = this.intent;
    if (intent?.target === "off") {
      this.hooks.answerConfirm();
      // Not a cycle step, so it does not consume an attempt.
      intent.deadline = now + PLAN_STEP_TIMEOUT_MS;
      return;
    }
    // The dialog belongs to the user; stop driving.
    this.intent = null;
    this.hooks.onDisplay(this.planMode, false);
  }

  reset(mode: PlanMode): void {
    this.intent = null;
    this.planMode = mode;
    this.hooks.onDisplay(mode, false);
  }
}
