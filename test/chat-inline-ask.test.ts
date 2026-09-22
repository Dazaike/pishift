// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ChatInlineAsk } from "../src/renderer/chat-inline-ask";
import type { PendingAsk } from "../src/shared/ipc";

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
      multi: true,
      options: [{ label: "Autonomous execution" }, { label: "Step-by-step with approval" }],
      recommended: 1,
    },
    {
      id: "q3",
      question: "Execution mode",
      options: [{ label: "Fast" }, { label: "Safe" }],
    },
  ],
};

describe("ChatInlineAsk", () => {
  it("answers single/multi/Other end to end with the AskAnswer shape", () => {
    const card = new ChatInlineAsk();
    const onSubmit = vi.fn();
    const onDismiss = vi.fn();
    card.open(pending, onSubmit, onDismiss);

    const progress = card.el.querySelector<HTMLSpanElement>(".chat-ask-progress");
    expect(progress?.textContent).toBe("0 of 3 answered");
    expect(card.el.querySelectorAll(".chat-ask-option.selected").length).toBe(0);

    // Submit blocked until every question is answered.
    card.el.querySelector<HTMLButtonElement>(".chat-ask-submit")?.click();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(progress?.classList.contains("ask-progress-error")).toBe(true);
    expect(progress?.textContent).toBe("3 question(s) remaining — answer all first.");
    expect(card.el.querySelector(".chat-ask-q.missing")).not.toBeNull();

    // Single-select question: option click + recommended suffix.
    const firstOption = card.el.querySelectorAll<HTMLButtonElement>(
      ".chat-ask-q[data-index='0'] .chat-ask-option",
    )[0];
    expect(firstOption?.textContent).toContain("(Recommended)");
    firstOption?.click();
    expect(card.el.querySelector<HTMLSpanElement>(".chat-ask-progress")?.textContent).toBe(
      "1 of 3 answered",
    );

    // Multi-select question: toggle one option.
    const secondOptions = card.el.querySelectorAll<HTMLButtonElement>(
      ".chat-ask-q[data-index='1'] .chat-ask-option",
    );
    secondOptions[1]?.click();
    expect(card.el.querySelector<HTMLSpanElement>(".chat-ask-progress")?.textContent).toBe(
      "2 of 3 answered",
    );

    // Third question answered via Other custom text.
    card.el.querySelector<HTMLDivElement>(".chat-ask-q[data-index='2'] .chat-ask-other")?.click();
    const otherInput = card.el.querySelector<HTMLInputElement>(
      ".chat-ask-q[data-index='2'] .chat-ask-other-input",
    );
    expect(otherInput).not.toBeNull();
    if (otherInput) {
      otherInput.value = "Careful";
      otherInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(card.el.querySelector<HTMLSpanElement>(".chat-ask-progress")?.textContent).toBe(
      "3 of 3 answered",
    );

    card.el.querySelector<HTMLButtonElement>(".chat-ask-submit")?.click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([
      {
        multi: false,
        optionsCount: 2,
        recommended: 0,
        selectedIndices: [0],
      },
      {
        multi: true,
        optionsCount: 2,
        recommended: 1,
        selectedIndices: [1],
      },
      {
        multi: false,
        optionsCount: 2,
        recommended: undefined,
        selectedIndices: [],
        customText: "Careful",
      },
    ]);
    expect(card.isOpen).toBe(false);
  });

  it("preserves half-entered answers on same-toolCallId reopen and dismisses", () => {
    const card = new ChatInlineAsk();
    const onSubmit = vi.fn();
    const onDismiss = vi.fn();
    card.open(pending, onSubmit, onDismiss);
    card.el
      .querySelectorAll<HTMLButtonElement>(".chat-ask-q[data-index='0'] .chat-ask-option")[0]
      ?.click();
    expect(card.el.querySelectorAll(".chat-ask-option.selected").length).toBe(1);

    card.open(pending, onSubmit, onDismiss);
    expect(card.el.querySelectorAll(".chat-ask-option.selected").length).toBe(1);

    card.el.querySelector<HTMLButtonElement>(".chat-ask-x")?.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(card.isOpen).toBe(false);
  });
});
