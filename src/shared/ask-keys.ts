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

export const ASK_ARROW_UP = "\x1b[A";
export const ASK_ARROW_DOWN = "\x1b[B";
export const ASK_ARROW_RIGHT = "\x1b[C";
export const ASK_KEY_ENTER = "\r";

/** CR/LF would submit early and ESC would cancel the whole ask tool. */
export function sanitizeAskText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\x1b/g, "");
}

/**
 * Keystrokes that answer exactly ONE question of omp's native ask dialog.
 *
 * `multiQuestion` selects the terminator: multi-select in a multi-question ask
 * is left with the right arrow (omp only shows a "Done selecting" row when the
 * ask has a single question), and that Done row shifts the "Other" row down by
 * one when it is present.
 */
export function buildAskQuestionKeys(answer: AskAnswer, multiQuestion: boolean): string {
  const n = answer.optionsCount;
  const origin = Math.min(Math.max(answer.recommended ?? 0, 0), Math.max(n - 1, 0));
  const move = (from: number, to: number): string =>
    to > from ? ASK_ARROW_DOWN.repeat(to - from) : ASK_ARROW_UP.repeat(from - to);

  if (!answer.multi) {
    if (answer.customText !== undefined) {
      return (
        move(origin, n) + ASK_KEY_ENTER + sanitizeAskText(answer.customText) + ASK_KEY_ENTER
      );
    }
    return move(origin, answer.selectedIndices[0] ?? 0) + ASK_KEY_ENTER;
  }

  const checked = [...answer.selectedIndices].sort((a, b) => a - b);
  let cursor = origin;
  let seq = "";
  for (const idx of checked) {
    seq += move(cursor, idx) + ASK_KEY_ENTER;
    cursor = idx;
  }
  if (answer.customText !== undefined) {
    // "Done selecting" only exists for single-question asks with a checked box.
    const otherIndex = !multiQuestion && checked.length > 0 ? n + 1 : n;
    return (
      seq + move(cursor, otherIndex) + ASK_KEY_ENTER + sanitizeAskText(answer.customText) + ASK_KEY_ENTER
    );
  }
  if (multiQuestion) return seq + ASK_ARROW_RIGHT;
  // Single-question multi-select: commit via the "Done selecting" row at index n.
  if (checked.length === 0) return seq + ASK_ARROW_RIGHT;
  return seq + move(cursor, n) + ASK_KEY_ENTER;
}
