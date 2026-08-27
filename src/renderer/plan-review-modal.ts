export type PlanReviewAction =
  | "execute"
  | "compact"
  | "keep"
  | "refine"
  | "save"
  | "quit";

export interface PlanReviewOptions {
  contextStats?: string;
}

/**
 * A custom overlay attached above the dock that covers OMP's terminal
 * "Plan mode - next step" menu and provides one-click action buttons.
 */
export class PlanReviewModal {
  readonly el: HTMLDivElement;
  private onActionCallback: ((action: PlanReviewAction) => void) | null = null;
  private statsSpan: HTMLSpanElement | null = null;
  private isLoading = false;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "plan-review-sheet";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Plan Review");

    document.addEventListener("keydown", (ev) => {
      if (!this.isOpen) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        this.triggerAction("quit");
      } else if (ev.key === "Enter" && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        ev.stopPropagation();
        this.triggerAction("execute");
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(
    opts: PlanReviewOptions,
    onAction: (action: PlanReviewAction) => void,
  ): void {
    this.isLoading = false;
    this.onActionCallback = onAction;
    this.render(opts);
    this.el.hidden = false;
  }

  updateStats(stats: string): void {
    if (this.statsSpan && stats) {
      this.statsSpan.textContent = stats;
    }
  }

  close(): void {
    this.el.hidden = true;
    this.onActionCallback = null;
    this.statsSpan = null;
    this.isLoading = false;
  }

  /** Swap the picker UI for an inline loading state; keeps the sheet visible (no reopen flash). */
  showCompacting(): void {
    this.el.hidden = false;
    if (this.isLoading) return;
    this.isLoading = true;
    this.el.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "job-modal-loading";
    loading.innerHTML = `<span class="job-spinner"></span> Compacting context…`;
    this.el.appendChild(loading);
  }

  private triggerAction(action: PlanReviewAction): void {
    const cb = this.onActionCallback;
    if (action === "compact") {
      this.showCompacting();
    } else {
      this.close();
    }
    cb?.(action);
  }

  private render(opts: PlanReviewOptions): void {
    this.el.replaceChildren();

    // Header
    const header = document.createElement("div");
    header.className = "plan-review-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "plan-review-title-wrap";

    const badge = document.createElement("span");
    badge.className = "plan-review-badge";
    badge.textContent = "Plan Review";

    const title = document.createElement("h3");
    title.className = "plan-review-title";
    title.textContent = "Plan Ready — Choose Next Step";

    titleWrap.append(badge, title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "plan-review-close-btn";
    closeBtn.setAttribute("aria-label", "Cancel");
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Cancel / Dismiss (Esc)";
    closeBtn.addEventListener("click", () => this.triggerAction("quit"));

    header.append(titleWrap, closeBtn);

    // Primary card: Approve and execute
    const primaryCard = document.createElement("button");
    primaryCard.type = "button";
    primaryCard.className = "plan-review-card plan-review-primary";
    primaryCard.addEventListener("click", () => this.triggerAction("execute"));

    const primaryIcon = document.createElement("div");
    primaryIcon.className = "plan-review-card-icon";
    primaryIcon.innerHTML = "&#x25B6;";

    const primaryText = document.createElement("div");
    primaryText.className = "plan-review-card-text";

    const primaryLabel = document.createElement("span");
    primaryLabel.className = "plan-review-card-label";
    primaryLabel.textContent = "Approve and Execute";

    const primarySub = document.createElement("span");
    primarySub.className = "plan-review-card-sub";
    primarySub.textContent = "Start execution of the approved plan immediately";

    primaryText.append(primaryLabel, primarySub);

    const primaryKey = document.createElement("span");
    primaryKey.className = "plan-review-card-key";
    primaryKey.innerHTML = "&#x21B5;";

    primaryCard.append(primaryIcon, primaryText, primaryKey);

    // 2-column Grid for Compact vs Keep Context
    const grid = document.createElement("div");
    grid.className = "plan-review-grid";

    // Compact Context Card
    const compactCard = document.createElement("button");
    compactCard.type = "button";
    compactCard.className = "plan-review-card";
    compactCard.addEventListener("click", () => this.triggerAction("compact"));

    const compactIcon = document.createElement("div");
    compactIcon.className = "plan-review-card-icon";
    compactIcon.innerHTML = "&#x2194;";

    const compactText = document.createElement("div");
    compactText.className = "plan-review-card-text";

    const compactLabel = document.createElement("span");
    compactLabel.className = "plan-review-card-label";
    compactLabel.textContent = "Approve in Compact Context";

    const compactSub = document.createElement("span");
    compactSub.className = "plan-review-card-sub";
    compactSub.textContent = "Summarize conversation before execution";

    compactText.append(compactLabel, compactSub);
    compactCard.append(compactIcon, compactText);

    // Keep Context Card
    const keepCard = document.createElement("button");
    keepCard.type = "button";
    keepCard.className = "plan-review-card";
    keepCard.addEventListener("click", () => this.triggerAction("keep"));

    const keepIcon = document.createElement("div");
    keepIcon.className = "plan-review-card-icon";
    keepIcon.innerHTML = "&#x1F4BE;";

    const keepText = document.createElement("div");
    keepText.className = "plan-review-card-text";

    const keepLabel = document.createElement("span");
    keepLabel.className = "plan-review-card-label";
    keepLabel.textContent = "Approve and Keep Context";

    const keepSub = document.createElement("span");
    keepSub.className = "plan-review-card-sub plan-review-stats";
    keepSub.textContent = opts.contextStats || "Keep full session context";
    this.statsSpan = keepSub;

    keepText.append(keepLabel, keepSub);
    keepCard.append(keepIcon, keepText);

    grid.append(compactCard, keepCard);

    // Footer actions: Refine plan, Save & quit, Cancel
    const footer = document.createElement("div");
    footer.className = "plan-review-footer-row";

    const refineBtn = document.createElement("button");
    refineBtn.type = "button";
    refineBtn.className = "plan-review-btn plan-review-btn-refine";
    refineBtn.innerHTML = "<span>&#x270E; Refine Plan</span>";
    refineBtn.title = "Provide feedback or changes to the plan";
    refineBtn.addEventListener("click", () => this.triggerAction("refine"));

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "plan-review-btn plan-review-btn-save";
    saveBtn.innerHTML = "<span>&#x1F4BE; Save and Quit</span>";
    saveBtn.title = "Save the plan to disk and exit plan mode";
    saveBtn.addEventListener("click", () => this.triggerAction("save"));

    const quitBtn = document.createElement("button");
    quitBtn.type = "button";
    quitBtn.className = "plan-review-btn plan-review-btn-quit";
    quitBtn.innerHTML = "<span>&times; Quit</span>";
    quitBtn.title = "Cancel plan review (Esc)";
    quitBtn.addEventListener("click", () => this.triggerAction("quit"));

    footer.append(refineBtn, saveBtn, quitBtn);

    this.el.append(header, primaryCard, grid, footer);
  }
}
