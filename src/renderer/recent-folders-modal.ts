import folderIcon from "./assets/icons/folder.png";

import type { PanelPosition } from "../shared/ipc";

export interface RecentFoldersCallbacks {
  onSelectFolder: (folder: string, newTab?: boolean) => void;
  onOpenNewFolder: () => Promise<void>;
  onShowInExplorer: (folder: string) => void;
}

export class RecentFoldersModal {
  readonly el: HTMLDivElement;
  private folders: string[] = [];
  private currentCwd = "";
  private searchQuery = "";
  private selectedIndex = -1;
  private loading = false;
  private panelPosition: PanelPosition = "top-right";

  constructor(
    private readonly anchor: HTMLElement,
    private readonly callbacks: RecentFoldersCallbacks,
  ) {
    this.el = document.createElement("div");
    this.el.id = "recent-folders-popover";
    this.el.className = "recent-folders-popover popover-sheet";
    this.el.setAttribute("hidden", "true");
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Recent Folders");
    document.body.appendChild(this.el);

    document.addEventListener("mousedown", (ev) => {
      if (this.el.hidden) return;
      const target = ev.target as Node;
      if (this.el.contains(target)) return;
      const topMenuBtn = document.getElementById("btn-top-menu");
      if (
        (this.anchor && this.anchor.contains(target)) ||
        (topMenuBtn && topMenuBtn.contains(target))
      ) {
        return;
      }
      this.close();
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
        const filtered = this.getFilteredFolders();
        if (this.selectedIndex >= 0 && this.selectedIndex < filtered.length) {
          const selected = filtered[this.selectedIndex];
          this.callbacks.onSelectFolder(selected, ev.ctrlKey || ev.metaKey);
          this.close();
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

  setCurrentCwd(cwd: string): void {
    this.currentCwd = cwd;
    if (this.isOpen) this.render();
  }
  setPanelPosition(pos: PanelPosition): void {
    this.panelPosition = pos;
    if (this.isOpen) this.position();
  }

  toggle(currentCwd?: string): void {
    if (this.isOpen) {
      this.close();
    } else {
      void this.open(currentCwd);
    }
  }

  async open(currentCwd?: string): Promise<void> {
    if (currentCwd) this.currentCwd = currentCwd;
    this.searchQuery = "";
    this.selectedIndex = -1;
    this.el.removeAttribute("hidden");
    this.render();
    this.position();
    await this.refresh();
    const searchInput = this.el.querySelector<HTMLInputElement>(".popover-search-input");
    searchInput?.focus();
  }

  close(): void {
    this.el.setAttribute("hidden", "true");
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.folders = await window.omphif.getRecentFolders();
    } catch {
      this.folders = [];
    } finally {
      this.loading = false;
      if (this.isOpen) this.render();
    }
  }

  private position(): void {
    const sheetW = this.el.offsetWidth || 380;
    const pad = 12;

    if (this.panelPosition === "center") {
      this.el.style.top = "50%";
      this.el.style.left = "50%";
      this.el.style.bottom = "";
      this.el.style.transform = "translate(-50%, -50%)";
      return;
    }
    if (this.panelPosition === "top-center") {
      this.el.style.top = "46px";
      this.el.style.left = "50%";
      this.el.style.bottom = "";
      this.el.style.transform = "translateX(-50%)";
      return;
    }
    if (this.panelPosition === "bottom-center") {
      this.el.style.top = "";
      this.el.style.bottom = "72px";
      this.el.style.left = "50%";
      this.el.style.transform = "translateX(-50%)";
      return;
    }

    // Default / "top-right":
    this.el.style.transform = "";
    this.el.style.bottom = "";

    let targetAnchor = this.anchor;
    if (!targetAnchor.offsetParent) {
      const topMenuBtn = document.getElementById("btn-top-menu");
      if (topMenuBtn && topMenuBtn.offsetParent) {
        targetAnchor = topMenuBtn;
      }
    }

    const anchorRect = targetAnchor.offsetParent ? targetAnchor.getBoundingClientRect() : null;
    if (anchorRect && anchorRect.width > 0) {
      let left = anchorRect.left + anchorRect.width / 2 - sheetW / 2;
      if (left + sheetW > window.innerWidth - pad) {
        left = window.innerWidth - pad - sheetW;
      }
      if (left < pad) left = pad;

      this.el.style.top = `${Math.round(anchorRect.bottom + 6)}px`;
      this.el.style.left = `${Math.round(left)}px`;
    } else {
      this.el.style.top = "44px";
      this.el.style.left = `${Math.max(pad, window.innerWidth - sheetW - pad)}px`;
    }
  }

  private getFilteredFolders(): string[] {
    if (!this.searchQuery.trim()) return this.folders;
    const q = this.searchQuery.toLowerCase();
    return this.folders.filter((f) => {
      const name = f.split(/[\\/]/).filter(Boolean).pop() || f;
      return name.toLowerCase().includes(q) || f.toLowerCase().includes(q);
    });
  }

  private moveSelection(delta: number): void {
    const filtered = this.getFilteredFolders();
    if (filtered.length === 0) return;
    if (this.selectedIndex < 0) {
      this.selectedIndex = delta > 0 ? 0 : filtered.length - 1;
    } else {
      this.selectedIndex = (this.selectedIndex + delta + filtered.length) % filtered.length;
    }
    this.renderList();
    const activeEl = this.el.querySelector<HTMLElement>(".popover-item.selected");
    activeEl?.scrollIntoView({ block: "nearest" });
  }

  private async removeFolder(folder: string): Promise<void> {
    try {
      this.folders = await window.omphif.removeRecentFolder(folder);
      this.render();
    } catch {
      // Ignore
    }
  }

  private clearAll(): void {
    window.omphif.clearRecentFolders();
    this.folders = [];
    this.render();
  }

  private render(): void {
    this.el.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.className = "popover-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "popover-title-group";

    const icon = document.createElement("img");
    icon.src = folderIcon;
    icon.className = "popover-header-icon";
    icon.alt = "";

    const title = document.createElement("h2");
    title.className = "popover-title";
    title.textContent = "Recent Folders";

    const countBadge = document.createElement("span");
    countBadge.className = "popover-count-badge";
    countBadge.textContent = String(this.folders.length);

    titleGroup.appendChild(icon);
    titleGroup.appendChild(title);
    titleGroup.appendChild(countBadge);

    const actions = document.createElement("div");
    actions.className = "popover-actions";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "popover-btn-pill accent";
    openBtn.innerHTML = "<span>+ Open Folder</span>";
    openBtn.title = "Open a new folder in file picker";
    openBtn.addEventListener("click", async () => {
      this.close();
      await this.callbacks.onOpenNewFolder();
    });

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "popover-btn-pill";
    clearBtn.textContent = "Clear";
    clearBtn.title = "Clear recent folders history";
    clearBtn.addEventListener("click", () => this.clearAll());

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "popover-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", () => this.close());

    actions.appendChild(openBtn);
    if (this.folders.length > 0) actions.appendChild(clearBtn);
    actions.appendChild(closeBtn);

    header.appendChild(titleGroup);
    header.appendChild(actions);
    this.el.appendChild(header);

    // Search bar
    const searchWrap = document.createElement("div");
    searchWrap.className = "popover-search-wrap";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "popover-search-input";
    searchInput.placeholder = "Search recent folders...";
    searchInput.value = this.searchQuery;
    searchInput.spellcheck = false;

    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.selectedIndex = -1;
      this.renderList();
    });

    searchWrap.appendChild(searchInput);

    if (this.searchQuery) {
      const clearSearch = document.createElement("button");
      clearSearch.type = "button";
      clearSearch.className = "popover-search-clear";
      clearSearch.innerHTML = "&times;";
      clearSearch.addEventListener("click", () => {
        this.searchQuery = "";
        searchInput.value = "";
        this.renderList();
        searchInput.focus();
      });
      searchWrap.appendChild(clearSearch);
    }

    this.el.appendChild(searchWrap);

    // List container
    const listContainer = document.createElement("div");
    listContainer.className = "popover-list-container";
    this.el.appendChild(listContainer);

    this.renderList();
    requestAnimationFrame(() => this.position());
  }

  private renderList(): void {
    const listContainer = this.el.querySelector<HTMLDivElement>(".popover-list-container");
    if (!listContainer) return;
    listContainer.innerHTML = "";

    if (this.loading) {
      const loading = document.createElement("div");
      loading.className = "popover-loading";
      loading.innerHTML = `<span class="loading-spinner"></span><span>Loading folders...</span>`;
      listContainer.appendChild(loading);
      return;
    }
    const filtered = this.getFilteredFolders();
    const currentNorm = this.currentCwd.replace(/[\\/]+$/, "").toLowerCase();

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "popover-empty";
      if (this.searchQuery) {
        empty.innerHTML = `<span class="empty-icon">&#128269;</span><span>No folders matching "<strong>${escapeHtml(this.searchQuery)}</strong>"</span>`;
      } else {
        empty.innerHTML = `
          <span class="empty-icon">&#128193;</span>
          <span class="empty-text">No recent folders yet</span>
          <button type="button" class="popover-empty-action">+ Browse Folder...</button>
        `;
        empty.querySelector(".popover-empty-action")?.addEventListener("click", async () => {
          this.close();
          await this.callbacks.onOpenNewFolder();
        });
      }
      listContainer.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "popover-items-list";

    filtered.forEach((folder, idx) => {
      const isCurrent = folder.replace(/[\\/]+$/, "").toLowerCase() === currentNorm;
      const isSelected = idx === this.selectedIndex;
      const folderName = folder.split(/[\\/]/).filter(Boolean).pop() || folder;

      const item = document.createElement("div");
      item.className = `popover-item ${isCurrent ? "active-folder" : ""} ${isSelected ? "selected" : ""}`;
      item.setAttribute("role", "button");
      item.tabIndex = 0;

      // Icon badge
      const iconWrap = document.createElement("div");
      iconWrap.className = "popover-item-icon-wrap folder-icon-wrap";
      const icon = document.createElement("img");
      icon.src = folderIcon;
      icon.className = "popover-item-icon";
      icon.alt = "";
      iconWrap.appendChild(icon);

      // Meta info
      const meta = document.createElement("div");
      meta.className = "popover-item-meta";

      const titleRow = document.createElement("div");
      titleRow.className = "popover-item-title-row";

      const nameEl = document.createElement("span");
      nameEl.className = "popover-item-title";
      nameEl.textContent = folderName;
      titleRow.appendChild(nameEl);

      if (isCurrent) {
        const currentBadge = document.createElement("span");
        currentBadge.className = "popover-current-badge";
        currentBadge.textContent = "Current";
        titleRow.appendChild(currentBadge);
      }

      const pathEl = document.createElement("span");
      pathEl.className = "popover-item-subtitle";
      pathEl.textContent = folder;
      pathEl.title = folder;

      meta.appendChild(titleRow);
      meta.appendChild(pathEl);

      // Hover actions
      const actions = document.createElement("div");
      actions.className = "popover-item-actions";

      const newTabBtn = document.createElement("button");
      newTabBtn.type = "button";
      newTabBtn.className = "popover-item-action-btn";
      newTabBtn.title = "Open in New Tab";
      newTabBtn.innerHTML = "&#43;";
      newTabBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onSelectFolder(folder, true);
        this.close();
      });

      const revealBtn = document.createElement("button");
      revealBtn.type = "button";
      revealBtn.className = "popover-item-action-btn";
      revealBtn.title = "Show in File Explorer";
      revealBtn.innerHTML = "&#128065;";
      revealBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onShowInExplorer(folder);
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "popover-item-action-btn remove-btn";
      removeBtn.title = "Remove from Recent Folders";
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.removeFolder(folder);
      });

      actions.appendChild(newTabBtn);
      actions.appendChild(revealBtn);
      actions.appendChild(removeBtn);

      item.appendChild(iconWrap);
      item.appendChild(meta);
      item.appendChild(actions);

      item.addEventListener("click", () => {
        this.callbacks.onSelectFolder(folder, false);
        this.close();
      });

      list.appendChild(item);
    });

    listContainer.appendChild(list);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
