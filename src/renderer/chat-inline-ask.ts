import type { AskAnswer } from "../shared/ask-keys";
import type { PendingAsk, PendingAskQuestion } from "../shared/ipc";

interface QuestionAnswerState {
  selected: Set<number>;
  customText?: string;
}

/**
 * Chat-native inline ask card, rendered as a flow row at the transcript tail.
 *
 * Selection/submit semantics mirror `AskModal` exactly (copied logic, separate
 * DOM): the sheet is a floating popover with its own motion/scroll-snap
 * behavior, while this is a plain in-flow card with no animation library.
 */
export class ChatInlineAsk {
  readonly el: HTMLDivElement;
  private pending: PendingAsk | null = null;
  private answerState: QuestionAnswerState[] = [];
  private focusOtherIndex: number | null = null;
  private onSubmitCallback: ((answers: AskAnswer[]) => void) | null = null;
  private onDismissCallback: (() => void) | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "chat-ask";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Question");
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }
  get toolCallId(): string | null {
    return this.pending?.toolCallId ?? null;
  }

  open(pending: PendingAsk, onSubmit: (answers: AskAnswer[]) => void, onDismiss: () => void): void {
    // Same guarantee as the sheet: a heartbeat re-delivery must not wipe
    // half-entered answers.
    if (this.isOpen && this.pending?.toolCallId === pending.toolCallId) return;
    this.pending = pending;
    this.onSubmitCallback = onSubmit;
    this.onDismissCallback = onDismiss;
    this.answerState = pending.questions.map(() => ({
      selected: new Set<number>(),
      customText: undefined,
    }));
    this.focusOtherIndex = null;
    this.render();
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
    this.pending = null;
    this.answerState = [];
    this.focusOtherIndex = null;
    this.onSubmitCallback = null;
    this.onDismissCallback = null;
  }

  private dismiss(): void {
    this.onDismissCallback?.();
    this.close();
  }

  private isAnswered(index: number): boolean {
    const state = this.answerState[index];
    if (!state) return false;
    if (state.customText !== undefined) return state.customText.trim().length > 0;
    return state.selected.size > 0;
  }

  private firstUnansweredIndex(): number {
    if (!this.pending) return -1;
    for (let i = 0; i < this.pending.questions.length; i++) {
      if (!this.isAnswered(i)) return i;
    }
    return -1;
  }

  private submit(): void {
    if (!this.pending) return;
    const missing = this.firstUnansweredIndex();
    if (missing >= 0) {
      const remaining =
        this.pending.questions.length -
        this.answerState.filter((_, index) => this.isAnswered(index)).length;
      const progress = this.el.querySelector<HTMLSpanElement>(".chat-ask-progress");
      if (progress) {
        progress.textContent = `${remaining} question(s) remaining — answer all first.`;
        progress.classList.add("ask-progress-error");
      }
      this.el.querySelectorAll(".chat-ask-q.missing").forEach((block) => {
        block.classList.remove("missing");
      });
      const block = this.el.querySelector<HTMLElement>(`.chat-ask-q[data-index="${missing}"]`);
      block?.classList.add("missing");
      block?.scrollIntoView?.({ block: "nearest" });
      return;
    }

    const answers: AskAnswer[] = this.pending.questions.map((q, i) => {
      const state = this.answerState[i]!;
      return {
        multi: q.multi === true,
        optionsCount: q.options.length,
        recommended: q.recommended,
        selectedIndices: [...state.selected],
        ...(state.customText !== undefined ? { customText: state.customText } : {}),
      };
    });
    this.onSubmitCallback?.(answers);
    this.close();
  }

  private progressText(): string {
    if (!this.pending) return "";
    const total = this.pending.questions.length;
    const answered = this.answerState.filter((_, index) => this.isAnswered(index)).length;
    return `${answered} of ${total} answered`;
  }

  private updateProgress(): void {
    if (!this.pending) return;
    const text = this.progressText();
    const count = this.el.querySelector<HTMLSpanElement>(".chat-ask-count");
    if (count) count.textContent = text;
    const progress = this.el.querySelector<HTMLSpanElement>(".chat-ask-progress");
    if (progress) {
      progress.classList.remove("ask-progress-error");
      progress.textContent = text;
    }
  }

  private renderOptions(q: PendingAskQuestion, index: number, host: HTMLElement): void {
    const state = this.answerState[index]!;
    const options = document.createElement("div");
    options.className = "chat-ask-options";

    q.options.forEach((option, optionIndex) => {
      const selected = q.multi
        ? state.selected.has(optionIndex)
        : state.customText === undefined && state.selected.has(optionIndex);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "chat-ask-option";
      row.dataset.optionIndex = String(optionIndex);
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-pressed", String(selected));

      const marker = document.createElement("span");
      marker.className = "chat-ask-marker";
      marker.textContent = q.multi ? (selected ? "☑" : "☐") : selected ? "●" : "○";

      const label = document.createElement("span");
      label.className = "chat-ask-option-label";
      const isRecommended = optionIndex === q.recommended;
      label.textContent =
        isRecommended && !option.label.endsWith("(Recommended)")
          ? `${option.label} (Recommended)`
          : option.label;
      row.append(marker, label);

      if (option.description) {
        const desc = document.createElement("span");
        desc.className = "chat-ask-option-desc";
        desc.textContent = option.description;
        row.appendChild(desc);
      }

      row.addEventListener("click", () => {
        if (q.multi) {
          if (state.selected.has(optionIndex)) state.selected.delete(optionIndex);
          else state.selected.add(optionIndex);
        } else {
          state.selected = new Set([optionIndex]);
          state.customText = undefined;
        }
        this.render();
      });
      options.appendChild(row);
    });

    const customSelected = state.customText !== undefined;
    const otherRow = document.createElement("div");
    otherRow.className = "chat-ask-other";
    otherRow.setAttribute("role", "button");
    otherRow.tabIndex = 0;
    otherRow.classList.toggle("selected", customSelected);
    otherRow.setAttribute("aria-pressed", String(customSelected));

    const otherMarker = document.createElement("span");
    otherMarker.className = "chat-ask-marker";
    otherMarker.textContent = q.multi ? (customSelected ? "☑" : "☐") : customSelected ? "●" : "○";

    const otherLabel = document.createElement("span");
    otherLabel.className = "chat-ask-option-label";
    otherLabel.textContent = "Other";
    otherRow.append(otherMarker, otherLabel);

    if (customSelected) {
      const otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.className = "chat-ask-other-input";
      otherInput.placeholder = "Type your own…";
      otherInput.value = state.customText ?? "";
      otherInput.addEventListener("click", (event) => event.stopPropagation());
      otherInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submit();
        }
      });
      otherInput.addEventListener("input", () => {
        state.customText = otherInput.value;
        this.updateProgress();
      });
      otherRow.appendChild(otherInput);
      if (this.focusOtherIndex === index) {
        this.focusOtherIndex = null;
        queueMicrotask(() => otherInput.focus());
      }
    }

    otherRow.addEventListener("click", () => {
      if (state.customText === undefined) {
        state.customText = "";
        if (!q.multi) state.selected = new Set();
        this.focusOtherIndex = index;
        this.render();
        return;
      }
      if (q.multi) {
        state.customText = undefined;
        this.render();
        return;
      }
      otherRow.querySelector<HTMLInputElement>(".chat-ask-other-input")?.focus();
    });

    // The nested input handles its own Enter/typing; only Enter/Space landing
    // on the row itself (keyboard focus, not the input) should toggle it.
    otherRow.addEventListener("keydown", (event) => {
      if (event.target !== otherRow) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        otherRow.click();
      }
    });

    options.appendChild(otherRow);
    host.appendChild(options);
  }

  private render(): void {
    this.el.replaceChildren();
    if (!this.pending) return;

    const head = document.createElement("header");
    head.className = "chat-ask-head";

    const title = document.createElement("span");
    title.className = "chat-ask-title";
    title.textContent = "Needs your answer";

    const count = document.createElement("span");
    count.className = "chat-ask-count";
    count.textContent = this.progressText();

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "chat-ask-x";
    dismissBtn.setAttribute("aria-label", "Dismiss");
    dismissBtn.textContent = "×";
    dismissBtn.addEventListener("click", () => this.dismiss());
    head.append(title, count, dismissBtn);

    const questions = document.createElement("div");
    questions.className = "chat-ask-questions";
    this.pending.questions.forEach((question, index) => {
      const block = document.createElement("div");
      block.className = "chat-ask-q";
      block.dataset.index = String(index);

      const questionTitle = document.createElement("div");
      questionTitle.className = "chat-ask-q-title";
      questionTitle.append(document.createTextNode(question.question));
      if (question.header) {
        const badge = document.createElement("span");
        badge.className = "chat-ask-badge";
        badge.textContent = question.header;
        questionTitle.appendChild(badge);
      }
      block.appendChild(questionTitle);
      this.renderOptions(question, index, block);
      questions.appendChild(block);
    });

    const footer = document.createElement("footer");
    footer.className = "chat-ask-footer";

    const progress = document.createElement("span");
    progress.className = "chat-ask-progress";
    progress.textContent = this.progressText();

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "chat-ask-submit";
    submitBtn.textContent = "Submit";
    submitBtn.addEventListener("click", () => this.submit());

    footer.append(progress, submitBtn);
    this.el.append(head, questions, footer);
  }
}
