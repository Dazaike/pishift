export type TabColorTag = {
  id: string;
  name: string;
  color: string;
};

export const TAB_COLOR_PRESETS: TabColorTag[] = [
  { id: "emerald", name: "Emerald", color: "#10b981" },
  { id: "sky", name: "Sky", color: "#0ea5e9" },
  { id: "violet", name: "Violet", color: "#8b5cf6" },
  { id: "amber", name: "Amber", color: "#f59e0b" },
  { id: "rose", name: "Rose", color: "#f43f5e" },
  { id: "slate", name: "Slate", color: "#64748b" },
];

export interface TabMenuTarget {
  cwd: string;
  colorTag?: string;
}

export interface TabMenuCallbacks {
  onOpenExplorer: (target: TabMenuTarget) => void;
  onCopyPath: (target: TabMenuTarget) => void;
  onDuplicate: (target: TabMenuTarget) => void;
  onRename: (target: TabMenuTarget) => void;
  onSetColor: (target: TabMenuTarget, colorId?: string) => void;
  onClose: (target: TabMenuTarget) => void;
  onCloseOthers: (target: TabMenuTarget) => void;
  onCloseRight: (target: TabMenuTarget) => void;
}

export class TabContextMenu {
  public el: HTMLDivElement;
  private currentTarget: TabMenuTarget | null = null;
  private currentCallbacks: TabMenuCallbacks | null = null;
  private isOpen = false;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "tab-context-menu";
    this.el.className = "context-menu";
    this.el.setAttribute("hidden", "true");

    document.addEventListener("click", (ev) => {
      if (!this.isOpen) return;
      if (!this.el.contains(ev.target as Node)) {
        this.close();
      }
    });

    document.addEventListener("contextmenu", (ev) => {
      if (!this.isOpen) return;
      if (!this.el.contains(ev.target as Node)) {
        this.close();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (this.isOpen && ev.key === "Escape") {
        this.close();
      }
    });

    document.body.appendChild(this.el);
  }

  public open(x: number, y: number, target: TabMenuTarget, callbacks: TabMenuCallbacks): void {
    this.currentTarget = target;
    this.currentCallbacks = callbacks;
    this.isOpen = true;

    this.render();
    this.el.removeAttribute("hidden");

    // Position within viewport boundaries
    const rect = this.el.getBoundingClientRect();
    const pad = 8;
    let posX = x;
    let posY = y;

    if (posX + rect.width > window.innerWidth - pad) {
      posX = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (posY + rect.height > window.innerHeight - pad) {
      posY = Math.max(pad, window.innerHeight - rect.height - pad);
    }

    this.el.style.left = `${posX}px`;
    this.el.style.top = `${posY}px`;
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.setAttribute("hidden", "true");
    this.currentTarget = null;
    this.currentCallbacks = null;
  }

  private render(): void {
    if (!this.currentTarget || !this.currentCallbacks) return;
    const target = this.currentTarget;
    const cb = this.currentCallbacks;

    this.el.innerHTML = `
      <div class="menu-item" data-action="explorer">
        <span class="menu-icon">&#128194;</span>
        <span>Open in File Explorer</span>
      </div>
      <div class="menu-item" data-action="copy-path">
        <span class="menu-icon">&#128203;</span>
        <span>Copy Directory Path</span>
      </div>
      <div class="menu-item" data-action="duplicate">
        <span class="menu-icon">&#10010;</span>
        <span>Duplicate Tab in Directory</span>
      </div>
      <div class="menu-item" data-action="rename">
        <span class="menu-icon">&#9998;</span>
        <span>Rename Tab</span>
      </div>
      <div class="menu-separator"></div>
      <div class="menu-section-label">Tab Color Tag</div>
      <div class="menu-color-row">
        <button type="button" class="color-dot-btn ${!target.colorTag ? "active" : ""}" data-color="" title="None">
          <span class="color-dot-none">&#10005;</span>
        </button>
        ${TAB_COLOR_PRESETS.map(
          (c) => `
          <button type="button" class="color-dot-btn ${target.colorTag === c.id ? "active" : ""}" data-color="${c.id}" title="${c.name}">
            <span class="color-dot" style="background-color: ${c.color};"></span>
          </button>
        `,
        ).join("")}
      </div>
      <div class="menu-separator"></div>
      <div class="menu-item" data-action="close">
        <span class="menu-icon">&#10005;</span>
        <span>Close Tab</span>
      </div>
      <div class="menu-item" data-action="close-others">
        <span>Close Other Tabs</span>
      </div>
      <div class="menu-item" data-action="close-right">
        <span>Close Tabs to the Right</span>
      </div>
    `;

    // Bind action clicks
    const items = this.el.querySelectorAll<HTMLDivElement>(".menu-item");
    for (const item of items) {
      item.addEventListener("click", () => {
        const action = item.getAttribute("data-action");
        this.close();
        if (action === "explorer") cb.onOpenExplorer(target);
        else if (action === "copy-path") cb.onCopyPath(target);
        else if (action === "duplicate") cb.onDuplicate(target);
        else if (action === "rename") cb.onRename(target);
        else if (action === "close") cb.onClose(target);
        else if (action === "close-others") cb.onCloseOthers(target);
        else if (action === "close-right") cb.onCloseRight(target);
      });
    }

    // Bind color dot clicks
    const colorBtns = this.el.querySelectorAll<HTMLButtonElement>(".color-dot-btn");
    for (const btn of colorBtns) {
      btn.addEventListener("click", () => {
        const colorId = btn.getAttribute("data-color") || undefined;
        this.close();
        cb.onSetColor(target, colorId);
      });
    }
  }
}
