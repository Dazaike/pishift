import type { CustomModelConfig } from "../shared/ipc";
import { INTERNAL_DRAG_TYPE } from "./dnd";
import { getProviderIcon } from "./provider-icons";
import { attachToolbarHoverPill, popoverMotion, SlidingPillIndicator } from "./motion-utils";

export const DEFAULT_USER_MODELS: CustomModelConfig[] = [
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", provider: "google" },
  { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", provider: "anthropic" },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai" },
  { id: "grok-4.5", name: "Grok 4.5", provider: "xai-oauth" },
];
export type ModelViewMode = "list" | "grid";

export class ModelModal {
  readonly el: HTMLDivElement;
  private models: CustomModelConfig[] = [];
  private currentModel: string;
  private showAddForm = false;
  private isEditMode = false;
  private isReordering = false;
  private viewMode: ModelViewMode = "list";
  private kbIndex = -1;
  private listPill: { dispose: () => void; sync: (immediate?: boolean) => void } | null = null;
  private draggedIndex: number | null = null;
  private onSelectCallback: (modelId: string, provider?: string) => void;
  private onModelsChange: (models: CustomModelConfig[]) => void;

  constructor(
    savedModels: CustomModelConfig[] | undefined,
    currentModel: string,
    onSelect: (modelId: string, provider?: string) => void,
    onModelsChange: (models: CustomModelConfig[]) => void,
    initialViewMode: ModelViewMode = "list",
  ) {
    this.models = savedModels && savedModels.length > 0 ? savedModels : [...DEFAULT_USER_MODELS];
    this.currentModel = currentModel;
    this.viewMode = initialViewMode;
    this.onSelectCallback = onSelect;
    this.onModelsChange = onModelsChange;

    this.el = document.createElement("div");
    this.el.id = "model-popover";
    this.el.hidden = true;

    document.addEventListener("mousedown", (ev) => {
      if (!this.el.hidden && !this.el.contains(ev.target as Node)) {
        const modelBtn = document.getElementById("dock-model");
        if (modelBtn && modelBtn.contains(ev.target as Node)) return;
        this.close();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (this.el.hidden) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        this.close();
        return;
      }
      if (this.showAddForm || this.isReordering) return;
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
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(currentModel?: string): void {
    if (currentModel) this.currentModel = currentModel;
    this.showAddForm = false;
    this.isEditMode = false;
    this.isReordering = false;
    this.kbIndex = -1;
    this.setTriggerOpen(true);
    this.render();
    const controls = popoverMotion.animatePopoverOpen(this.el);
    controls.then(() => this.listPill?.sync(true));
  }

  close(): void {
    if (this.el.hidden) return;
    this.setTriggerOpen(false);
    popoverMotion.animatePopoverClose(this.el, () => {
      this.el.hidden = true;
      this.showAddForm = false;
      this.isEditMode = false;
      this.isReordering = false;
    });
  }

  toggle(currentModel?: string): void {
    if (this.isOpen) this.close();
    else this.open(currentModel);
  }

  setCurrentModel(model: string): void {
    this.currentModel = model;
    if (this.isOpen && !this.showAddForm) this.paintActive();
  }

  private addModel(model: CustomModelConfig): void {
    if (!model.id) return;
    this.models = this.models.filter((m) => m.id.toLowerCase() !== model.id.toLowerCase());
    this.models.push(model);
    this.onModelsChange(this.models);
    this.showAddForm = false;
    this.render();
  }

  private removeModel(id: string): void {
    this.models = this.models.filter((m) => m.id !== id);
    this.onModelsChange(this.models);
    this.render();
  }

  private render(): void {
    this.listPill?.dispose();
    this.listPill = null;
    this.el.replaceChildren();
    this.el.classList.toggle("grid-view", this.viewMode === "grid");

    const header = document.createElement("header");
    header.className = "model-header";
    const title = document.createElement("h2");
    title.textContent = this.showAddForm
      ? "Add Model"
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
        this.showAddForm = false;
        this.render();
      });
      headerActions.appendChild(backBtn);
    } else {
      // Edit mode toggle button (swaps with Done)
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = this.isEditMode ? "model-btn-pill active" : "model-btn-pill";
      editBtn.textContent = this.isEditMode ? "Done" : "Edit";
      editBtn.title = this.isEditMode ? "Finish editing" : "Edit, add, reorder, or delete models";
      editBtn.addEventListener("click", () => {
        this.isEditMode = !this.isEditMode;
        if (!this.isEditMode) this.isReordering = false;
        this.render();
      });
      headerActions.appendChild(editBtn);

      // Grid / List toggle with sliding pill
      const viewToggle = document.createElement("div");
      viewToggle.className = "model-view-toggle";
      viewToggle.setAttribute("role", "group");
      viewToggle.setAttribute("aria-label", "Model list layout");

      const listBtn = document.createElement("button");
      listBtn.type = "button";
      listBtn.className = "model-view-toggle-btn";
      listBtn.classList.toggle("active", this.viewMode === "list");
      listBtn.textContent = "List";
      listBtn.addEventListener("click", () => {
        if (this.viewMode === "list") return;
        this.viewMode = "list";
        this.render();
      });

      const gridBtn = document.createElement("button");
      gridBtn.type = "button";
      gridBtn.className = "model-view-toggle-btn";
      gridBtn.classList.toggle("active", this.viewMode === "grid");
      gridBtn.textContent = "Grid";
      gridBtn.addEventListener("click", () => {
        if (this.viewMode === "grid") return;
        this.viewMode = "grid";
        this.render();
      });

      viewToggle.append(listBtn, gridBtn);
      headerActions.appendChild(viewToggle);
      const indicator = new SlidingPillIndicator(viewToggle, {
        pillClass: "model-view-indicator",
      });
      const activeToggle = this.viewMode === "grid" ? gridBtn : listBtn;
      requestAnimationFrame(() => indicator.sync(activeToggle, true));
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
      const form = this.renderAddForm();
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
        this.showAddForm = true;
        this.render();
      });

      const reorderBtn = document.createElement("button");
      reorderBtn.type = "button";
      reorderBtn.className = this.isReordering ? "model-btn-pill active" : "model-btn-pill";
      reorderBtn.textContent = this.isReordering ? "Done Reordering" : "Reorder";
      reorderBtn.title = "Enable drag-and-drop handles on models";
      reorderBtn.addEventListener("click", () => {
        this.isReordering = !this.isReordering;
        this.render();
      });

      editBar.append(addBtn, reorderBtn);
      this.el.appendChild(editBar);
    }


    const listContainer = document.createElement("div");
    listContainer.className = "model-list";
    this.renderList(listContainer);

    this.el.appendChild(listContainer);
  }
  private renderAddForm(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "model-custom-form";

    const desc = document.createElement("p");
    desc.className = "model-custom-form-desc";
    desc.textContent = "Add a model to your switcher:";

    const submitForm = (): void => {
      const id = idInput.value.trim();
      const name = nameInput.value.trim() || id;
      const provider = providerInput.value.trim() || "generic";
      const iconUrl = iconInput.value.trim() || undefined;

      if (!id) return;
      this.addModel({ provider, id, name, iconUrl });
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
    saveBtn.textContent = "Save Model";
    saveBtn.addEventListener("click", submitForm);

    wrap.append(desc, nameInput, idInput, providerInput, iconInput, saveBtn);

    if (this.models.length > 0) {
      const savedList = document.createElement("div");
      savedList.className = "model-custom-saved-list";
      const savedTitle = document.createElement("h4");
      savedTitle.textContent = "Manage Models (Click \u00d7 to remove):";
      savedList.appendChild(savedTitle);

      for (const m of this.models) {
        const item = document.createElement("div");
        item.className = "model-custom-saved-item";

        const label = document.createElement("span");
        label.textContent = `${m.name} (${m.id})`;

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "model-custom-del";
        delBtn.textContent = "\u00d7";
        delBtn.title = `Delete ${m.name}`;
        delBtn.addEventListener("click", () => this.removeModel(m.id));

        item.append(label, delBtn);
        savedList.appendChild(item);
      }
      wrap.appendChild(savedList);
    }

    return wrap;
  }

  private selectModel(item: CustomModelConfig): void {
    if (this.isReordering || this.isEditMode) return;
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

  private isCurrentModel(item: CustomModelConfig): boolean {
    const cur = this.currentModel.toLowerCase();
    return cur.includes(item.id.toLowerCase()) || cur.includes(item.name.toLowerCase());
  }

  private paintActive(): void {
    for (const row of this.el.querySelectorAll<HTMLElement>(".model-row")) {
      const id = row.dataset.modelId ?? "";
      const name = row.querySelector(".model-row-name")?.textContent ?? "";
      const cur = this.currentModel.toLowerCase();
      row.classList.toggle("active", cur.includes(id.toLowerCase()) || cur.includes(name.toLowerCase()));
    }
    this.listPill?.sync();
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
    listEl.className = this.viewMode === "grid" ? "model-grid-list" : "model-vertical-list";

    for (let i = 0; i < this.models.length; i++) {
      const item = this.models[i]!;
      const isCurrent = this.isCurrentModel(item);

      const card = document.createElement("div");
      let cardClass = "model-row";
      if (isCurrent) cardClass += " active";
      if (i === this.kbIndex) cardClass += " kb-active";
      if (this.isEditMode) cardClass += " in-edit";
      if (this.isReordering) cardClass += " reorderable";
      card.className = cardClass;
      card.draggable = this.isReordering;
      card.dataset.index = String(i);
      card.dataset.modelId = item.id;
      card.setAttribute("role", "option");
      card.title = this.isReordering
        ? `Drag to reorder ${item.name}`
        : `Switch to ${item.name}`;

      if (this.isReordering) {
        card.addEventListener("dragstart", (ev) => {
          this.draggedIndex = i;
          card.classList.add("dragging");
          if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = "move";
            ev.dataTransfer.setData("text/plain", String(i));
            ev.dataTransfer.setData(INTERNAL_DRAG_TYPE, "model");
          }
        });

        card.addEventListener("dragend", () => {
          this.draggedIndex = null;
          card.classList.remove("dragging");
          const overElements = listEl.querySelectorAll(".drag-over");
          for (const el of overElements) el.classList.remove("drag-over");
        });

        card.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
          if (this.draggedIndex !== null && this.draggedIndex !== i) {
            card.classList.add("drag-over");
          }
        });

        card.addEventListener("dragleave", () => {
          card.classList.remove("drag-over");
        });

        card.addEventListener("drop", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          card.classList.remove("drag-over");
          if (this.draggedIndex !== null && this.draggedIndex !== i) {
            const from = this.draggedIndex;
            const to = i;
            const moved = this.models.splice(from, 1)[0];
            if (moved) {
              this.models.splice(to, 0, moved);
              this.onModelsChange(this.models);
              this.render();
            }
          }
          this.draggedIndex = null;
        });

        const reorderArrows = document.createElement("div");
        reorderArrows.className = "model-reorder-arrows";

        if (i > 0) {
          const upBtn = document.createElement("button");
          upBtn.type = "button";
          upBtn.className = "model-arrow-btn";
          upBtn.innerHTML = `&#9650;`;
          upBtn.title = "Move up";
          upBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const moved = this.models.splice(i, 1)[0];
            if (moved) {
              this.models.splice(i - 1, 0, moved);
              this.onModelsChange(this.models);
              this.render();
            }
          });
          reorderArrows.appendChild(upBtn);
        }

        if (i < this.models.length - 1) {
          const downBtn = document.createElement("button");
          downBtn.type = "button";
          downBtn.className = "model-arrow-btn";
          downBtn.innerHTML = `&#9660;`;
          downBtn.title = "Move down";
          downBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const moved = this.models.splice(i, 1)[0];
            if (moved) {
              this.models.splice(i + 1, 0, moved);
              this.onModelsChange(this.models);
              this.render();
            }
          });
          reorderArrows.appendChild(downBtn);
        }

        card.appendChild(reorderArrows);
      }

      const iconWrap = document.createElement("span");
      iconWrap.className = "model-provider-icon";
      if (item.iconUrl) {
        iconWrap.innerHTML = `<img src="${item.iconUrl}" alt="" class="model-custom-img-icon" onerror="this.remove()" />`;
      } else {
        iconWrap.innerHTML = getProviderIcon(item.provider);
      }

      const textCol = document.createElement("span");
      textCol.className = "model-row-text";

      const nameSpan = document.createElement("span");
      nameSpan.className = "model-row-name";
      nameSpan.textContent = item.name;

      const providerLabel = (item.provider || "model").replace(/-oauth$/i, "");
      const metaSpan = document.createElement("span");
      metaSpan.className = "model-row-meta";
      metaSpan.textContent = providerLabel;
      if (this.viewMode === "grid") {
        textCol.append(nameSpan, metaSpan);
        card.append(iconWrap, textCol);
      } else {
        textCol.append(nameSpan);
        const shortcut = document.createElement("span");
        shortcut.className = "model-row-shortcut";
        shortcut.textContent = providerLabel;
        card.append(iconWrap, textCol, shortcut);
      }

      if (this.isEditMode && !this.isReordering) {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "model-row-del-btn";
        delBtn.title = `Delete ${item.name}`;
        delBtn.textContent = "\u00d7";
        delBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.removeModel(item.id);
        });
        card.appendChild(delBtn);
      }

      if (this.isReordering) {
        const dragHandle = document.createElement("span");
        dragHandle.className = "model-drag-handle";
        dragHandle.innerHTML = `&#8942;&#8942;`;
        dragHandle.title = "Drag to reorder";
        card.appendChild(dragHandle);
      }

      card.addEventListener("click", () => {
        if (card.classList.contains("dragging")) return;
        this.selectModel(item);
      });

      listEl.appendChild(card);
    }

    listEl.style.position = "relative";
    container.appendChild(listEl);
    this.listPill = attachToolbarHoverPill(listEl, {
      itemSelector: ".model-row",
      parkedSelector: ".model-row.active",
      pillClass: "model-row-indicator",
      box: true,
    });
    requestAnimationFrame(() => this.listPill?.sync(true));
  }
}
