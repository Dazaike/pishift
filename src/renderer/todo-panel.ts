import type { ProviderUsageReport, TodoPhase } from "../shared/ipc";
import { renderUsageCards } from "./usage-render";

export type TodoPanelMode = "overlay" | "docked";

const STATUS_MARK: Record<string, string> = {
  done: "\u2611",
  completed: "\u2611",
  in_progress: "\u25D0",
  pending: "\u2610",
};

/**
 * Read-only session side panel — displays OMP's live `/todo` task list and
 * provider rate limits in one vertically-stacked view without sub-tabs.
 */
export class TodoPanel {
  private readonly workspace = document.getElementById("workspace") as HTMLDivElement;
  private readonly panel = document.getElementById("todo-panel") as HTMLElement;
  private readonly todoBody = document.getElementById("todo-panel-body") as HTMLDivElement;
  private readonly usageBody = document.getElementById("usage-panel-body") as HTMLDivElement;
  private readonly modeBtn = document.getElementById("todo-panel-mode") as HTMLButtonElement;
  private readonly refreshBtn = document.getElementById("todo-panel-refresh") as HTMLButtonElement;
  private readonly toggleBtn = document.getElementById("btn-todo") as HTMLButtonElement;
  private readonly closeBtn = document.getElementById("todo-panel-close") as HTMLButtonElement;
  private visible = false;
  private mode: TodoPanelMode = "overlay";
  private phases: TodoPhase[] | null = null;
  private usageReports: ProviderUsageReport[] = [];
  private usageLoading = false;

  constructor(
    private readonly onVisibilityChange: (visible: boolean) => void,
    private readonly onModeChange: (mode: TodoPanelMode) => void,
  ) {
    this.closeBtn.addEventListener("click", () => this.setVisible(false));
    this.modeBtn.addEventListener("click", () => {
      this.setMode(this.mode === "overlay" ? "docked" : "overlay");
    });
    this.refreshBtn.addEventListener("click", () => {
      void this.refreshAll();
    });
  }

  init(visible: boolean, mode: TodoPanelMode): void {
    this.mode = mode;
    this.visible = visible;
    this.applyState();
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.applyState();
    this.onVisibilityChange(visible);
    if (visible) {
      this.render();
      void this.refreshUsage();
    }
  }

  setMode(mode: TodoPanelMode): void {
    this.mode = mode;
    this.applyState();
    this.onModeChange(mode);
  }

  setPhases(phases: TodoPhase[] | null): void {
    this.phases = phases;
    if (this.visible) this.render();
  }
  public async refreshUsage(): Promise<void> {
    this.usageLoading = true;
    this.renderUsage();
    try {
      this.usageReports = await window.omphif.getProviderUsage();
    } catch {
      this.usageReports = [];
    } finally {
      this.usageLoading = false;
      this.renderUsage();
    }
  }

  /** Manual refresh from the panel header — re-renders tasks and re-queries quotas. */
  public async refreshAll(): Promise<void> {
    this.render();
    this.refreshBtn.classList.add("spinning");
    try {
      await this.refreshUsage();
    } finally {
      this.refreshBtn.classList.remove("spinning");
    }
  }
  private applyState(): void {
    this.panel.hidden = !this.visible;
    this.workspace.classList.toggle("todo-overlay", this.visible && this.mode === "overlay");
    this.workspace.classList.toggle("todo-docked", this.visible && this.mode === "docked");
    if (this.mode === "overlay") {
      this.modeBtn.innerHTML = "&#x1F4CC;"; // Pushpin
      this.modeBtn.title = "Pin to side (dock and resize terminal)";
    } else {
      this.modeBtn.innerHTML = "&#x2922;"; // Unpin / pop-out
      this.modeBtn.title = "Unpin (float over terminal)";
    }
    this.toggleBtn.classList.toggle("active", this.visible);
  }

  private renderUsage(): void {
    if (this.usageLoading) {
      const loadingBox = document.createElement("div");
      loadingBox.className = "usage-loading-box";
      const spinner = document.createElement("span");
      spinner.className = "usage-spinner";
      const text = document.createElement("span");
      text.textContent = "Querying live provider quotas...";
      loadingBox.append(spinner, text);
      this.usageBody.replaceChildren(loadingBox);
      return;
    }
    renderUsageCards(this.usageBody, this.usageReports);
  }

  private render(): void {
    this.todoBody.replaceChildren();

    if (!this.phases || this.phases.length === 0) {
      const empty = document.createElement("div");
      empty.className = "todo-panel-empty";
      empty.textContent = "No active to-do list.";
      this.todoBody.appendChild(empty);
      return;
    }

    for (const phase of this.phases) {
      const section = document.createElement("div");
      section.className = "todo-phase";

      const heading = document.createElement("div");
      heading.className = "todo-phase-name";
      heading.textContent = phase.name;
      section.appendChild(heading);

      for (const task of phase.tasks) {
        const row = document.createElement("div");
        row.className = `todo-task todo-task-${task.status}`;
        const mark = document.createElement("span");
        mark.className = "todo-task-mark";
        mark.textContent = STATUS_MARK[task.status] ?? "\u2610";
        const label = document.createElement("span");
        label.className = "todo-task-label";
        label.textContent = task.content;
        row.append(mark, label);
        section.appendChild(row);
      }

      this.todoBody.appendChild(section);
    }
  }
}
