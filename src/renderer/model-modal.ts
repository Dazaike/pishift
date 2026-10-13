import type { CustomModelConfig } from "../shared/ipc";
import { getProviderIcon } from "./provider-icons";
import { attachToolbarHoverPill, popoverMotion } from "./motion-utils";
import { animateBox } from "./morph";
import { attachPointerReorder, keysOf } from "./pointer-reorder";

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 12;

export const DEFAULT_USER_MODELS: CustomModelConfig[] = [
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", provider: "google" },
  { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", provider: "anthropic" },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai" },
  { id: "grok-4.5", name: "Grok 4.5", provider: "xai-oauth" },
];

export class ModelModal {
  readonly el: HTMLDivElement;
  private readonly anchor: HTMLElement | null;
  private models: CustomModelConfig[] = [];
  private currentModel: string;
  private editingModel: CustomModelConfig | null = null;
  private showAddForm = false;
  private isEditMode = false;
  private morphing = false;
  private kbIndex = -1;
  private listPill: { dispose: () => void; sync: (immediate?: boolean) => void } | null = null;
  private onSelectCallback: (modelId: string, provider?: string) => void;
  private onModelsChange: (models: CustomModelConfig[]) => void;

  constructor(
    savedModels: CustomModelConfig[] | undefined,
    currentModel: string,
    onSelect: (modelId: string, provider?: string) => void,
    onModelsChange: (models: CustomModelConfig[]) => void,
  ) {
    this.models = savedModels && savedModels.length > 0 ? savedModels : [...DEFAULT_USER_MODELS];
    this.currentModel = currentModel;
    this.onSelectCallback = onSelect;
    this.onModelsChange = onModelsChange;

    this.el = document.createElement("div");
    this.el.id = "model-popover";
    this.el.hidden = true;
    this.anchor = document.getElementById("dock-model");
    document.body.appendChild(this.el);

    document.addEventListener("mousedown", (ev) => {
      if (!this.el.hidden && !this.el.contains(ev.target as Node)) {
        if (this.anchor && this.anchor.contains(ev.target as Node)) return;
        this.close();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (this.el.hidden) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        if (this.isEditMode) this.setEditMode(false);
        else this.close();
        return;
      }
      if (this.showAddForm) return;
      const rows = this.models;
      if (rows.length === 0) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (ev.key === "ArrowDown") {
          this.kbIndex = this.kbIndex < rows.length - 1 ? this.kbIndex + 1 : 0;
        } else {
          this.kbIndex = this.kbIndex > 0 ? this.kbIndex - 1 : rows.length - 1;
        }
        this.paintKb();
        this.listPill?.sync();
        return;
      }
      if (ev.key === "Enter" && !this.isEditMode && this.kbIndex >= 0 && this.kbIndex < rows.length) {
        ev.preventDefault();
        this.selectModel(rows[this.kbIndex]!);
      }
    });

    window.addEventListener("resize", () => {
      if (this.isOpen) this.position();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  get activeModel(): string {
    return this.currentModel;
  }

  open(currentModel?: string): void {
    if (currentModel) this.currentModel = currentModel;
    this.showAddForm = false;
    this.endEditInstant();
    this.editingModel = null;
    this.kbIndex = -1;
    this.setTriggerOpen(true);
    this.render();
    requestAnimationFrame(() => {
      if (this.isOpen) {
        this.position();
        this.listPill?.sync(true);
      }
    });
    popoverMotion.animatePopoverOpen(this.el).then(() => this.listPill?.sync(true));
  }

  close(): void {
    if (this.el.hidden) return;
    this.endEditInstant();
    this.setTriggerOpen(false);
    popoverMotion.animatePopoverClose(this.el, () => {
      this.el.hidden = true;
      this.showAddForm = false;
      this.isEditMode = false;
      this.editingModel = null;
    });
  }

  private position(): void {
    // Mid-morph the box is animating; measuring it now would pin the popover to a transient size.
    if (this.morphing) return;
    const anchor = this.anchor;
    if (!anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    const menuW = this.el.offsetWidth || 460;
    const menuH = this.el.offsetHeight || 200;

    // Center horizontally over the Model button.
    let left = anchorRect.left + (anchorRect.width - menuW) / 2;
    left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(left, window.innerWidth - menuW - VIEWPORT_MARGIN),
    );

    // Prefer above the button with a clear gap; flip below if clipped.
    let top = anchorRect.top - menuH - ANCHOR_GAP;
    if (top < VIEWPORT_MARGIN) {
      top = Math.min(anchorRect.bottom + ANCHOR_GAP, window.innerHeight - menuH - VIEWPORT_MARGIN);
    }

    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  toggle(currentModel?: string): void {
    if (this.isOpen) this.close();
    else this.open(currentModel);
  }

  setCurrentModel(model: string): void {
    this.currentModel = model;
  }

  private addModel(model: CustomModelConfig): void {
    if (!model.id) return;
    this.models = this.models.filter((m) => m.id.toLowerCase() !== model.id.toLowerCase());
    this.models.push(model);
    this.onModelsChange(this.models);
    this.morphRender(() => {
      this.showAddForm = false;
      this.editingModel = null;
    });
  }

  private removeModel(id: string): void {
    this.models = this.models.filter((m) => m.id !== id);
    this.onModelsChange(this.models);
    this.morphRender(() => {});
  }

  /**
   * Re-renders after `change`, animating the popover's box from its old size to its new one. Its
   * bottom edge stays pinned above the Model button, so growth (edit options, the edit form)
   * expands upward; content reflows live.
   */
  private morphRender(change: () => void): void {
    const el = this.el;
    const first = el.getBoundingClientRect();
    // The popover has a width transition; it would fight the box animation and the rect measurements.
    el.style.transition = "none";
    this.morphing = true; // render() queues a position(); skip it, the box is about to animate
    change();
    this.render();
    el.classList.toggle("model-expanded", this.isEditMode);
    this.morphing = false;
    this.position();
    this.morphing = true;
    const last = el.getBoundingClientRect();
    animateBox(el, first, last, () => {
      this.morphing = false;
      this.position();
      void el.offsetWidth;
      el.style.transition = "";
    });
  }

  private setEditMode(on: boolean): void {
    if (on === this.isEditMode) return;
    this.morphRender(() => {
      this.isEditMode = on;
      this.showAddForm = false;
      this.editingModel = null;
    });
  }

  /** Leaves edit mode without animation (popover opening, closing). */
  private endEditInstant(): void {
    this.isEditMode = false;
    this.morphing = false;
    this.el.classList.remove("model-expanded");
    this.el.style.transition = "";
  }

  private render(): void {
    this.listPill?.dispose();
    this.listPill = null;
    this.el.replaceChildren();

    if (this.isOpen) {
      requestAnimationFrame(() => {
        if (this.isOpen) this.position();
      });
    }

    const header = document.createElement("header");
    header.className = "model-header";
    const title = document.createElement("h2");
    title.textContent = this.showAddForm
      ? this.editingModel
        ? "Edit Model"
        : "Add Model"
      : this.isEditMode
        ? "Manage Models"
        : "Switch Model";

    const headerActions = document.createElement("div");
    headerActions.className = "model-header-actions";

    if (this.showAddForm) {
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "model-btn-pill";
      backBtn.textContent = "Cancel";
      backBtn.addEventListener("click", () => {
        this.morphRender(() => {
          this.showAddForm = false;
          this.editingModel = null;
        });
      });
      headerActions.appendChild(backBtn);
    } else {
      // Edit mode toggle button (swaps with Done)
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = this.isEditMode ? "model-btn-pill active" : "model-btn-pill";
      editBtn.textContent = this.isEditMode ? "Done" : "Edit";
      editBtn.title = this.isEditMode ? "Finish editing" : "Edit, add, reorder, or delete models";
      editBtn.addEventListener("click", () => this.setEditMode(!this.isEditMode));
      headerActions.appendChild(editBtn);
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "model-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.title = "Close (Esc)";
    closeBtn.addEventListener("click", () => this.close());
    headerActions.appendChild(closeBtn);

    header.append(title, headerActions);
    this.el.appendChild(header);

    if (this.showAddForm) {
      const form = this.renderModelEditor();
      this.el.appendChild(form);
      return;
    }

    // Edit mode sub-toolbar (+ Add, Reorder toggle)
    if (this.isEditMode) {
      const editBar = document.createElement("div");
      editBar.className = "model-edit-toolbar";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "model-btn-pill accent";
      addBtn.textContent = "+ Add Model";
      addBtn.addEventListener("click", () => {
        this.morphRender(() => {
          this.editingModel = null;
          this.showAddForm = true;
        });
      });

      editBar.append(addBtn);
      this.el.appendChild(editBar);
    }


    const listContainer = document.createElement("div");
    listContainer.className = "model-list";
    this.renderList(listContainer);

    this.el.appendChild(listContainer);
  }
  private renderModelEditor(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "model-custom-form";

    const desc = document.createElement("p");
    desc.className = "model-custom-form-desc";
    desc.textContent = this.editingModel
      ? "Update this model in your switcher:"
      : "Add a model to your switcher:";

    const validationError = document.createElement("p");
    validationError.className = "model-form-error";
    validationError.hidden = true;

    const showValidationError = (message: string): void => {
      idInput.setAttribute("aria-invalid", "true");
      validationError.textContent = message;
      validationError.hidden = false;
    };

    const submitForm = (): void => {
      const id = idInput.value.trim();
      const name = nameInput.value.trim() || id;
      const provider = providerInput.value.trim() || "generic";
      const iconUrl = iconInput.value.trim() || undefined;

      if (!id) {
        showValidationError("Model ID is required.");
        return;
      }

      const model = { provider, id, name, iconUrl };
      const target = this.editingModel;
      if (!target) {
        this.addModel(model);
        return;
      }

      const targetIndex = this.models.indexOf(target);
      if (targetIndex === -1) {
        showValidationError("This model has been removed.");
        return;
      }

      const hasConflict = this.models.some(
        (existing, index) => index !== targetIndex && existing.id.toLowerCase() === id.toLowerCase(),
      );
      if (hasConflict) {
        showValidationError("A model with this ID already exists.");
        return;
      }

      const models = this.models.slice();
      models[targetIndex] = model;
      this.models = models;
      this.onModelsChange(models);
      this.morphRender(() => {
        this.showAddForm = false;
        this.editingModel = null;
      });
    };

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "model-form-input";
    nameInput.placeholder = "Model Display Name (e.g. Grok 4.5, Claude 3.7)";
    nameInput.spellcheck = false;

    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.className = "model-form-input";
    idInput.placeholder = "Model ID (e.g. grok-4.5, claude-3-7-sonnet)";
    idInput.spellcheck = false;

    const providerInput = document.createElement("input");
    providerInput.type = "text";
    providerInput.className = "model-form-input";
    providerInput.placeholder = "Provider (e.g. xAI, Anthropic, Google, OpenAI)";
    providerInput.spellcheck = false;

    const iconInput = document.createElement("input");
    iconInput.type = "url";
    iconInput.className = "model-form-input";
    iconInput.placeholder = "Icon Image URL (optional)";
    iconInput.spellcheck = false;

    if (this.editingModel) {
      const model = this.editingModel;
      nameInput.value = model.name;
      idInput.value = model.id;
      providerInput.value = model.provider;
      iconInput.value = model.iconUrl ?? "";
    }

    const inputs = [nameInput, idInput, providerInput, iconInput];
    for (const inp of inputs) {
      inp.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") {
          ev.preventDefault();
          submitForm();
        }
      });
    }

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "model-form-save";
    saveBtn.textContent = this.editingModel ? "Save Changes" : "Save Model";
    saveBtn.addEventListener("click", submitForm);

    wrap.append(desc, nameInput, idInput, providerInput, iconInput, validationError, saveBtn);

    return wrap;
  }

  private selectModel(item: CustomModelConfig): void {
    if (this.isEditMode) return;
    const providerArg =
      item.provider && item.provider !== "generic" ? item.provider : undefined;
    this.currentModel = item.id;
    this.onSelectCallback(item.id, providerArg);
    this.close();
  }

  private setTriggerOpen(open: boolean): void {
    const btn = document.getElementById("dock-model");
    if (!btn) return;
    btn.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  private paintKb(): void {
    const rows = this.el.querySelectorAll(".model-row");
    rows.forEach((row, i) => {
      row.classList.toggle("kb-active", i === this.kbIndex);
      if (i === this.kbIndex && typeof row.scrollIntoView === "function") {
        row.scrollIntoView({ block: "nearest" });
      }
    });
  }

  private renderList(container: HTMLElement): void {
    container.replaceChildren();

    if (this.models.length === 0) {
      const empty = document.createElement("div");
      empty.className = "model-empty";
      empty.textContent = "No models added yet. Click 'Edit' -> '+ Add Model'.";
      container.appendChild(empty);
      return;
    }

    const listEl = document.createElement("div");
    listEl.className = this.isEditMode ? "model-grid-list editing" : "model-grid-list";
    attachPointerReorder(container, {
      isActive: () => this.isEditMode && !this.showAddForm,
      resolveItem: (target) => (target.closest("button") ? null : target.closest<HTMLElement>(".model-row[data-key]")),
      onCommit: (list) => {
        const byId = new Map(this.models.map((m) => [m.id, m]));
        const next = keysOf(list).flatMap((id) => byId.get(id) ?? []);
        if (next.length !== this.models.length) return;
        this.models = next;
        this.onModelsChange(this.models);
      },
    });

    for (let i = 0; i < this.models.length; i++) {
      const item = this.models[i]!;

      const card = document.createElement("div");
      let cardClass = "model-row";
      if (i === this.kbIndex) cardClass += " kb-active";
      if (this.isEditMode) cardClass += " in-edit";
      if (item.id === this.currentModel) cardClass += " active";
      card.className = cardClass;
      card.dataset.key = item.id;
      card.dataset.modelId = item.id;
      card.setAttribute("role", "option");
      card.title = this.isEditMode ? `Drag to reorder ${item.name}` : `Switch to ${item.name}`;

      const iconWrap = document.createElement("span");
      iconWrap.className = "model-provider-icon";
      if (item.iconUrl) {
        iconWrap.innerHTML = `<img src="${item.iconUrl}" alt="" class="model-custom-img-icon" onerror="this.remove()" />`;
      } else {
        iconWrap.innerHTML = getProviderIcon(item.provider);
      }

      const nameSpan = document.createElement("span");
      nameSpan.className = "model-row-name";
      nameSpan.textContent = item.name;

      card.append(iconWrap, nameSpan);

      if (item.id === this.currentModel) {
        const checkSpan = document.createElement("span");
        checkSpan.className = "model-row-check";
        checkSpan.textContent = "\u2713";
        card.appendChild(checkSpan);
      }

      if (this.isEditMode) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "model-row-edit-btn";
        editBtn.title = `Edit ${item.name}`;
        editBtn.setAttribute("aria-label", `Edit ${item.name}`);
        editBtn.textContent = "\u270e";
        editBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.morphRender(() => {
            this.editingModel = item;
            this.showAddForm = true;
          });
        });

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "model-row-del-btn";
        delBtn.title = `Delete ${item.name}`;
        delBtn.textContent = "\u00d7";
        delBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.removeModel(item.id);
        });
        card.append(editBtn, delBtn);
      }


      card.addEventListener("click", () => {
        if (card.classList.contains("reorder-dragging")) return;
        this.selectModel(item);
      });

      listEl.appendChild(card);
    }

    listEl.style.position = "relative";
    container.appendChild(listEl);
    this.listPill = attachToolbarHoverPill(listEl, {
      itemSelector: ".model-row",
      parkedSelector: "",
      pillClass: "model-row-indicator",
      box: true,
    });
    requestAnimationFrame(() => this.listPill?.sync(true));
  }
}
