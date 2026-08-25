import type { PendingAsk, PendingAskQuestion } from "../shared/ipc";

export interface AskAnswer {
  multi: boolean;
  optionsCount: number;
  selectedIndices: number[];
  customText?: string;
}

interface QuestionAnswerState {
  selected: Set<number>;
  customText?: string;
}

type SlideDir = "none" | "left" | "right";

/**
 * Compact one-question carousel, sized like the model picker.
 * Multi-question asks slide sideways with prev/next arrows.
 */
export class AskModal {
  readonly el: HTMLDivElement;
  private pending: PendingAsk | null = null;
  private answerState: QuestionAnswerState[] = [];
  private currentIndex = 0;
  private slideDir: SlideDir = "none";
  private warning = "";
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

  open(pending: PendingAsk, onSubmit: (answers: AskAnswer[]) => void, onDismiss: () => void): void {
    this.pending = pending;
    this.onSubmitCallback = onSubmit;
    this.onDismissCallback = onDismiss;
    this.currentIndex = 0;
    this.slideDir = "none";
    this.warning = "";
    // Multi starts empty; single leaves recommended selected when provided.
    this.answerState = pending.questions.map((q) => ({
      selected: new Set<number>(q.multi ? [] : q.recommended != null ? [q.recommended] : []),
      customText: undefined,
    }));
    this.render();
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
    this.pending = null;
    this.onSubmitCallback = null;
    this.onDismissCallback = null;
    this.warning = "";
    this.currentIndex = 0;
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

  private goTo(index: number, dir: SlideDir): void {
    if (!this.pending) return;
    const next = Math.max(0, Math.min(this.pending.questions.length - 1, index));
    if (next === this.currentIndex) return;
    this.slideDir = dir;
    this.currentIndex = next;
    this.warning = "";
    this.render();
  }

  private submit(): void {
    if (!this.pending) return;
    const missing = this.firstUnansweredIndex();
    if (missing >= 0) {
      const total = this.pending.questions.length;
      this.warning =
        total > 1
          ? `Answer all questions first (${missing + 1} of ${total} still open).`
          : "Pick an option or type your own answer first.";
      this.slideDir = missing > this.currentIndex ? "left" : missing < this.currentIndex ? "right" : "none";
      this.currentIndex = missing;
      this.render();
      return;
    }

    const answers: AskAnswer[] = this.pending.questions.map((q, i) => {
      const state = this.answerState[i]!;
      return {
        multi: q.multi === true,
        optionsCount: q.options.length,
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
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ask-option-row";
      if (state.customText === undefined && state.selected.has(optionIndex)) {
        row.classList.add("selected");
      }

      const label = document.createElement("span");
      label.className = "ask-option-label";
      const isRecommended = optionIndex === q.recommended;
      label.textContent =
        isRecommended && !option.label.endsWith("(Recommended)")
          ? `${option.label} (Recommended)`
          : option.label;
      row.appendChild(label);

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
        this.warning = "";
        this.slideDir = "none";
        this.render();
      });

      options.appendChild(row);
    });

    const otherRow = document.createElement("button");
    otherRow.type = "button";
    otherRow.className = "ask-other-row";
    if (state.customText !== undefined) otherRow.classList.add("selected");

    const otherLabel = document.createElement("span");
    otherLabel.className = "ask-option-label";
    otherLabel.textContent = "Other";
    otherRow.appendChild(otherLabel);

    if (state.customText !== undefined) {
      const otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.className = "ask-other-input";
      otherInput.placeholder = "Type your own…";
      otherInput.value = state.customText;
      otherInput.addEventListener("click", (ev) => ev.stopPropagation());
      otherInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          this.submit();
        }
      });
      otherInput.addEventListener("input", () => {
        state.customText = otherInput.value;
        if (this.warning) {
          this.warning = "";
          const warnEl = this.el.querySelector(".ask-warning");
          if (warnEl) warnEl.remove();
        }
      });
      otherRow.appendChild(otherInput);
      queueMicrotask(() => otherInput.focus());
    } else {
      otherRow.addEventListener("click", () => {
        state.customText = "";
        if (!q.multi) state.selected = new Set();
        this.warning = "";
        this.slideDir = "none";
        this.render();
      });
    }

    options.appendChild(otherRow);
    host.appendChild(options);
  }

  private render(): void {
    this.el.replaceChildren();
    if (!this.pending) return;

    const total = this.pending.questions.length;
    const q = this.pending.questions[this.currentIndex];
    if (!q) return;

    const header = document.createElement("header");
    header.className = "ask-header";

    const title = document.createElement("h2");
    title.textContent = total > 1 ? `Question ${this.currentIndex + 1}/${total}` : "Question";

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "ask-dismiss-btn";
    dismissBtn.setAttribute("aria-label", "Dismiss");
    dismissBtn.textContent = "\u00d7";
    dismissBtn.addEventListener("click", () => this.dismiss());
    header.append(title, dismissBtn);

    const stage = document.createElement("div");
    stage.className = "ask-stage";

    const panel = document.createElement("div");
    panel.className = "ask-panel";
    if (this.slideDir === "left") panel.classList.add("slide-from-right");
    if (this.slideDir === "right") panel.classList.add("slide-from-left");

    const block = document.createElement("div");
    block.className = "ask-question-block";

    const qTitle = document.createElement("div");
    qTitle.className = "ask-question-title";
    qTitle.textContent = q.question;
    if (q.header) {
      const badge = document.createElement("span");
      badge.className = "ask-header-badge";
      badge.textContent = q.header;
      qTitle.appendChild(badge);
    }
    block.appendChild(qTitle);
    this.renderOptions(q, this.currentIndex, block);
    panel.appendChild(block);
    stage.appendChild(panel);

    if (this.warning) {
      const warn = document.createElement("div");
      warn.className = "ask-warning";
      warn.textContent = this.warning;
      stage.appendChild(warn);
    }

    const footer = document.createElement("footer");
    footer.className = "ask-footer";

    if (total > 1) {
      const nav = document.createElement("div");
      nav.className = "ask-nav";

      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "ask-nav-btn";
      prevBtn.textContent = "\u2039";
      prevBtn.title = "Previous question";
      prevBtn.disabled = this.currentIndex <= 0;
      prevBtn.addEventListener("click", () => this.goTo(this.currentIndex - 1, "right"));

      const dots = document.createElement("div");
      dots.className = "ask-dots";
      for (let i = 0; i < total; i++) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "ask-dot";
        if (i === this.currentIndex) dot.classList.add("active");
        if (this.isAnswered(i)) dot.classList.add("answered");
        dot.title = `Question ${i + 1}`;
        dot.addEventListener("click", () => {
          if (i === this.currentIndex) return;
          this.goTo(i, i > this.currentIndex ? "left" : "right");
        });
        dots.appendChild(dot);
      }

      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "ask-nav-btn";
      nextBtn.textContent = "\u203A";
      nextBtn.title = "Next question";
      nextBtn.disabled = this.currentIndex >= total - 1;
      nextBtn.addEventListener("click", () => this.goTo(this.currentIndex + 1, "left"));

      nav.append(prevBtn, dots, nextBtn);
      footer.appendChild(nav);
    } else {
      footer.appendChild(document.createElement("div"));
    }

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "ask-submit-btn";
    submitBtn.textContent = "Submit";
    submitBtn.addEventListener("click", () => this.submit());
    footer.appendChild(submitBtn);

    this.el.append(header, stage, footer);
    // Consume one-shot slide class after paint so re-renders don't re-animate.
    this.slideDir = "none";
  }
}
