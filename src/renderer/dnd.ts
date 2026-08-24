/** Window-level drag-and-drop of files and folders without intrusive overlays. */

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

export function installWindowDnd(onDrop: (paths: string[]) => void): void {
  window.addEventListener("dragenter", (ev) => {
    ev.preventDefault();
  });

  window.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (ev) => {
    ev.preventDefault();
  });

  window.addEventListener("drop", (ev) => {
    // If dragging an internal UI element (e.g. model card reordering), don't treat as file drop.
    if (ev.dataTransfer && ev.dataTransfer.types.includes("text/plain") && !ev.dataTransfer.types.includes("Files")) {
      return;
    }
    ev.preventDefault();
    const paths = filePaths(Array.from(ev.dataTransfer?.files ?? []));
    if (paths.length) onDrop(paths);
  });
}
