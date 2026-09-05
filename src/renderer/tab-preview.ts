import { popoverMotion } from "./motion-utils";

export interface TabPreviewInfo {
  sessionNumber: number;
  title: string;
  cwd: string;
  modelName: string;
  activity: string;
  viewMode: "terminal" | "chat";
  lines: string[];
}

export class TabPreviewPopover {
  readonly el: HTMLDivElement;
  private readonly headerEl: HTMLDivElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly cwdEl: HTMLSpanElement;
  private readonly metaEl: HTMLDivElement;
  private readonly modelEl: HTMLSpanElement;
  private readonly modeBadgeEl: HTMLSpanElement;
  private readonly activityBadgeEl: HTMLSpanElement;
  private readonly previewBodyEl: HTMLDivElement;
  private readonly previewTextEl: HTMLPreElement;

  private currentKey: number | null = null;
  private hoverTimer: number | null = null;
  private hideTimer: number | null = null;
  private isShown = false;
  private enabled = true;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly getTabInfo: (key: number) => TabPreviewInfo | null,
  ) {
    this.el = document.createElement("div");
    this.el.className = "tab-preview-popover popover-sheet";
    this.el.setAttribute("hidden", "true");
    this.el.setAttribute("role", "tooltip");
    this.el.setAttribute("aria-live", "polite");

    this.headerEl = document.createElement("div");
    this.headerEl.className = "tab-preview-header";

    const titleRow = document.createElement("div");
    titleRow.className = "tab-preview-title-row";

    this.titleEl = document.createElement("span");
    this.titleEl.className = "tab-preview-title";

    this.metaEl = document.createElement("div");
    this.metaEl.className = "tab-preview-meta";

    this.modeBadgeEl = document.createElement("span");
    this.modeBadgeEl.className = "tab-preview-badge tab-preview-mode";

    this.activityBadgeEl = document.createElement("span");
    this.activityBadgeEl.className = "tab-preview-badge tab-preview-activity";

    this.metaEl.append(this.modeBadgeEl, this.activityBadgeEl);
    titleRow.append(this.titleEl, this.metaEl);

    const subRow = document.createElement("div");
    subRow.className = "tab-preview-sub-row";

    this.cwdEl = document.createElement("span");
    this.cwdEl.className = "tab-preview-cwd";

    this.modelEl = document.createElement("span");
    this.modelEl.className = "tab-preview-model";

    subRow.append(this.cwdEl, this.modelEl);
    this.headerEl.append(titleRow, subRow);

    this.previewBodyEl = document.createElement("div");
    this.previewBodyEl.className = "tab-preview-body";

    this.previewTextEl = document.createElement("pre");
    this.previewTextEl.className = "tab-preview-content";
    this.previewBodyEl.appendChild(this.previewTextEl);

    this.el.append(this.headerEl, this.previewBodyEl);
    document.body.appendChild(this.el);

    this.initEvents();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }
  get currentTabKey(): number | null {
    return this.currentKey;
  }


  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hideImmediate();
    }
  }

  private initEvents(): void {
    this.scroller.addEventListener("pointerover", (ev) => {
      if (!this.enabled) return;
      const tabEl = (ev.target as HTMLElement)?.closest(".tab") as HTMLElement | null;
      if (!tabEl) {
        this.scheduleHide();
        return;
      }
      // If hovering the active tab, we can either hide or still preview; usually previewing inactive tabs is most useful
      // but showing preview on hover provides consistent peek.
      this.cancelHide();
      this.scheduleShow(tabEl);
    });

    this.scroller.addEventListener("pointerout", (ev) => {
      const related = ev.relatedTarget as Node | null;
      if (!related || !this.scroller.contains(related)) {
        this.cancelShow();
        this.scheduleHide();
      }
    });

    // Don't close preview if mouse moves onto the preview popover itself
    this.el.addEventListener("pointerenter", () => {
      this.cancelHide();
    });

    this.el.addEventListener("pointerleave", (ev) => {
      const related = ev.relatedTarget as Node | null;
      if (!related || !this.scroller.contains(related)) {
        this.scheduleHide();
      }
    });

    window.addEventListener("resize", () => {
      if (this.isShown) this.hideImmediate();
    });

    document.addEventListener("mousedown", (ev) => {
      if (!this.el.hidden && !this.el.contains(ev.target as Node)) {
        this.hideImmediate();
      }
    });
  }

  private cancelShow(): void {
    if (this.hoverTimer !== null) {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private scheduleShow(tabEl: HTMLElement): void {
    this.cancelShow();
    this.hoverTimer = window.setTimeout(() => {
      this.showForTab(tabEl);
    }, 280);
  }

  private scheduleHide(): void {
    this.cancelHide();
    this.hideTimer = window.setTimeout(() => {
      this.hide();
    }, 120);
  }

  showForTab(tabEl: HTMLElement): void {
    const keyAttr = tabEl.dataset.tabKey;
    const key = keyAttr ? Number(keyAttr) : null;
    if (key === null || Number.isNaN(key)) return;

    const info = this.getTabInfo(key);
    if (!info) return;

    this.currentKey = key;
    this.renderInfo(info);
    this.position(tabEl);

    if (this.el.hidden) {
      popoverMotion.animatePopoverOpen(this.el, { duration: 0.12 });
      this.isShown = true;
    }
  }

  private renderInfo(info: TabPreviewInfo): void {
    this.titleEl.textContent = info.title;
    this.cwdEl.textContent = info.cwd;
    this.modelEl.textContent = info.modelName ? `Model: ${info.modelName}` : "";

    this.modeBadgeEl.textContent = info.viewMode === "chat" ? "Chat" : "Terminal";
    this.modeBadgeEl.dataset.mode = info.viewMode;

    if (info.activity && info.activity !== "idle") {
      this.activityBadgeEl.textContent = info.activity;
      this.activityBadgeEl.dataset.activity = info.activity;
      this.activityBadgeEl.hidden = false;
    } else {
      this.activityBadgeEl.hidden = true;
    }

    if (info.lines.length === 0) {
      this.previewTextEl.textContent = "(no output in session)";
      this.previewTextEl.classList.add("empty");
    } else {
      this.previewTextEl.textContent = info.lines.join("\n");
      this.previewTextEl.classList.remove("empty");
    }
  }

  private position(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const width = 360;
    const pad = 8;
    const height = this.el.offsetHeight || 240;
    const isHorizontal = document.body.dataset.tabLayout === "horizontal";

    let left: number;
    let top: number;

    if (isHorizontal) {
      top = rect.bottom + 6;
      if (top + height > window.innerHeight - pad) {
        top = Math.max(pad, rect.top - 6 - height);
      }
      left = Math.min(Math.max(pad, rect.left), window.innerWidth - pad - width);
    } else {
      // The rail is vertical and clips its rows, so flank the panel's visible
      // right edge instead of the row's (clipped) box, and fall back to its left
      // side when the viewport has no room.
      const railRight = this.scroller.getBoundingClientRect().right;
      left = railRight + 8;
      if (left + width > window.innerWidth - pad) {
        left = Math.max(pad, railRight - 8 - width);
      }

      top = rect.top;
      if (top + height > window.innerHeight - pad) {
        top = window.innerHeight - pad - height;
      }
      if (top < pad) {
        top = pad;
      }
    }

    this.el.style.top = `${Math.round(top)}px`;
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.width = `${width}px`;
  }

  hide(): void {
    if (this.el.hidden) return;
    this.isShown = false;
    popoverMotion.animatePopoverClose(this.el, () => {
      this.el.hidden = true;
      this.currentKey = null;
    });
  }

  hideImmediate(): void {
    this.cancelShow();
    this.cancelHide();
    this.el.hidden = true;
    this.isShown = false;
    this.currentKey = null;
  }
}
