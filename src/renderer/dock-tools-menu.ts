export interface DockToolsCallbacks {
  onCopy: () => void;
  onPaste: () => void;
  onClear: () => void;
  onFind: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onToggleExpand: () => void;
  onRestartSession: () => void;
}

export class DockToolsMenu {
  public el: HTMLDivElement;
  private callbacks: DockToolsCallbacks;
  private isOpen = false;

  constructor(callbacks: DockToolsCallbacks) {
    this.callbacks = callbacks;
    this.el = document.createElement("div");
    this.el.id = "dock-tools-popover";
    this.el.className = "dock-tools-popover";
    this.el.setAttribute("hidden", "true");

    this.render();

    document.addEventListener("click", (ev) => {
      if (!this.isOpen) return;
      const target = ev.target as Node;
      if (!this.el.contains(target) && !((target as HTMLElement).closest?.("#dock-tools-btn"))) {
        this.close();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (this.isOpen && ev.key === "Escape") {
        this.close();
      }
    });
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  public open(): void {
    this.isOpen = true;
    this.el.removeAttribute("hidden");
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.setAttribute("hidden", "true");
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="dock-tools-header">
        <span class="dock-tools-title">Terminal & Tools</span>
        <button type="button" class="dock-tools-close" title="Close">&times;</button>
      </div>
      <div class="dock-tools-list">
        <div class="dock-tool-item" data-action="copy">
          <span class="dock-tool-icon">&#128203;</span>
          <span class="dock-tool-label">Copy Selection</span>
          <span class="dock-tool-shortcut">Ctrl+C</span>
        </div>
        <div class="dock-tool-item" data-action="paste">
          <span class="dock-tool-icon">&#128203;</span>
          <span class="dock-tool-label">Paste Clipboard</span>
          <span class="dock-tool-shortcut">Ctrl+V</span>
        </div>
        <div class="dock-tool-item" data-action="clear">
          <span class="dock-tool-icon">&#129529;</span>
          <span class="dock-tool-label">Clear Terminal</span>
          <span class="dock-tool-shortcut">Ctrl+L</span>
        </div>
        <div class="dock-tool-item" data-action="find">
          <span class="dock-tool-icon">&#128269;</span>
          <span class="dock-tool-label">Find in Output</span>
          <span class="dock-tool-shortcut">Ctrl+F</span>
        </div>
        <div class="dock-tool-divider"></div>
        <div class="dock-tool-item" data-action="zoomin">
          <span class="dock-tool-icon">&#10133;</span>
          <span class="dock-tool-label">Zoom In</span>
          <span class="dock-tool-shortcut">Ctrl+=</span>
        </div>
        <div class="dock-tool-item" data-action="zoomout">
          <span class="dock-tool-icon">&#10134;</span>
          <span class="dock-tool-label">Zoom Out</span>
          <span class="dock-tool-shortcut">Ctrl+-</span>
        </div>
        <div class="dock-tool-item" data-action="zoomreset">
          <span class="dock-tool-icon">&#8635;</span>
          <span class="dock-tool-label">Reset Zoom</span>
          <span class="dock-tool-shortcut">Ctrl+0</span>
        </div>
        <div class="dock-tool-divider"></div>
        <div class="dock-tool-item" data-action="expand">
          <span class="dock-tool-icon">&#x2922;</span>
          <span class="dock-tool-label">Expand Composer</span>
          <span class="dock-tool-shortcut">Ctrl+Shift+E</span>
        </div>
        <div class="dock-tool-item" data-action="restart">
          <span class="dock-tool-icon">&#10227;</span>
          <span class="dock-tool-label">Restart Session</span>
          <span class="dock-tool-shortcut">Ctrl+Shift+R</span>
        </div>
      </div>
    `;

    const closeBtn = this.el.querySelector(".dock-tools-close") as HTMLButtonElement;
    closeBtn.addEventListener("click", () => this.close());

    const items = this.el.querySelectorAll<HTMLDivElement>(".dock-tool-item");
    for (const item of items) {
      item.addEventListener("click", () => {
        const action = item.getAttribute("data-action");
        this.close();
        if (action === "copy") this.callbacks.onCopy();
        else if (action === "paste") this.callbacks.onPaste();
        else if (action === "clear") this.callbacks.onClear();
        else if (action === "find") this.callbacks.onFind();
        else if (action === "zoomin") this.callbacks.onZoomIn();
        else if (action === "zoomout") this.callbacks.onZoomOut();
        else if (action === "zoomreset") this.callbacks.onZoomReset();
        else if (action === "expand") this.callbacks.onToggleExpand();
        else if (action === "restart") this.callbacks.onRestartSession();
      });
    }
  }
}
