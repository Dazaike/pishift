// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ModelModal, DEFAULT_USER_MODELS } from "../src/renderer/model-modal";

describe("ModelModal", () => {
  it("does not wipe input when setCurrentModel is called while add form is open", () => {
    const onSelect = vi.fn();
    const onModelsChange = vi.fn();
    const modal = new ModelModal(DEFAULT_USER_MODELS, "gemini-3.7-flash", onSelect, onModelsChange);

    modal.open();
    // Navigate to Add Model form
    const editBtn = modal.el.querySelector<HTMLButtonElement>(".model-header-actions .model-btn-pill");
    expect(editBtn).not.toBeNull();
    editBtn?.click();

    const addBtn = modal.el.querySelector<HTMLButtonElement>(".model-btn-pill.accent");
    expect(addBtn).not.toBeNull();
    addBtn?.click();

    // Verify Add Model form inputs exist
    const idInput = modal.el.querySelectorAll<HTMLInputElement>(".model-form-input")[1];
    expect(idInput).not.toBeNull();
    idInput.value = "my-custom-model-id";

    // Simulate periodic status stream updating current model
    modal.setCurrentModel("claude-3-7-sonnet");

    // The inputs must still be in the DOM with their values intact
    const currentIdInput = modal.el.querySelectorAll<HTMLInputElement>(".model-form-input")[1];
    expect(currentIdInput).toBe(idInput);
    expect(currentIdInput.value).toBe("my-custom-model-id");
  });

  it("submits form on Enter key in inputs", () => {
    const onSelect = vi.fn();
    const onModelsChange = vi.fn();
    const modal = new ModelModal(DEFAULT_USER_MODELS, "gemini-3.7-flash", onSelect, onModelsChange);

    modal.open();
    // Navigate to Add Model form
    modal.el.querySelector<HTMLButtonElement>(".model-header-actions .model-btn-pill")?.click();
    modal.el.querySelector<HTMLButtonElement>(".model-btn-pill.accent")?.click();

    const inputs = modal.el.querySelectorAll<HTMLInputElement>(".model-form-input");
    const nameInput = inputs[0]!;
    const idInput = inputs[1]!;

    nameInput.value = "Grok 4.6";
    idInput.value = "grok-4.6";

    // Press Enter inside id input
    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    idInput.dispatchEvent(enterEvent);

    expect(onModelsChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "grok-4.6", name: "Grok 4.6" }),
      ]),
    );
  });

  it("closes on Escape key", () => {
    const onSelect = vi.fn();
    const onModelsChange = vi.fn();
    const modal = new ModelModal(DEFAULT_USER_MODELS, "gemini-3.7-flash", onSelect, onModelsChange);

    modal.open();
    expect(modal.isOpen).toBe(true);

    const escEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escEvent);

    expect(modal.isOpen).toBe(false);
  });

  it("does not rebuild the list when the current model updates", () => {
    const modal = new ModelModal(DEFAULT_USER_MODELS, "gemini-3.7-flash", vi.fn(), vi.fn());
    modal.open();
    const first = modal.el.querySelector(".model-row");
    expect(first).not.toBeNull();
    const activeBefore = modal.el.querySelector(".model-row.active");
    expect(activeBefore?.getAttribute("data-model-id")).toBe("gemini-3.7-flash");
    modal.setCurrentModel("grok-4.5");
    expect(modal.el.querySelector(".model-row")).toBe(first);
    // setCurrentModel does not re-render, so the active indicator must not have moved.
    expect(modal.el.querySelector(".model-row.active")).toBe(activeBefore);
  });

  it("selects the keyboard-highlighted model with Enter", () => {
    const onSelect = vi.fn();
    const modal = new ModelModal(DEFAULT_USER_MODELS, "gemini-3.7-flash", onSelect, vi.fn());
    modal.open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(onSelect).toHaveBeenCalledWith("gemini-3.7-flash", "google");
  });

  it("opens the model editor with the selected configuration populated", () => {
    const models = [
      { id: "first", name: "First Model", provider: "first-provider", iconUrl: "https://example.test/first.svg" },
      { id: "second", name: "Second Model", provider: "second-provider" },
    ];
    const modal = new ModelModal(models, "first", vi.fn(), vi.fn());

    modal.open();
    modal.el.querySelector<HTMLButtonElement>(".model-header-actions .model-btn-pill")?.click();
    modal.el.querySelector<HTMLButtonElement>(".model-row-edit-btn")?.click();

    expect(modal.el.querySelector("h2")?.textContent).toBe("Edit Model");
    const inputs = modal.el.querySelectorAll<HTMLInputElement>(".model-form-input");
    expect(inputs[0]?.value).toBe("First Model");
    expect(inputs[1]?.value).toBe("first");
    expect(inputs[2]?.value).toBe("first-provider");
    expect(inputs[3]?.value).toBe("https://example.test/first.svg");
  });

  it("replaces an edited model in place and clears a blank icon URL", () => {
    const models = [
      { id: "first", name: "First Model", provider: "first-provider", iconUrl: "https://example.test/first.svg" },
      { id: "second", name: "Second Model", provider: "second-provider" },
    ];
    const onModelsChange = vi.fn();
    const modal = new ModelModal(models, "first", vi.fn(), onModelsChange);

    modal.open();
    modal.el.querySelector<HTMLButtonElement>(".model-header-actions .model-btn-pill")?.click();
    modal.el.querySelector<HTMLButtonElement>(".model-row-edit-btn")?.click();
    const inputs = modal.el.querySelectorAll<HTMLInputElement>(".model-form-input");
    inputs[0]!.value = "Renamed First";
    inputs[1]!.value = "renamed-first";
    inputs[2]!.value = "updated-provider";
    inputs[3]!.value = "";
    modal.el.querySelector<HTMLButtonElement>(".model-form-save")?.click();

    expect(onModelsChange).toHaveBeenCalledWith([
      { id: "renamed-first", name: "Renamed First", provider: "updated-provider", iconUrl: undefined },
      { id: "second", name: "Second Model", provider: "second-provider" },
    ]);
  });

  it("keeps the editor open without persisting a conflicting edited model ID", () => {
    const models = [
      { id: "first", name: "First Model", provider: "first-provider" },
      { id: "second", name: "Second Model", provider: "second-provider" },
    ];
    const onModelsChange = vi.fn();
    const modal = new ModelModal(models, "first", vi.fn(), onModelsChange);

    modal.open();
    modal.el.querySelector<HTMLButtonElement>(".model-header-actions .model-btn-pill")?.click();
    modal.el.querySelector<HTMLButtonElement>(".model-row-edit-btn")?.click();
    modal.el.querySelectorAll<HTMLInputElement>(".model-form-input")[1]!.value = "SECOND";
    modal.el.querySelector<HTMLButtonElement>(".model-form-save")?.click();

    expect(onModelsChange).not.toHaveBeenCalled();
    expect(modal.el.querySelector(".model-form-error")?.textContent).toBe("A model with this ID already exists.");
    expect(modal.el.querySelectorAll<HTMLInputElement>(".model-form-input")[1]?.value).toBe("SECOND");
    modal.el.querySelector<HTMLButtonElement>(".model-header-actions .model-btn-pill")?.click();
    expect(
      Array.from(modal.el.querySelectorAll(".model-row"), (row) => row.getAttribute("data-model-id")),
    ).toEqual(["first", "second"]);
  });

  it("hides row edit actions while reordering", () => {
    const modal = new ModelModal(DEFAULT_USER_MODELS, "gemini-3.7-flash", vi.fn(), vi.fn());

    modal.open();
    modal.el.querySelector<HTMLButtonElement>(".model-header-actions .model-btn-pill")?.click();
    expect(modal.el.querySelectorAll(".model-row-edit-btn")).toHaveLength(DEFAULT_USER_MODELS.length);
    Array.from(modal.el.querySelectorAll<HTMLButtonElement>(".model-btn-pill"))
      .find((button) => button.textContent === "Reorder")
      ?.click();

    expect(modal.el.querySelectorAll(".model-row-edit-btn")).toHaveLength(0);
  });
});
