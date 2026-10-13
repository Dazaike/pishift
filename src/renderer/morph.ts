const MORPH_MS = 420;
const MORPH_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animates an element's box (not a scale transform) between two rects so its contents
 * reflow live. `last` must already be the element's final layout.
 */
export function animateBox(el: HTMLElement, first: DOMRect, last: DOMRect, onDone: () => void): void {
  if (prefersReducedMotion()) {
    onDone();
    return;
  }
  const box = (r: DOMRect) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const anim = el.animate([box(first), box(last)], { duration: MORPH_MS, easing: MORPH_EASE });
  anim.onfinish = onDone;
  anim.oncancel = onDone;
}
