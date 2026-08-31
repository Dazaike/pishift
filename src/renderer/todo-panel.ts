import type { AsyncJob, ProviderUsageReport, TodoPhase } from "../shared/ipc";
import { renderUsageCards } from "./usage-render";

export type TodoPanelMode = "overlay" | "docked";

const STATUS_MARK: Record<string, string> = {
  done: "\u2611",
  completed: "\u2611",
  in_progress: "\u25D0",
  pending: "\u2610",
};

/** Coarse status buckets — omp may add statuses; anything unknown renders neutral. */
const JOB_STATUS_CLASS: Record<string, string> = {
  running: "job-running",
  completed: "job-completed",
  failed: "job-failed",
  cancelled: "job-cancelled",
  canceled: "job-cancelled",
};

function formatJobAge(startTime: number, now: number): string {
  if (!startTime) return "";
  const secs = Math.max(0, Math.floor((now - startTime) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Read-only session side panel — displays OMP's live `/todo` task list and
 * provider rate limits in one vertically-stacked view without sub-tabs.
 */
export class TodoPanel {
  private readonly workspace = document.getElementById("workspace") as HTMLDivElement;
  private readonly panel = document.getElementById("todo-panel") as HTMLElement;
  private readonly todoBody = document.getElementById("todo-panel-body") as HTMLDivElement;
  private readonly usageBody = document.getElementById("usage-panel-body") as HTMLDivElement;
  private readonly jobsBody = document.getElementById("jobs-panel-body") as HTMLDivElement;
  private readonly modeBtn = document.getElementById("todo-panel-mode") as HTMLButtonElement;
  private readonly refreshBtn = document.getElementById("todo-panel-refresh") as HTMLButtonElement;
  private readonly toggleBtn = document.getElementById("btn-todo") as HTMLButtonElement;
  private readonly closeBtn = document.getElementById("todo-panel-close") as HTMLButtonElement;
  private visible = false;
  private mode: TodoPanelMode = "overlay";
  private phases: TodoPhase[] | null = null;
  private jobs: AsyncJob[] = [];
  private usageReports: ProviderUsageReport[] = [];
  private usageLoading = false;

  constructor(
    private readonly onVisibilityChange: (visible: boolean) => void,
    private readonly onModeChange: (mode: TodoPanelMode) => void,
    private readonly refreshUsageReports: () => Promise<ProviderUsageReport[]>,
    private readonly onJobClick?: (job: AsyncJob) => void,
    private readonly onKillJob?: (job: AsyncJob) => void,
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
      this.renderJobs();
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

  setJobs(jobs: AsyncJob[]): void {
    this.jobs = jobs;
    if (this.visible) this.renderJobs();
  }
  setUsageReports(reports: ProviderUsageReport[]): void {
    this.usageReports = reports;
    if (this.visible) this.renderUsage();
  }


  public async refreshUsage(): Promise<void> {
    this.usageLoading = true;
    this.renderUsage();
    try {
      this.usageReports = await this.refreshUsageReports();
    } catch {
      // Keep the last successful reports while the shared tracker retries.
    } finally {
      this.usageLoading = false;
      this.renderUsage();
    }
  }

  /** Manual refresh from the panel header — re-renders tasks and re-queries quotas. */
  public async refreshAll(): Promise<void> {
    this.render();
    this.renderJobs();
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

  private renderJobs(): void {
    if (this.jobs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "todo-panel-empty";
      empty.textContent = "No active jobs.";
      this.jobsBody.replaceChildren(empty);
      return;
    }

    const now = Date.now();
    const rows = this.jobs.map((job) => {
      const row = document.createElement("div");
      row.className = `job-row ${JOB_STATUS_CLASS[job.status] ?? "job-completed"}`;
      row.title = `Click to view live activity for ${job.label}`;
      row.addEventListener("click", () => {
        this.onJobClick?.(job);
      });
      const dot = document.createElement("span");
      dot.className = "job-dot";

      const main = document.createElement("div");
      main.className = "job-main";

      const label = document.createElement("span");
      label.className = "job-label";
      label.textContent = job.label;
      label.title = job.label;

      const meta = document.createElement("div");
      meta.className = "job-meta";
      const type = document.createElement("span");
      type.className = "job-type";
      type.textContent = job.type;
      const age = formatJobAge(job.startTime, now);
      const status = document.createElement("span");
      status.textContent =
        job.status === "running" ? (age ? `running \u00B7 ${age}` : "running") : job.status;
      meta.append(type, status);

      main.append(label, meta);
      row.append(dot, main);
      if (job.status === "running") {
        const killBtn = document.createElement("button");
        killBtn.type = "button";
        killBtn.className = "job-kill-btn";
        killBtn.innerHTML = "&times;";
        killBtn.title = `Kill job: ${job.label}`;
        killBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.onKillJob?.(job);
        });
        row.append(killBtn);
      }
      return row;
    });
    this.jobsBody.replaceChildren(...rows);
  }
}
