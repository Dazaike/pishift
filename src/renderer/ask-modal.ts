import type { AskAnswer } from "../shared/ask-keys";
import type { PendingAsk, PendingAskQuestion } from "../shared/ipc";

interface QuestionAnswerState {
  selected: Set<number>;
  customText?: string;
}

/** A single sheet that presents every question in one scrollable list. */
export class AskModal {
  readonly el: HTMLDivElement;
  private pending: PendingAsk | null = null;
  private answerState: QuestionAnswerState[] = [];
  private body: HTMLDivElement | null = null;
  private focusOtherIndex: number | null = null;
  private onSubmitCallback: ((answers: AskAnswer[]) => void) | null = null;
  private onDismissCallback: (() => void) | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "ask-sheet";
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
    this.pending = pending;
    this.onSubmitCallback = onSubmit;
    this.onDismissCallback = onDismiss;
    this.answerState = pending.questions.map((q) => ({
      selected: new Set<number>(q.multi ? [] : q.recommended != null ? [q.recommended] : []),
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
    this.body = null;
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
      const progress = this.el.querySelector<HTMLSpanElement>(".ask-progress");
      if (progress) {
        progress.hidden = false;
        progress.textContent = "Answer all questions first.";
        progress.classList.add("ask-progress-error");
      }
      this.el.querySelectorAll(".ask-question-block.missing").forEach((block) => {
        block.classList.remove("missing");
      });
      const block = this.el.querySelector<HTMLElement>(`.ask-question-block[data-index="${missing}"]`);
      block?.classList.add("missing");
      block?.scrollIntoView({ block: "nearest" });
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

  private renderOptions(q: PendingAskQuestion, index: number, host: HTMLElement): void {
    const state = this.answerState[index]!;
    const options = document.createElement("div");
    options.className = "ask-options";

    q.options.forEach((option, optionIndex) => {
      const selected = state.customText === undefined && state.selected.has(optionIndex);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ask-option-row";
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-pressed", String(selected));

      const marker = document.createElement("span");
      marker.className = "ask-marker";
      marker.textContent = q.multi ? (selected ? "☑" : "☐") : selected ? "●" : "○";

      const label = document.createElement("span");
      label.className = "ask-option-label";
      const isRecommended = optionIndex === q.recommended;
      label.textContent =
        isRecommended && !option.label.endsWith("(Recommended)")
          ? `${option.label} (Recommended)`
          : option.label;
      row.append(marker, label);

      if (option.description) {
        const desc = document.createElement("span");
        desc.className = "ask-option-desc";
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
    const otherRow = document.createElement("button");
    otherRow.type = "button";
    otherRow.className = "ask-other-row";
    otherRow.classList.toggle("selected", customSelected);
    otherRow.setAttribute("aria-pressed", String(customSelected));

    const otherMarker = document.createElement("span");
    otherMarker.className = "ask-marker";
    otherMarker.textContent = q.multi ? (customSelected ? "☑" : "☐") : customSelected ? "●" : "○";

    const otherLabel = document.createElement("span");
    otherLabel.className = "ask-option-label";
    otherLabel.textContent = "Other";
    otherRow.append(otherMarker, otherLabel);

    if (customSelected) {
      const otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.className = "ask-other-input";
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
      otherRow.querySelector<HTMLInputElement>(".ask-other-input")?.focus();
    });

    options.appendChild(otherRow);
    host.appendChild(options);
  }

  private render(): void {
    const scrollTop = this.body?.scrollTop ?? 0;
    this.el.replaceChildren();
    this.body = null;
    if (!this.pending) return;

    const total = this.pending.questions.length;
    const header = document.createElement("header");
    header.className = "ask-header";

    const title = document.createElement("h2");
    title.textContent = total === 1 ? "Question" : `${total} Questions`;

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "ask-dismiss-btn";
    dismissBtn.setAttribute("aria-label", "Dismiss");
    dismissBtn.textContent = "×";
    dismissBtn.addEventListener("click", () => this.dismiss());
    header.append(title, dismissBtn);

    const body = document.createElement("div");
    body.className = "ask-body";
    this.pending.questions.forEach((question, index) => {
      const block = document.createElement("div");
      block.className = "ask-question-block";
      block.dataset.index = String(index);

      const questionTitle = document.createElement("div");
      questionTitle.className = "ask-question-title";
      questionTitle.append(document.createTextNode(question.question));
      if (question.header) {
        const badge = document.createElement("span");
        badge.className = "ask-header-badge";
        badge.textContent = question.header;
        questionTitle.appendChild(badge);
      }
      block.appendChild(questionTitle);
      this.renderOptions(question, index, block);
      body.appendChild(block);
    });

    const footer = document.createElement("footer");
    footer.className = "ask-footer";

    const progress = document.createElement("span");
    progress.className = "ask-progress";
    progress.textContent = `${this.answerState.filter((_, index) => this.isAnswered(index)).length} of ${total} answered`;
    progress.hidden = total === 1;

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "ask-submit-btn";
    submitBtn.textContent = "Submit";
    submitBtn.addEventListener("click", () => this.submit());
    footer.append(progress, submitBtn);

    this.el.append(header, body, footer);
    this.body = body;
    body.scrollTop = scrollTop;
  }
}
