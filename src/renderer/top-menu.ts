import settingsIcon from "./assets/icons/settings.png";

export interface TopMenuCallbacks {
  onOpenTodo: () => void;
  onOpenSettings: () => void;
  onToggleSplit?: () => void;
  onRelaunch: () => void;
  onQuit: () => void;
}

export class TopMenu {
  readonly el: HTMLDivElement;
  private selectedIndex = -1;

  constructor(
    private readonly anchor: HTMLElement,
    private readonly callbacks: TopMenuCallbacks,
  ) {
    this.el = document.createElement("div");
    this.el.id = "top-menu-popover";
    this.el.className = "top-menu-popover popover-sheet";
    this.el.setAttribute("hidden", "true");
    this.el.setAttribute("role", "menu");
    this.el.setAttribute("aria-label", "App Menu");
    document.body.appendChild(this.el);

    this.render();

    document.addEventListener("mousedown", (ev) => {
      if (this.el.hidden) return;
      const target = ev.target as Node;
      if (!this.el.contains(target) && target !== this.anchor && !this.anchor.contains(target)) {
        this.close();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (this.el.hidden) return;
      if (ev.key === "Escape") {
        this.close();
        ev.stopPropagation();
      } else if (ev.key === "ArrowDown") {
        this.moveSelection(1);
        ev.preventDefault();
      } else if (ev.key === "ArrowUp") {
        this.moveSelection(-1);
        ev.preventDefault();
      } else if (ev.key === "Enter") {
        const items = Array.from(this.el.querySelectorAll<HTMLButtonElement>(".top-menu-item"));
        if (this.selectedIndex >= 0 && this.selectedIndex < items.length) {
          items[this.selectedIndex].click();
          ev.preventDefault();
        }
      }
    });

    window.addEventListener("resize", () => {
      if (this.isOpen) this.position();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.selectedIndex = -1;
    this.render();
    this.el.removeAttribute("hidden");
    this.position();
  }

  close(): void {
    this.el.setAttribute("hidden", "true");
  }

  private position(): void {
    const anchorRect = this.anchor.getBoundingClientRect();
    const sheetW = this.el.offsetWidth || 200;
    const pad = 8;
    let left = anchorRect.left + anchorRect.width / 2 - sheetW / 2;
    if (left + sheetW > window.innerWidth - pad) {
      left = window.innerWidth - pad - sheetW;
    }
    if (left < pad) left = pad;

    this.el.style.top = `${Math.round(anchorRect.bottom + 6)}px`;
    this.el.style.left = `${Math.round(left)}px`;
  }

  private moveSelection(delta: number): void {
    const items = Array.from(this.el.querySelectorAll<HTMLButtonElement>(".top-menu-item"));
    if (items.length === 0) return;
    if (this.selectedIndex < 0) {
      this.selectedIndex = delta > 0 ? 0 : items.length - 1;
    } else {
      this.selectedIndex = (this.selectedIndex + delta + items.length) % items.length;
    }
    items.forEach((it, idx) => {
      it.classList.toggle("selected", idx === this.selectedIndex);
      if (idx === this.selectedIndex) it.focus();
    });
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="top-menu-header">
        <span class="top-menu-title">Menu</span>
        <button type="button" class="top-menu-close" title="Close">&times;</button>
      </div>
      <div class="top-menu-body">
        <button type="button" class="top-menu-item" data-action="todo">
          <span class="top-menu-icon-wrap"><span class="top-menu-glyph">&#9776;</span></span>
          <span class="top-menu-label">To-Do</span>
        </button>
        <button type="button" class="top-menu-item" data-action="settings">
          <span class="top-menu-icon-wrap">
            <img src="${settingsIcon}" alt="" class="top-menu-icon-img" />
          </span>
          <span class="top-menu-label">Settings</span>
        </button>
        <button type="button" class="top-menu-item" data-action="split">
          <span class="top-menu-icon-wrap">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="12" y1="3" x2="12" y2="21"></line>
            </svg>
          </span>
          <span class="top-menu-label">Split Screen (Ctrl+\\)</span>
        </button>
        <div class="top-menu-divider"></div>
        <button type="button" class="top-menu-item" data-action="relaunch">
          <span class="top-menu-icon-wrap"><span class="top-menu-glyph">&#x21BB;</span></span>
          <span class="top-menu-label">Relaunch</span>
        </button>
        <button type="button" class="top-menu-item top-menu-item-quit" data-action="quit">
          <span class="top-menu-icon-wrap"><span class="top-menu-glyph">&#x2715;</span></span>
          <span class="top-menu-label">Quit</span>
        </button>
      </div>
    `;

    this.el.querySelector(".top-menu-close")?.addEventListener("click", () => this.close());

    this.el.querySelector('[data-action="todo"]')?.addEventListener("click", () => {
      this.close();
      this.callbacks.onOpenTodo();
    });
    this.el.querySelector('[data-action="settings"]')?.addEventListener("click", () => {
      this.close();
      this.callbacks.onOpenSettings();
    });
    this.el.querySelector('[data-action="split"]')?.addEventListener("click", () => {
      this.close();
      this.callbacks.onToggleSplit?.();
    });
    this.el.querySelector('[data-action="relaunch"]')?.addEventListener("click", () => {
      this.close();
      this.callbacks.onRelaunch();
    });
    this.el.querySelector('[data-action="quit"]')?.addEventListener("click", () => {
      this.close();
      this.callbacks.onQuit();
    });
  }
}
