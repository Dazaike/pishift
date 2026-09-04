import type { PanelPosition, RecentChatInfo } from "../shared/ipc";
import { attachButtonSpring, attachToolbarHoverPill, popoverMotion } from "./motion-utils";

export interface RecentChatsCallbacks {
  onResumeChat: (sessionId: string) => void;
  onTriggerResumePicker: () => void;
  onNewChat: () => void;
}

export class RecentChatsModal {
  readonly el: HTMLDivElement;
  private chats: RecentChatInfo[] = [];
  private currentCwd = "";
  private activeSessionId: string | null = null;
  private searchQuery = "";
  private selectedIndex = -1;
  private listPill: { dispose: () => void; sync: (immediate?: boolean) => void } | null = null;
  private isClosing = false;
  private loading = false;
  private panelPosition: PanelPosition = "top-right";

  constructor(
    private readonly anchor: HTMLElement,
    private readonly callbacks: RecentChatsCallbacks,
  ) {
    this.el = document.createElement("div");
    this.el.id = "recent-chats-popover";
    this.el.className = "recent-chats-popover popover-sheet";
    this.el.setAttribute("hidden", "true");
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Recent Chats");
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
        const filtered = this.getFilteredChats();
        if (this.selectedIndex >= 0 && this.selectedIndex < filtered.length) {
          const selected = filtered[this.selectedIndex];
          this.callbacks.onResumeChat(selected.id);
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
    const changed = this.currentCwd !== cwd;
    this.currentCwd = cwd;
    if (this.isOpen && changed) {
      void this.refresh();
    }
  }

  setActiveSessionId(sessionId: string | null): void {
    this.activeSessionId = sessionId;
    if (this.isOpen) this.render();
  }
  setPanelPosition(pos: PanelPosition): void {
    this.panelPosition = pos;
    if (this.isOpen) this.position();
  }

  toggle(currentCwd: string, activeSessionId?: string | null): void {
    if (this.isClosing) return;
    if (this.isOpen) {
      this.close();
    } else {
      void this.open(currentCwd, activeSessionId);
    }
  }

  async open(currentCwd: string, activeSessionId?: string | null): Promise<void> {
    this.currentCwd = currentCwd;
    if (activeSessionId !== undefined) this.activeSessionId = activeSessionId;
    this.searchQuery = "";
    this.selectedIndex = -1;
    this.anchor.classList.add("open");
    this.anchor.setAttribute("aria-expanded", "true");
    this.render();
    this.position();
    popoverMotion.animatePopoverOpen(this.el);
    await this.refresh();
    const searchInput = this.el.querySelector<HTMLInputElement>(".popover-search-input");
    searchInput?.focus();
  }

  close(): void {
    if (this.isClosing || this.el.hidden) return;
    this.isClosing = true;
    this.listPill?.dispose();
    this.listPill = null;
    popoverMotion.animatePopoverClose(this.el, () => {
      this.isClosing = false;
      this.el.setAttribute("hidden", "true");
      this.anchor.classList.remove("open");
      this.anchor.setAttribute("aria-expanded", "false");
    });
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.chats = await window.pishift.getRecentChats(this.currentCwd);
    } catch {
      this.chats = [];
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

  private getFilteredChats(): RecentChatInfo[] {
    if (!this.searchQuery.trim()) return this.chats;
    const q = this.searchQuery.toLowerCase();
    return this.chats.filter((c) => {
      return (
        c.title.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.cwd.toLowerCase().includes(q)
      );
    });
  }

  private moveSelection(delta: number): void {
    const filtered = this.getFilteredChats();
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

  private render(): void {
    this.el.innerHTML = "";

    const folderName = this.currentCwd.split(/[\\/]/).filter(Boolean).pop() || "Project";

    // Header
    const header = document.createElement("div");
    header.className = "popover-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "popover-title-group";

    const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    iconSvg.setAttribute("class", "popover-header-icon-svg");
    iconSvg.setAttribute("viewBox", "0 0 24 24");
    iconSvg.setAttribute("width", "16");
    iconSvg.setAttribute("height", "16");
    iconSvg.setAttribute("fill", "none");
    iconSvg.setAttribute("stroke", "currentColor");
    iconSvg.setAttribute("stroke-width", "2");
    iconSvg.setAttribute("stroke-linecap", "round");
    iconSvg.setAttribute("stroke-linejoin", "round");
    iconSvg.innerHTML = `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>`;

    const title = document.createElement("h2");
    title.className = "popover-title";
    title.textContent = "Recent Chats";

    const folderBadge = document.createElement("span");
    folderBadge.className = "popover-folder-badge";
    folderBadge.textContent = folderName;
    folderBadge.title = this.currentCwd;

    titleGroup.appendChild(iconSvg);
    titleGroup.appendChild(title);
    titleGroup.appendChild(folderBadge);

    const actions = document.createElement("div");
    actions.className = "popover-actions";

    const resumeBtn = document.createElement("button");
    resumeBtn.type = "button";
    resumeBtn.className = "popover-btn-pill accent";
    resumeBtn.innerHTML = "<span>/resume</span>";
    resumeBtn.title = "Resume session selector in terminal (/resume)";
    resumeBtn.addEventListener("click", () => {
      this.close();
      this.callbacks.onTriggerResumePicker();
    });

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "popover-btn-pill";
    refreshBtn.innerHTML = "&#x21BB;";
    refreshBtn.title = "Refresh chat list";
    refreshBtn.addEventListener("click", () => void this.refresh());

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "popover-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", () => this.close());

    actions.appendChild(resumeBtn);
    actions.appendChild(refreshBtn);
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
    searchInput.placeholder = `Search chats in ${folderName}...`;
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

    // Quick Action Bar
    const quickBar = document.createElement("div");
    quickBar.className = "popover-quick-bar";

    const newChatBtn = document.createElement("button");
    newChatBtn.type = "button";
    newChatBtn.className = "popover-quick-btn";
    newChatBtn.innerHTML = `<span class="quick-btn-icon">&#43;</span><span>New Chat (/new)</span>`;
    newChatBtn.title = "Start a fresh chat session";
    newChatBtn.addEventListener("click", () => {
      this.close();
      this.callbacks.onNewChat();
    });

    const resumePickerBtn = document.createElement("button");
    resumePickerBtn.type = "button";
    resumePickerBtn.className = "popover-quick-btn";
    resumePickerBtn.innerHTML = `<span class="quick-btn-icon">&#128269;</span><span>Browse All Sessions</span>`;
    resumePickerBtn.title = "Open OMP's full resume picker";
    resumePickerBtn.addEventListener("click", () => {
      this.close();
      this.callbacks.onTriggerResumePicker();
    });

    quickBar.appendChild(newChatBtn);
    quickBar.appendChild(resumePickerBtn);
    this.el.appendChild(quickBar);

    // List container
    const listContainer = document.createElement("div");
    listContainer.className = "popover-list-container";
    this.el.appendChild(listContainer);

    this.renderList();
    for (const btn of this.el.querySelectorAll("button")) {
      attachButtonSpring(btn);
    }
    requestAnimationFrame(() => this.position());
  }

  private renderList(): void {
    const listContainer = this.el.querySelector<HTMLDivElement>(".popover-list-container");
    if (!listContainer) return;
    listContainer.innerHTML = "";

    if (this.loading) {
      const loading = document.createElement("div");
      loading.className = "popover-loading";
      loading.innerHTML = `<span class="loading-spinner"></span><span>Loading chats...</span>`;
      listContainer.appendChild(loading);
      return;
    }

    const filtered = this.getFilteredChats();

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "popover-empty";
      if (this.searchQuery) {
        empty.innerHTML = `<span class="empty-icon">&#128269;</span><span>No chats matching "<strong>${escapeHtml(this.searchQuery)}</strong>"</span>`;
      } else {
        empty.innerHTML = `
          <span class="empty-icon">&#128172;</span>
          <span class="empty-text">No previous chats in this folder</span>
          <button type="button" class="popover-empty-action">Run /resume in Terminal</button>
        `;
        empty.querySelector(".popover-empty-action")?.addEventListener("click", () => {
          this.close();
          this.callbacks.onTriggerResumePicker();
        });
      }
      listContainer.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "popover-items-list";

    filtered.forEach((chat, idx) => {
      const isActive = this.activeSessionId === chat.id;
      const isSelected = idx === this.selectedIndex;
      const relTime = formatRelativeTime(chat.updatedAt || chat.mtime);
      const shortId = chat.id.slice(0, 8);

      const item = document.createElement("div");
      item.className = `popover-item chat-item ${isActive ? "active-chat" : ""} ${isSelected ? "selected" : ""}`;
      item.setAttribute("role", "button");
      item.tabIndex = 0;

      // Icon badge
      const iconWrap = document.createElement("div");
      iconWrap.className = "popover-item-icon-wrap chat-icon-wrap";
      iconWrap.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      `;

      // Meta info
      const meta = document.createElement("div");
      meta.className = "popover-item-meta";

      const titleRow = document.createElement("div");
      titleRow.className = "popover-item-title-row";

      const titleEl = document.createElement("span");
      titleEl.className = "popover-item-title";
      titleEl.textContent = chat.title || "Untitled Session";
      titleEl.title = chat.title || "Untitled Session";
      titleRow.appendChild(titleEl);

      if (isActive) {
        const activeBadge = document.createElement("span");
        activeBadge.className = "popover-current-badge";
        activeBadge.textContent = "Active";
        titleRow.appendChild(activeBadge);
      }

      const subRow = document.createElement("div");
      subRow.className = "popover-item-subrow";

      const timeEl = document.createElement("span");
      timeEl.className = "popover-item-time";
      timeEl.textContent = relTime;

      const idBadge = document.createElement("span");
      idBadge.className = "popover-item-id";
      idBadge.textContent = shortId;
      idBadge.title = `Full ID: ${chat.id}`;

      subRow.appendChild(timeEl);
      subRow.appendChild(idBadge);

      meta.appendChild(titleRow);
      meta.appendChild(subRow);

      // Resume action badge / button
      const actions = document.createElement("div");
      actions.className = "popover-item-actions";

      const resumeAction = document.createElement("button");
      resumeAction.type = "button";
      resumeAction.className = "popover-item-resume-btn";
      resumeAction.textContent = "Resume";
      resumeAction.title = `Resume this session (${shortId})`;
      resumeAction.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onResumeChat(chat.id);
        this.close();
      });

      actions.appendChild(resumeAction);

      item.appendChild(iconWrap);
      item.appendChild(meta);
      item.appendChild(actions);

      item.addEventListener("click", () => {
        this.callbacks.onResumeChat(chat.id);
        this.close();
      });

      list.appendChild(item);
    });

    listContainer.appendChild(list);
    this.listPill?.dispose();
    this.listPill = attachToolbarHoverPill(list, {
      itemSelector: ".popover-item",
      parkedSelector: ".popover-item.active-chat, .popover-item.selected",
      pillClass: "popover-row-indicator",
      box: true,
    });
  }
}

export function formatRelativeTime(dateStrOrMs: string | number): string {
  const time = typeof dateStrOrMs === "number" ? dateStrOrMs : new Date(dateStrOrMs).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Date.now() - time;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
