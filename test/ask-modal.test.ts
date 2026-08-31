// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AskModal } from "../src/renderer/ask-modal";
import type { PendingAsk } from "../src/shared/ipc";

describe("AskModal", () => {
  it("does not auto-select questions and shows remaining indicator", () => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const askModal = new AskModal();
    const onSubmit = vi.fn();
    const onDismiss = vi.fn();

    const pending: PendingAsk = {
      toolCallId: "call_123",
      questions: [
        {
          id: "q1",
          question: "What would you like to focus on today?",
          header: "Focus",
          options: [
            { label: "Build a new project", description: "Create new tools" },
            { label: "Work on an existing project" },
          ],
          recommended: 0,
        },
        {
          id: "q2",
          question: "How would you prefer we coordinate tasks?",
          options: [
            { label: "Autonomous execution" },
            { label: "Step-by-step with approval" },
          ],
          recommended: 1,
        },
        {
          id: "q3",
          question: "Execution mode",
          options: [
            { label: "Fast" },
            { label: "Safe" },
          ],
        },
      ],
    };

    askModal.open(pending, onSubmit, onDismiss);

    // Verify progress text indicates 0 of 3 answered, 3 remaining
    const progress = askModal.el.querySelector<HTMLSpanElement>(".ask-progress");
    expect(progress).not.toBeNull();
    expect(progress?.textContent).toBe("0 of 3 answered (3 remaining)");

    // Verify none of the option rows are selected initially
    const selectedRows = askModal.el.querySelectorAll(".ask-option-row.selected");
    expect(selectedRows.length).toBe(0);

    // Clicking submit with unanswered questions shows error
    const submitBtn = askModal.el.querySelector<HTMLButtonElement>(".ask-submit-btn");
    submitBtn?.click();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(progress?.classList.contains("ask-progress-error")).toBe(true);
    expect(progress?.textContent).toBe("3 questions remaining — answer all first.");

    // Answer question 1
    const firstQuestionOption = askModal.el.querySelectorAll<HTMLButtonElement>(".ask-question-block[data-index='0'] .ask-option-row")[0];
    firstQuestionOption?.click();

    const updatedProgress = askModal.el.querySelector<HTMLSpanElement>(".ask-progress");
    expect(updatedProgress?.textContent).toBe("1 of 3 answered (2 remaining)");
    expect(updatedProgress?.classList.contains("ask-progress-error")).toBe(false);

    // Answer question 2
    const secondQuestionOption = askModal.el.querySelectorAll<HTMLButtonElement>(".ask-question-block[data-index='1'] .ask-option-row")[1];
    secondQuestionOption?.click();
    expect(askModal.el.querySelector<HTMLSpanElement>(".ask-progress")?.textContent).toBe("2 of 3 answered (1 remaining)");

    // Answer question 3 with Other custom text
    const otherRow = askModal.el.querySelector<HTMLDivElement>(".ask-question-block[data-index='2'] .ask-other-row");
    otherRow?.click();

    const otherInput = askModal.el.querySelector<HTMLInputElement>(".ask-question-block[data-index='2'] .ask-other-input");
    expect(otherInput).not.toBeNull();
    if (otherInput) {
      otherInput.value = "Custom execution";
      otherInput.dispatchEvent(new Event("input"));
    }

    expect(askModal.el.querySelector<HTMLSpanElement>(".ask-progress")?.textContent).toBe("3 of 3 answered (0 remaining)");

    // Submit when all answered
    askModal.el.querySelector<HTMLButtonElement>(".ask-submit-btn")?.click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([
      {
        multi: false,
        optionsCount: 2,
        recommended: 0,
        selectedIndices: [0],
      },
      {
        multi: false,
        optionsCount: 2,
        recommended: 1,
        selectedIndices: [1],
      },
      {
        multi: false,
        optionsCount: 2,
        recommended: undefined,
        selectedIndices: [],
        customText: "Custom execution",
      },
    ]);
  });

  it("handles single-question asks without pre-selection", () => {
    const askModal = new AskModal();
    const onSubmit = vi.fn();
    const onDismiss = vi.fn();

    const pending: PendingAsk = {
      toolCallId: "call_single",
      questions: [
        {
          id: "q_only",
          question: "Confirm deployment?",
          options: [
            { label: "Yes, deploy now" },
            { label: "Cancel" },
          ],
          recommended: 0,
        },
      ],
    };

    askModal.open(pending, onSubmit, onDismiss);

    const progress = askModal.el.querySelector<HTMLSpanElement>(".ask-progress");
    expect(progress?.textContent).toBe("0 of 1 answered (1 remaining)");

    // Submit fails when not selected
    askModal.el.querySelector<HTMLButtonElement>(".ask-submit-btn")?.click();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(progress?.textContent).toBe("1 question remaining — answer all first.");

    // Select Yes
    const yesOption = askModal.el.querySelector<HTMLButtonElement>(".ask-option-row");
    yesOption?.click();
    expect(askModal.el.querySelector<HTMLSpanElement>(".ask-progress")?.textContent).toBe("1 of 1 answered (0 remaining)");

    askModal.el.querySelector<HTMLButtonElement>(".ask-submit-btn")?.click();
    expect(onSubmit).toHaveBeenCalledWith([
      {
        multi: false,
        optionsCount: 2,
        recommended: 0,
        selectedIndices: [0],
      },
    ]);
  });

  it("handles multi-select questions correctly", () => {
    const askModal = new AskModal();
    const onSubmit = vi.fn();
    const onDismiss = vi.fn();

    const pending: PendingAsk = {
      toolCallId: "call_multi",
      questions: [
        {
          id: "q_multi",
          question: "Select target environments",
          multi: true,
          options: [
            { label: "Dev" },
            { label: "Staging" },
            { label: "Prod" },
          ],
        },
      ],
    };

    askModal.open(pending, onSubmit, onDismiss);
    const progress = askModal.el.querySelector<HTMLSpanElement>(".ask-progress");
    expect(progress?.textContent).toBe("0 of 1 answered (1 remaining)");

    const options = askModal.el.querySelectorAll<HTMLButtonElement>(".ask-option-row");
    // Select Dev and Prod
    options[0]?.click();
    options[2]?.click();
    expect(askModal.el.querySelector<HTMLSpanElement>(".ask-progress")?.textContent).toBe("1 of 1 answered (0 remaining)");

    // Unselect Dev and Prod -> becomes 0 answered
    const updatedOptions = askModal.el.querySelectorAll<HTMLButtonElement>(".ask-option-row");
    updatedOptions[0]?.click();
    updatedOptions[2]?.click();
    expect(askModal.el.querySelector<HTMLSpanElement>(".ask-progress")?.textContent).toBe("0 of 1 answered (1 remaining)");
  });
});
