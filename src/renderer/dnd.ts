/** Window-level drag-and-drop: every external drag is captured and attached to the composer dock. */

/**
 * Resolve dropped/pasted `File` objects to real filesystem paths. `File.path` was
 * removed in Electron 32; `webUtils.getPathForFile` is the replacement and yields
 * "" for in-memory Files (e.g. a screenshot pasted from the clipboard).
 */
export function filePaths(files: readonly File[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const path = window.omphif.getPathForFile(file);
    if (path) out.push(path);
  }
  return out;
}

/** Marks drags that start inside the app (tab reorder, model-card reorder). */
export const INTERNAL_DRAG_TYPE = "application/x-pishift-internal";

/** True when the drag came from outside the app and the dock should claim it. */
export function isExternalDrag(types: readonly string[]): boolean {
  return !types.includes(INTERNAL_DRAG_TYPE);
}

/**
 * Drag nesting tracker. Browsers fire `dragleave` for the element being left
 * before `dragenter` for the element being entered, so only a depth counter can
 * answer "is the pointer still inside the window". A drag released outside the
 * window delivers no final dragleave, hence the staleness watchdog.
 */
export class DragTracker {
  private depth = 0;
  private lastOver = 0;

  /** Returns true when this enter made the drag newly active. */
  enter(now: number): boolean {
    this.depth += 1;
    this.lastOver = now;
    return this.depth === 1;
  }

  over(now: number): void {
    this.lastOver = now;
  }

  /** Returns true when the drag has fully left. */
  leave(): boolean {
    if (this.depth > 0) this.depth -= 1;
    return this.depth === 0;
  }

  /** Force-clear; returns true when a drag was actually in flight. */
  end(): boolean {
    const wasActive = this.depth > 0;
    this.depth = 0;
    return wasActive;
  }

  isStale(now: number, timeoutMs: number): boolean {
    return this.depth > 0 && now - this.lastOver > timeoutMs;
  }

  get active(): boolean {
    return this.depth > 0;
  }
}

export type WindowDndHooks = {
  onPaths(paths: string[]): void;
  onText(text: string): void;
  onHover(active: boolean, count: number): void;
};

const STALE_MS = 500;
const WATCHDOG_MS = 250;

export function installWindowDnd(hooks: WindowDndHooks): void {
  const tracker = new DragTracker();
  const clear = (): void => {
    if (tracker.end()) hooks.onHover(false, 0);
  };
  const external = (ev: DragEvent): DataTransfer | null =>
    ev.dataTransfer && isExternalDrag(Array.from(ev.dataTransfer.types)) ? ev.dataTransfer : null;

  window.addEventListener("dragenter", (ev) => {
    const dt = external(ev);
    if (!dt) return;
    ev.preventDefault();
    if (tracker.enter(Date.now())) hooks.onHover(true, dt.items.length);
  });

  window.addEventListener("dragover", (ev) => {
    const dt = external(ev);
    if (!dt) return;
    // Claim the drop before any child (xterm's textarea included): the composer
    // is the only drop target in this app.
    ev.preventDefault();
    dt.dropEffect = "copy";
    tracker.over(Date.now());
  });

  window.addEventListener("dragleave", (ev) => {
    if (!external(ev)) return;
    ev.preventDefault();
    if (tracker.leave()) hooks.onHover(false, 0);
  });

  window.addEventListener("drop", (ev) => {
    const dt = external(ev);
    if (!dt) return;
    ev.preventDefault();
    clear();
    const paths = filePaths(Array.from(dt.files));
    if (paths.length) {
      hooks.onPaths(paths);
      return;
    }
    // No on-disk paths (URL, selected text, in-memory file): drop the text in.
    const text = (dt.getData("text/uri-list") || dt.getData("text/plain")).trim();
    if (text) hooks.onText(text);
  });

  window.addEventListener("dragend", clear);
  window.setInterval(() => {
    if (tracker.isStale(Date.now(), STALE_MS)) clear();
  }, WATCHDOG_MS);
}
