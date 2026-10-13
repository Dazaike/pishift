const DRAG_THRESHOLD_PX = 5;
const SETTLE_MS = 180;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export type PointerReorderSpec = {
  isActive: () => boolean;
  /** Resolves the draggable item (a direct child of its list, with `data-key`) from a pointerdown target. */
  resolveItem: (target: Element) => HTMLElement | null;
  /** Called on drop with the list whose DOM order changed. */
  onCommit: (list: HTMLElement) => void;
};

/** `data-key` of each keyed child, in DOM order. */
export function keysOf(list: Element): string[] {
  return Array.from(list.children)
    .map((c) => (c as HTMLElement).dataset.key)
    .filter((k): k is string => !!k);
}

/**
 * Pointer-driven drag reorder over rendered lists/grids. Deliberately not HTML5
 * drag-and-drop: the app's global file-drop overlay hooks those events.
 */
export function attachPointerReorder(root: HTMLElement, spec: PointerReorderSpec): void {
  root.addEventListener("dragstart", (ev) => {
    if (spec.isActive()) ev.preventDefault();
  });

  root.addEventListener("pointerdown", (ev) => {
    if (!spec.isActive() || ev.button !== 0) return;
    const item = spec.resolveItem(ev.target as Element);
    const list = item?.parentElement;
    if (!item || !list || !item.dataset.key || !root.contains(item)) return;
    ev.preventDefault();
    beginDrag(root, spec, item, list, ev);
  });
}

function beginDrag(
  body: HTMLElement,
  spec: PointerReorderSpec,
  item: HTMLElement,
  list: HTMLElement,
  start: PointerEvent,
): void {
  const items = () => Array.from(list.children).filter((c): c is HTMLElement => !!(c as HTMLElement).dataset.key);
  const startRect = item.getBoundingClientRect();
  const offX = start.clientX - startRect.left;
  const offY = start.clientY - startRect.top;
  let dragging = false;

  /**
   * Layout-only rects ("slots"), cached so hit-testing never reads rects that are
   * mid-FLIP-animation. Reading animated rects made swaps oscillate.
   */
  let slots = new Map<HTMLElement, DOMRect>();
  const measureSlots = () => {
    const lifted = item.style.transform;
    item.style.transform = "none";
    const running = items().flatMap((s) => s.getAnimations());
    for (const a of running) a.cancel();
    slots = new Map(items().map((s) => [s, s.getBoundingClientRect()]));
    item.style.transform = lifted;
  };
  measureSlots();

  /** Sibling the pointer just swapped with; ignored until the pointer leaves its slot. */
  let blocked: HTMLElement | null = null;

  const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

  const swapInto = (hit: HTMLElement) => {
    const others = items().filter((s) => s !== item);
    // Where each sibling visibly is right now (including in-flight animation offset).
    const visual = new Map(others.map((s) => [s, s.getBoundingClientRect()]));
    const children = items();
    if (children.indexOf(item) < children.indexOf(hit)) hit.after(item);
    else hit.before(item);
    measureSlots();
    for (const s of others) {
      const from = visual.get(s)!;
      const to = slots.get(s)!;
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (dx || dy) s.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: SETTLE_MS, easing: EASE });
    }
    blocked = hit;
  };

  const place = (e: PointerEvent) => {
    if (blocked && !inside(slots.get(blocked)!, e.clientX, e.clientY)) blocked = null;
    const hit = items().find((s) => s !== item && s !== blocked && inside(slots.get(s)!, e.clientX, e.clientY));
    if (hit) swapInto(hit);
    const natural = slots.get(item)!;
    item.style.transform = `translate(${e.clientX - offX - natural.left}px, ${e.clientY - offY - natural.top}px)`;
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      item.classList.add("reorder-dragging");
      body.classList.add("reorder-drag-active");
    }
    place(e);
  };

  const onScroll = () => measureSlots();

  const finish = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    body.removeEventListener("scroll", onScroll, true);
    if (!dragging) return;
    const cleanup = () => {
      item.style.transform = "";
      item.classList.remove("reorder-dragging");
      body.classList.remove("reorder-drag-active");
    };
    const lifted = item.style.transform;
    item.style.transform = "none";
    const anim = item.animate([{ transform: lifted }, { transform: "none" }], { duration: SETTLE_MS, easing: EASE });
    anim.onfinish = cleanup;
    anim.oncancel = cleanup;

    spec.onCommit(list);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  body.addEventListener("scroll", onScroll, true);
}
