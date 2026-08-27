/** One answered question, as captured by the ask sheet. */
export interface AskAnswer {
  multi: boolean;
  /** Number of real options, excluding the trailing "Other" row. */
  optionsCount: number;
  /** omp starts the selector cursor on this row; absent means row 0. */
  recommended?: number;
  selectedIndices: number[];
  customText?: string;
}

export type AskKeyStep =
  | { type: "arrow"; dir: "up" | "down" | "left" | "right" }
  | { type: "enter" }
  | { type: "space" }
  | { type: "text"; value: string }
  | { type: "wait"; ms: number };

export const ASK_KEY_GAP_MS = 35;
export const ASK_ENTER_GAP_MS = 80;
export const ASK_EDITOR_GAP_MS = 80;

/** CR/LF would submit early and ESC would cancel the whole ask tool. */
export function sanitizeAskText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\x1b/g, "");
}

/**
 * Keystrokes that answer the whole AskDialogComponent in one sequence.
 *
 * One widget holds every question; do not split per question for PTY gating.
 */
export function buildAskDialogSteps(answers: AskAnswer[]): AskKeyStep[] {
  if (answers.length === 0) return [];

  const steps: AskKeyStep[] = [];
  // A single-question ask has no "Submit" tab: confirming the last (only)
  // question's answer submits the whole dialog. A multi-question ask needs an
  // explicit tab-advance after every INTERMEDIATE question (Enter on a
  // just-confirmed Other row reopens its editor instead of advancing). The
  // LAST question needs no such advance: its own confirming Enter already
  // reaches Submit, exactly like the plain-selection path already does — an
  // extra ArrowRight there has nowhere real to go and wraps the tab bar back
  // to question 1, reopening its Other editor with stale text.
  const multiQuestion = answers.length > 1;

  answers.forEach((answer, index) => {
    const isLastQuestion = index === answers.length - 1;
    const n = answer.optionsCount;
    let cursor = Math.min(Math.max(answer.recommended ?? 0, 0), Math.max(n - 1, 0));

    const moveTo = (target: number): void => {
      while (cursor < target) {
        steps.push({ type: "arrow", dir: "down" });
        cursor++;
      }
      while (cursor > target) {
        steps.push({ type: "arrow", dir: "up" });
        cursor--;
      }
    };

    if (!answer.multi) {
      if (answer.customText !== undefined) {
        moveTo(n);
        steps.push({ type: "enter" });
        steps.push({ type: "wait", ms: ASK_EDITOR_GAP_MS });
        steps.push({ type: "text", value: sanitizeAskText(answer.customText) });
        steps.push({ type: "enter" });
        // Enter on a just-confirmed Other row reopens its editor instead of
        // advancing; the arrow keys are the only reliable tab-to-tab move.
        // The last question needs no advance: its Enter already reaches
        // Submit, and an extra ArrowRight would wrap back to question 1.
        if (multiQuestion && !isLastQuestion) steps.push({ type: "arrow", dir: "right" });
      } else {
        moveTo(answer.selectedIndices[0] ?? 0);
        steps.push({ type: "enter" });
      }
      return;
    }

    const checked = [...answer.selectedIndices].sort((a, b) => a - b);
    for (const idx of checked) {
      moveTo(idx);
      steps.push({ type: "space" });
    }
    if (answer.customText !== undefined) {
      moveTo(n);
      // Other is a checkbox row like any other multi-select option: Space
      // toggles it on and opens its inline editor, same as the other rows.
      steps.push({ type: "space" });
      steps.push({ type: "wait", ms: ASK_EDITOR_GAP_MS });
      steps.push({ type: "text", value: sanitizeAskText(answer.customText) });
      steps.push({ type: "enter" });
      if (multiQuestion && !isLastQuestion) steps.push({ type: "arrow", dir: "right" });
    } else {
      steps.push({ type: "enter" });
    }
  });

  if (multiQuestion) {
    steps.push({ type: "enter" });
  }

  return steps;
}
