import type {
  AsyncJob,
  JobActivityDetails,
  JobActivityEvent,
} from "../shared/ipc";

const api = window.pishift;

function formatAge(startTime: number, now: number): string {
  if (!startTime || startTime <= 0) return "";
  const sec = Math.max(0, Math.floor((now - startTime) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class JobActivityModal {
  readonly el: HTMLDivElement;
  private currentJob: AsyncJob | null = null;
  private currentCwd: string | null = null;
  private activeTab: "stream" | "artifact" | "raw" = "stream";
  private details: JobActivityDetails | null = null;
  private onKillCallback: ((job: AsyncJob) => void) | null = null;
  private pollTimer: number | null = null;
  private isAutoRefresh = true;
  private isUserScrolledUp = false;
  private userScrollTop = 0;
  constructor() {
    this.el = document.createElement("div");
    this.el.id = "job-activity-modal";
    this.el.className = "job-activity-modal-backdrop";
    this.el.hidden = true;

    this.el.addEventListener("mousedown", (ev) => {
      if (ev.target === this.el) this.close();
    });

    document.addEventListener("keydown", (ev) => {
      if (this.isOpen && ev.key === "Escape") {
        ev.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  async open(
    job: AsyncJob,
    cwd?: string | null,
    onKill?: (job: AsyncJob) => void,
  ): Promise<void> {
    this.currentJob = job;
    this.currentCwd = cwd ?? null;
    this.onKillCallback = onKill ?? null;
    this.activeTab = "stream";
    this.details = null;
    this.el.hidden = false;
    this.render();
    await this.fetchData();

    this.startPolling();
  }

  close(): void {
    this.stopPolling();
    this.el.hidden = true;
    this.currentJob = null;
    this.details = null;
    this.isUserScrolledUp = false;
    this.userScrollTop = 0;
  }

  private startPolling(): void {
    this.stopPolling();
    if (!this.isAutoRefresh || !this.currentJob) return;

    this.pollTimer = window.setInterval(async () => {
      if (!this.isOpen || !this.currentJob) return this.stopPolling();
      await this.fetchData(false);
      // Stop auto-poll once completed or failed
      if (this.details?.status === "completed" || this.details?.status === "failed") {
        this.stopPolling();
      }
    }, 1500);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchData(showLoading = true): Promise<void> {
    if (!this.currentJob) return;

    if (showLoading && !this.details) {
      const body = this.el.querySelector(".job-modal-body");
      if (body) {
        body.innerHTML = `<div class="job-modal-loading"><span class="job-spinner"></span> Loading activity transcript…</div>`;
      }
    }

    try {
      const res = await api.getJobActivity({
        jobId: this.currentJob.id,
        label: this.currentJob.label,
        type: this.currentJob.type,
        status: this.currentJob.status,
        startTime: this.currentJob.startTime,
        cwd: this.currentCwd,
      });

      this.details = res || {
        jobId: this.currentJob.id,
        label: this.currentJob.label,
        type: this.currentJob.type,
        status: this.currentJob.status,
        startTime: this.currentJob.startTime,
        events: [],
      };
      this.render();
    } catch {
      this.details = {
        jobId: this.currentJob.id,
        label: this.currentJob.label,
        type: this.currentJob.type,
        status: this.currentJob.status,
        startTime: this.currentJob.startTime,
        events: [],
      };
      this.render();
    }
  }

  private render(): void {
    const job = this.currentJob;
    if (!job) return;

    const details = this.details;
    const now = Date.now();
    const age = formatAge(job.startTime, now);
    const status = details?.status || job.status || "running";

    // Save existing scroll position and user scroll state if body exists
    const prevBody = this.el.querySelector<HTMLDivElement>(".job-modal-body");
    if (prevBody) {
      this.userScrollTop = prevBody.scrollTop;
      const maxScroll = prevBody.scrollHeight - prevBody.clientHeight;
      // Consider user scrolled away from bottom if > 40px from bottom
      if (maxScroll > 0 && maxScroll - prevBody.scrollTop > 40) {
        this.isUserScrolledUp = true;
      }
    }

    this.el.innerHTML = `
      <div class="job-modal-card" role="dialog" aria-label="Job Activity">
        <div class="job-modal-header">
          <div class="job-modal-header-left">
            <span class="job-status-pill job-status-${status}">
              <span class="job-status-dot"></span>
              ${status.toUpperCase()}
            </span>
            <span class="job-type-pill">${escapeHtml(job.type)}</span>
            ${
              (details?.model || job.model)
                ? `<span class="job-model-pill" title="${escapeHtml(details?.model || job.model || "")}">
                    ${escapeHtml((details?.model || job.model || "").split("/").pop() || "")}
                  </span>`
                : ""
            }
            <h3 class="job-modal-title" title="${escapeHtml(job.label)}">${escapeHtml(job.label)}</h3>
            ${age ? `<span class="job-modal-age">Runtime: ${age}</span>` : ""}
          </div>
          <div class="job-modal-header-actions">
            ${
              status === "running"
                ? `<button type="button" class="job-modal-btn job-modal-btn-kill" id="job-kill-btn" title="Cancel/Kill this background job">
                    <span>&#x2716; Kill Job</span>
                  </button>`
                : ""
            }
            <button type="button" class="job-modal-btn" id="job-copy-uri-btn" title="Copy history:// URI">
              <span>&#x1F4CB; URI</span>
            </button>
            <button type="button" class="job-modal-btn" id="job-refresh-btn" title="Refresh transcript">
              <span>&#x21BB; Refresh</span>
            </button>
            <button type="button" class="job-modal-close" aria-label="Close">&times;</button>
          </div>
        </div>
        <div class="job-modal-tabs">
          <button type="button" class="job-tab-btn ${this.activeTab === "stream" ? "active" : ""}" data-tab="stream">
            Activity Stream (${details?.events?.length ?? 0})
          </button>
          ${
            details?.artifactMarkdown
              ? `<button type="button" class="job-tab-btn ${this.activeTab === "artifact" ? "active" : ""}" data-tab="artifact">Artifact / Report</button>`
              : ""
          }
          ${
            details?.rawLog
              ? `<button type="button" class="job-tab-btn ${this.activeTab === "raw" ? "active" : ""}" data-tab="raw">Raw Logs</button>`
              : ""
          }
        </div>

        <div class="job-modal-body">
          ${this.renderBodyContent(details)}
        </div>
      </div>
    `;
    // Restore scroll position
    const newBody = this.el.querySelector<HTMLDivElement>(".job-modal-body");
    if (newBody) {
      if (this.isUserScrolledUp) {
        newBody.scrollTop = this.userScrollTop;
      } else {
        newBody.scrollTop = newBody.scrollHeight;
      }

      newBody.addEventListener("scroll", () => {
        this.userScrollTop = newBody.scrollTop;
        const maxScroll = newBody.scrollHeight - newBody.clientHeight;
        this.isUserScrolledUp = maxScroll > 0 && (maxScroll - newBody.scrollTop > 40);
      });
    }

    // Bind event listeners
    this.el.querySelector(".job-modal-close")?.addEventListener("click", () => this.close());

    this.el.querySelector("#job-copy-uri-btn")?.addEventListener("click", () => {
      api.copyText(`history://${job.id}`);
      const btn = this.el.querySelector<HTMLButtonElement>("#job-copy-uri-btn");
      if (btn) {
        btn.innerHTML = "<span>&#x2713; Copied</span>";
        setTimeout(() => {
          if (btn) btn.innerHTML = "<span>&#x1F4CB; URI</span>";
        }, 1500);
      }
    });

    this.el.querySelector("#job-refresh-btn")?.addEventListener("click", () => {
      void this.fetchData(true);
    });
    this.el.querySelector("#job-kill-btn")?.addEventListener("click", () => {
      if (this.currentJob) {
        const target = this.currentJob;
        this.onKillCallback?.(target);
        target.status = "cancelled";
        if (this.details) this.details.status = "cancelled";
        this.stopPolling();
        this.render();
      }
    });

    this.el.querySelectorAll(".job-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = (btn as HTMLElement).dataset.tab as "stream" | "artifact" | "raw";
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;
          this.render();
        }
      });
    });

    this.el.querySelector("#job-copy-artifact-btn")?.addEventListener("click", () => {
      if (details?.artifactMarkdown) {
        api.copyText(details.artifactMarkdown);
        const btn = this.el.querySelector<HTMLButtonElement>("#job-copy-artifact-btn");
        if (btn) {
          btn.textContent = "Copied!";
          setTimeout(() => {
            if (btn) btn.textContent = "Copy Markdown";
          }, 1500);
        }
      }
    });
  }

  private renderBodyContent(details: JobActivityDetails | null): string {
    if (!details) {
      return `<div class="job-modal-loading"><span class="job-spinner"></span> Loading activity transcript…</div>`;
    }

    if (this.activeTab === "artifact" && details.artifactMarkdown) {
      return `
        <div class="job-artifact-view">
          <div class="job-artifact-toolbar">
            <span>Markdown Artifact</span>
            <button type="button" class="job-modal-btn" id="job-copy-artifact-btn">Copy Markdown</button>
          </div>
          <pre class="job-artifact-pre">${escapeHtml(details.artifactMarkdown)}</pre>
        </div>
      `;
    }

    if (this.activeTab === "raw" && details.rawLog) {
      return `
        <div class="job-raw-view">
          <pre class="job-raw-pre">${escapeHtml(details.rawLog)}</pre>
        </div>
      `;
    }

    // Default: Activity stream
    const events = details.events || [];
    if (events.length === 0) {
      const isRunning = details.status === "running";
      return `
        <div class="job-empty-events">
          <span class="job-empty-icon">${isRunning ? '<span class="job-spinner"></span>' : "&#x23F3;"}</span>
          <p>${isRunning ? "Subagent is running and recording activity…" : "No activity transcript recorded for this job."}</p>
          <span class="job-empty-sub">${isRunning ? "Live tool calls and thoughts will stream here automatically." : `Inspect via URI: history://${details.jobId}`}</span>
        </div>
      `;
    }

    const itemsHtml = events.map((ev, index) => this.renderEventItem(ev, index)).join("");
    return `<div class="job-stream-timeline">${itemsHtml}</div>`;
  }

  private renderEventItem(ev: JobActivityEvent, _index: number): string {
    switch (ev.type) {
      case "user_message":
        return `
          <div class="job-event-item job-event-user">
            <div class="job-event-badge">&#x1F464; Assignment</div>
            <div class="job-event-content">${escapeHtml(ev.text || "")}</div>
          </div>
        `;

      case "thinking":
        return `
          <details class="job-event-item job-event-thinking" open>
            <summary class="job-thinking-summary">
              <span class="job-thinking-icon">&#x1F9E0;</span>
              <strong>Thinking Process</strong>
            </summary>
            <div class="job-thinking-content">${escapeHtml(ev.text || "")}</div>
          </details>
        `;

      case "tool_call": {
        const argsStr = ev.toolArgs
          ? typeof ev.toolArgs === "string"
            ? ev.toolArgs
            : JSON.stringify(ev.toolArgs, null, 2)
          : "";
        return `
          <div class="job-event-item job-event-tool-call">
            <div class="job-tool-header">
              <span class="job-tool-badge">&#x2699; ${escapeHtml(ev.toolName || "tool")}</span>
              ${ev.toolIntent ? `<span class="job-tool-intent">${escapeHtml(ev.toolIntent)}</span>` : ""}
            </div>
            ${argsStr ? `<pre class="job-tool-args">${escapeHtml(argsStr)}</pre>` : ""}
          </div>
        `;
      }

      case "tool_result":
        return `
          <details class="job-event-item job-event-tool-result ${ev.isError ? "job-tool-error" : ""}" open>
            <summary class="job-result-summary">
              <span>${ev.isError ? "&#x274C; Error" : "&#x2714; Result"}: ${escapeHtml(ev.toolName || "Output")}</span>
            </summary>
            <pre class="job-result-pre">${escapeHtml(ev.toolResult || "")}</pre>
          </details>
        `;

      case "assistant_message":
        return `
          <div class="job-event-item job-event-assistant">
            <div class="job-event-badge">&#x1F4AC; Response</div>
            <div class="job-event-content">${escapeHtml(ev.text || "")}</div>
          </div>
        `;

      case "raw_log":
        return `
          <div class="job-event-item job-event-raw">
            <pre class="job-raw-pre">${escapeHtml(ev.text || "")}</pre>
          </div>
        `;

      default:
        return "";
    }
  }
}
