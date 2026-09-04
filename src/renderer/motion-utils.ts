import { animate } from "motion";

export const springPresets = {
  snappy: { type: "spring", stiffness: 350, damping: 30, mass: 0.8 },
  smooth: { type: "spring", stiffness: 300, damping: 28, mass: 1 },
  bouncy: { type: "spring", stiffness: 400, damping: 20, mass: 0.9 },
} as const;

/** Any one of the shared spring configurations above. */
export type SpringPreset = (typeof springPresets)[keyof typeof springPresets];

export interface MotionControls {
  stop: () => void;
  then: (resolve?: (val?: unknown) => void) => Promise<unknown>;
  cancel?: () => void;
  pause?: () => void;
  play?: () => void;
  finish?: () => void;
  time?: number;
  speed?: number;
}

function applyFallbackStyles(
  target: Element | Element[] | NodeListOf<Element> | string,
  keyframes: Record<string, unknown>
): void {
  if (typeof document === "undefined") return;

  let elements: Element[] = [];
  if (typeof target === "string") {
    elements = Array.from(document.querySelectorAll(target));
  } else if (target instanceof Element) {
    elements = [target];
  } else if (Array.isArray(target)) {
    elements = target;
  } else if (target && typeof (target as NodeListOf<Element>).length === "number") {
    elements = Array.from(target as NodeListOf<Element>);
  }

  for (const el of elements) {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
    const style = (el as HTMLElement).style;

    const transforms: string[] = [];

    for (const [key, rawVal] of Object.entries(keyframes)) {
      const val = Array.isArray(rawVal) ? rawVal[rawVal.length - 1] : rawVal;
      if (val === undefined || val === null) continue;

      if (key === "x" || key === "translateX") {
        const px = typeof val === "number" ? `${val}px` : String(val);
        transforms.push(`translateX(${px})`);
      } else if (key === "y" || key === "translateY") {
        const px = typeof val === "number" ? `${val}px` : String(val);
        transforms.push(`translateY(${px})`);
      } else if (key === "scale") {
        transforms.push(`scale(${val})`);
      } else if (key === "scaleX") {
        transforms.push(`scaleX(${val})`);
      } else if (key === "scaleY") {
        transforms.push(`scaleY(${val})`);
      } else if (key === "rotate") {
        const deg = typeof val === "number" ? `${val}deg` : String(val);
        transforms.push(`rotate(${deg})`);
      } else if (key === "transform") {
        transforms.push(String(val));
      } else if (key === "opacity") {
        style.opacity = String(val);
      } else if (key === "width") {
        style.width = typeof val === "number" ? `${val}px` : String(val);
      } else if (key === "height") {
        style.height = typeof val === "number" ? `${val}px` : String(val);
      } else {
        try {
          (style as unknown as Record<string, string>)[key] = String(val);
        } catch {
          // ignore unsupported property assignment
        }
      }
    }

    if (transforms.length > 0) {
      style.transform = transforms.join(" ");
    }
  }
}

function createFallbackControls(): MotionControls {
  let resolved = false;
  return {
    stop: () => {},
    then: (resolve?: (val?: unknown) => void) => {
      if (!resolved) {
        resolved = true;
        if (resolve) resolve();
      }
      return Promise.resolve();
    },
    cancel: () => {},
    pause: () => {},
    play: () => {},
    finish: () => {},
    time: 0,
    speed: 1,
  };
}

/**
 * Executes `animate()` from motion in a live WAAPI DOM environment;
 * falls back to direct style assignments when running in headless/jsdom or environments without WAAPI.
 */
export function safeAnimate(
  element: Element | Element[] | NodeListOf<Element> | string,
  keyframes: Record<string, unknown>,
  options?: Record<string, unknown>
): MotionControls {
  const isWaapiAvailable =
    typeof window !== "undefined" &&
    typeof Element !== "undefined" &&
    typeof Element.prototype.animate === "function";

  if (!isWaapiAvailable) {
    applyFallbackStyles(element, keyframes);
    return createFallbackControls();
  }

  try {
    const controls = animate(
      element as Parameters<typeof animate>[0],
      keyframes as Parameters<typeof animate>[1],
      options as Parameters<typeof animate>[2]
    );
    return controls as unknown as MotionControls;
  } catch {
    applyFallbackStyles(element, keyframes);
    return createFallbackControls();
  }
}

export type PillItemRect = {
  offsetLeft: number;
  offsetWidth: number;
  offsetTop?: number;
  offsetHeight?: number;
};

/**
 * Measures `el`'s box relative to `container` in container's own layout
 * pixels. Plain `getBoundingClientRect()` deltas are visual (post-transform)
 * pixels, so while an ancestor is mid CSS-transform animation (e.g. a
 * popover's open spring scaling from 0.95 -> 1), the delta comes out smaller
 * than the untransformed offset the pill's own `translate()` needs — the
 * pill lands offset until the transform settles at scale 1. Dividing by the
 * ancestor's current scale factor (visual rect size vs. real layout size)
 * corrects for that at every frame, not just once the animation ends.
 */
function measureItemRect(container: HTMLElement, el: HTMLElement, box: boolean): PillItemRect {
  const crate = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.width > 0 && crate.width > 0) {
    const scaleX = container.offsetWidth > 0 ? crate.width / container.offsetWidth : 1;
    const scaleY = container.offsetHeight > 0 ? crate.height / container.offsetHeight : 1;
    const next: PillItemRect = {
      offsetLeft: (r.left - crate.left) / scaleX + container.scrollLeft,
      offsetWidth: r.width / scaleX,
    };
    if (box) {
      next.offsetTop = (r.top - crate.top) / scaleY + container.scrollTop;
      next.offsetHeight = r.height / scaleY;
    }
    return next;
  }
  const fallback: PillItemRect = {
    offsetLeft: el.offsetLeft,
    offsetWidth: el.offsetWidth,
  };
  if (box) {
    fallback.offsetTop = el.offsetTop;
    fallback.offsetHeight = el.offsetHeight;
  }
  return fallback;
}

function pillFrame(rect: PillItemRect): Record<string, string> {
  if (rect.offsetTop != null && rect.offsetHeight != null) {
    return {
      transform: `translate(${rect.offsetLeft}px, ${rect.offsetTop}px)`,
      width: `${rect.offsetWidth}px`,
      height: `${rect.offsetHeight}px`,
    };
  }
  return {
    transform: `translateX(${rect.offsetLeft}px)`,
    width: `${rect.offsetWidth}px`,
  };
}

/**
 * Reusable controller that mounts a floating pill inside a parent element and
 * animates its position/size onto a caller-supplied target element.
 *
 * The indicator only ever writes inline styles on its own pill. It never marks
 * tracked items with helper classes, so a `MutationObserver` that watches the
 * container for class changes can call `sync()` without feeding itself.
 */
export class SlidingPillIndicator {
  public pill: HTMLElement;
  private container: HTMLElement;
  private getItemRect?: (activeEl: HTMLElement) => PillItemRect;
  private springPreset: SpringPreset;
  private mounted = false;

  constructor(
    container: HTMLElement,
    options?: {
      pillClass?: string;
      getItemRect?: (activeEl: HTMLElement) => PillItemRect;
      springPreset?: SpringPreset;
    }
  ) {
    this.container = container;
    this.getItemRect = options?.getItemRect;
    this.springPreset = options?.springPreset ?? springPresets.snappy;
    const existingPill = container.querySelector(
      `.${options?.pillClass ?? "sliding-indicator"}`
    ) as HTMLElement | null;

    if (existingPill) {
      this.pill = existingPill;
    } else {
      this.pill = document.createElement("div");
      this.pill.className = options?.pillClass ?? "sliding-indicator";
      this.pill.style.position = "absolute";
      this.pill.style.pointerEvents = "none";
      this.pill.style.opacity = "0";
      this.pill.style.willChange = "transform, width, height, opacity";
      container.prepend(this.pill);
    }
  }

  /** Slides the pill onto `target`; `null` fades it out. */
  public sync(target: HTMLElement | null, immediate = false): void {
    if (!target) {
      if (!this.mounted || immediate) {
        this.pill.style.opacity = "0";
      } else {
        safeAnimate(this.pill, { opacity: 0 }, { duration: 0.15 });
      }
      return;
    }

    const rect = this.getItemRect
      ? this.getItemRect(target)
      : { offsetLeft: target.offsetLeft, offsetWidth: target.offsetWidth };
    const frame = pillFrame(rect);

    if (!this.mounted || immediate) {
      this.pill.style.opacity = "1";
      Object.assign(this.pill.style, frame);
      this.mounted = true;
    } else {
      this.pill.style.opacity = "1";
      safeAnimate(this.pill, { ...frame, opacity: 1 }, this.springPreset);
    }
  }

  public destroy(): void {
    if (this.pill.parentNode === this.container) {
      this.container.removeChild(this.pill);
    }
  }
}

/**
 * Helpers to animate popover opening and closing smoothly before toggling `hidden`.
 */
export const popoverMotion = {
  animatePopoverOpen(el: HTMLElement, options?: Record<string, unknown>): MotionControls {
    el.hidden = false;
    return safeAnimate(
      el,
      {
        opacity: [0, 1],
        scale: [0.95, 1.0],
        y: [6, 0],
      },
      options ?? (springPresets.smooth as unknown as Record<string, unknown>)
    );
  },

  animatePopoverClose(
    el: HTMLElement,
    onDone: () => void,
    options?: Record<string, unknown>
  ): MotionControls {
    const controls = safeAnimate(
      el,
      {
        opacity: [1, 0],
        scale: [1.0, 0.96],
        y: [0, 4],
      },
      options ?? { duration: 0.14, ease: "easeOut" }
    );

    controls.then(() => {
      el.hidden = true;
      onDone();
    });

    return controls;
  },
};

/**
 * Attaches tactile spring scaling feedback on pointer down/up/enter/leave.
 */
export function attachButtonSpring(
  button: HTMLElement,
  options?: { hoverScale?: number; pressScale?: number }
): () => void {
  const dataset = button.dataset;
  if (dataset?.springAttached === "true") {
    return () => {};
  }
  if (dataset) dataset.springAttached = "true";

  const hoverScale = options?.hoverScale ?? 1.03;
  const pressScale = options?.pressScale ?? 0.95;

  const onPointerEnter = () => {
    safeAnimate(button, { scale: hoverScale }, springPresets.snappy as unknown as Record<string, unknown>);
  };

  const onPointerDown = () => {
    safeAnimate(button, { scale: pressScale }, springPresets.snappy as unknown as Record<string, unknown>);
  };

  const onPointerUp = () => {
    safeAnimate(button, { scale: hoverScale }, springPresets.snappy as unknown as Record<string, unknown>);
  };

  const onPointerLeave = () => {
    safeAnimate(button, { scale: 1.0 }, springPresets.snappy as unknown as Record<string, unknown>);
  };

  button.addEventListener("pointerenter", onPointerEnter);
  button.addEventListener("pointerdown", onPointerDown);
  button.addEventListener("pointerup", onPointerUp);
  button.addEventListener("pointerleave", onPointerLeave);

  return () => {
    button.removeAttribute("data-spring-attached");
    button.removeEventListener("pointerenter", onPointerEnter);
    button.removeEventListener("pointerdown", onPointerDown);
    button.removeEventListener("pointerup", onPointerUp);
    button.removeEventListener("pointerleave", onPointerLeave);
  };
}

function isToolbarItemShown(el: HTMLElement): boolean {
  if (!el.isConnected || el.hidden) return false;
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden";
}

/**
 * KokonutUI-style sliding pill that follows hover, then parks on `.open` / `.active`.
 */
export function attachToolbarHoverPill(
  container: HTMLElement,
  options?: {
    itemSelector?: string;
    pillClass?: string;
    parkedSelector?: string;
    box?: boolean;
  }
): { dispose: () => void; sync: (immediate?: boolean) => void } {
  const itemSelector = options?.itemSelector ?? "button";
  const parkedSelector =
    options?.parkedSelector ?? `${itemSelector}.open, ${itemSelector}.active`;
  const box = options?.box === true;
  const indicator = new SlidingPillIndicator(container, {
    pillClass: options?.pillClass ?? "sliding-indicator",
    getItemRect: (activeEl) => measureItemRect(container, activeEl, box),
  });

  let hovered: HTMLElement | null = null;

  const sync = (immediate = false): void => {
    const parked = container.querySelector<HTMLElement>(parkedSelector);
    const target =
      hovered && isToolbarItemShown(hovered)
        ? hovered
        : parked && isToolbarItemShown(parked)
          ? parked
          : null;
    indicator.sync(target, immediate);
  };

  const onOver = (ev: PointerEvent): void => {
    const btn = (ev.target as HTMLElement | null)?.closest(itemSelector);
    if (!(btn instanceof HTMLElement) || !container.contains(btn)) return;
    if (hovered === btn) return;
    hovered = btn;
    sync();
  };

  const onLeave = (ev: PointerEvent): void => {
    if (container.contains(ev.relatedTarget as Node)) return;
    hovered = null;
    sync();
  };

  const mo = new MutationObserver(() => sync());
  if (document.body) {
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  // See attachDualToolbarPills: snap instantly on any container layout
  // change so a late reflow (icon/font load) never shows as an animated jump.
  const ro = new ResizeObserver(() => sync(true));
  ro.observe(container);

  container.addEventListener("pointerover", onOver);
  container.addEventListener("pointerleave", onLeave);
  sync(true);

  const dispose = (): void => {
    mo.disconnect();
    ro.disconnect();
    container.removeEventListener("pointerover", onOver);
    container.removeEventListener("pointerleave", onLeave);
    indicator.destroy();
  };


  return { dispose, sync };
}

/**
 * KokonutUI / Motion dual-pill system:
 * 1. Primary active glass pill that animates with spring physics and locks to `.active` / `.open`
 * 2. Secondary hover pill that tracks mouse across items, fading out when hovering the active item
 */
export function attachDualToolbarPills(
  container: HTMLElement,
  options?: {
    itemSelector?: string;
    activeSelector?: string;
    /** Items that already paint their own selected chrome (e.g. Plan ON). */
    skipSelector?: string;
    activePillClass?: string;
    hoverPillClass?: string;
    box?: boolean;
  }
): { dispose: () => void; sync: (immediate?: boolean) => void } {
  const itemSelector = options?.itemSelector ?? "button";
  const activeSelector = options?.activeSelector ?? `${itemSelector}.open, ${itemSelector}.active`;
  const skipSelector = options?.skipSelector;
  const box = options?.box === true;

  const skipped = (el: HTMLElement | null): boolean =>
    !!el && !!skipSelector && el.matches(skipSelector);

  const getItemRect = (el: HTMLElement): PillItemRect => measureItemRect(container, el, box);

  // Active indicator (springPresets.smooth)
  const activeIndicator = new SlidingPillIndicator(container, {
    pillClass: options?.activePillClass ?? "dock-active-indicator",
    springPreset: springPresets.smooth,
    getItemRect,
  });

  // Hover indicator (springPresets.snappy)
  const hoverIndicator = new SlidingPillIndicator(container, {
    pillClass: options?.hoverPillClass ?? "dock-hover-indicator",
    springPreset: springPresets.snappy,
    getItemRect,
  });
  let hovered: HTMLElement | null = null;

  const sync = (immediate = false): void => {
    const activeEl = container.querySelector<HTMLElement>(activeSelector);
    const active =
      activeEl && !skipped(activeEl) && isToolbarItemShown(activeEl) ? activeEl : null;
    activeIndicator.sync(active, immediate);

    // Hovering the active item hands the highlight over to the active pill.
    const hover =
      hovered && hovered !== activeEl && !skipped(hovered) && isToolbarItemShown(hovered)
        ? hovered
        : null;
    hoverIndicator.sync(hover, immediate);
  };

  const onOver = (ev: PointerEvent): void => {
    const btn = (ev.target as HTMLElement | null)?.closest(itemSelector);
    if (!(btn instanceof HTMLElement) || !container.contains(btn)) return;
    if (skipped(btn)) {
      if (hovered === null) return;
      hovered = null;
      sync();
      return;
    }
    if (hovered === btn) return;
    hovered = btn;
    sync();
  };

  const onLeave = (ev: PointerEvent): void => {
    if (container.contains(ev.relatedTarget as Node)) return;
    hovered = null;
    sync();
  };

  const mo = new MutationObserver(() => sync());
  mo.observe(container, { attributes: true, subtree: true, attributeFilter: ["class", "hidden"] });

  // Row content (provider icons, async fonts) can reflow after the initial
  // immediate mount below has already measured and frozen a pill's position.
  // Without this, that stale placement only gets corrected on the next
  // pointer interaction, which then visibly animates the pill from the wrong
  // spot to the right one — looking like it "jumps" on hover. Snap instantly
  // (immediate) whenever the container's own layout size changes so the
  // correction never animates.
  const ro = new ResizeObserver(() => sync(true));
  ro.observe(container);

  container.addEventListener("pointerover", onOver);
  container.addEventListener("pointerleave", onLeave);
  sync(true);

  const dispose = (): void => {
    mo.disconnect();
    ro.disconnect();
    container.removeEventListener("pointerover", onOver);
    container.removeEventListener("pointerleave", onLeave);
    activeIndicator.destroy();
    hoverIndicator.destroy();
  };

  return { dispose, sync };
}
