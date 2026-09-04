// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  springPresets,
  safeAnimate,
  SlidingPillIndicator,
  popoverMotion,
  attachButtonSpring,
  attachToolbarHoverPill,
  attachDualToolbarPills,
} from "../src/renderer/motion-utils";

describe("motion-utils", () => {
  describe("springPresets", () => {
    it("defines snappy, smooth, and bouncy spring presets with correct physics", () => {
      expect(springPresets.snappy).toEqual({
        type: "spring",
        stiffness: 350,
        damping: 30,
        mass: 0.8,
      });
      expect(springPresets.smooth).toEqual({
        type: "spring",
        stiffness: 300,
        damping: 28,
        mass: 1,
      });
      expect(springPresets.bouncy).toEqual({
        type: "spring",
        stiffness: 400,
        damping: 20,
        mass: 0.9,
      });
    });
  });

  describe("safeAnimate", () => {
    it("applies target styles safely in fallback/headless environment", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);

      const controls = safeAnimate(el, {
        opacity: [0, 1],
        scale: [0.95, 1],
        y: [6, 0],
        width: 120,
      });

      expect(controls).toBeDefined();
      expect(typeof controls.stop).toBe("function");
      expect(typeof controls.then).toBe("function");

      expect(el.style.opacity).toBe("1");
      expect(el.style.width).toBe("120px");
      expect(el.style.transform).toContain("scale(1)");
      expect(el.style.transform).toContain("translateY(0px)");

      document.body.removeChild(el);
    });

    it("resolves then callback promptly in fallback mode", async () => {
      const el = document.createElement("div");
      let called = false;
      const controls = safeAnimate(el, { opacity: 1 });
      await controls.then(() => {
        called = true;
      });
      expect(called).toBe(true);
    });
  });

  describe("SlidingPillIndicator", () => {
    it("mounts pill element and syncs coordinates to active element", () => {
      const container = document.createElement("div");
      container.style.position = "relative";
      document.body.appendChild(container);

      const item1 = document.createElement("button");
      item1.className = "tab-item";
      Object.defineProperty(item1, "offsetLeft", { configurable: true, value: 10 });
      Object.defineProperty(item1, "offsetWidth", { configurable: true, value: 80 });

      const item2 = document.createElement("button");
      item2.className = "tab-item active";
      Object.defineProperty(item2, "offsetLeft", { configurable: true, value: 100 });
      Object.defineProperty(item2, "offsetWidth", { configurable: true, value: 110 });

      container.appendChild(item1);
      container.appendChild(item2);

      const indicator = new SlidingPillIndicator(container, {
        pillClass: "custom-indicator",
      });

      expect(indicator.pill).toBeDefined();
      expect(indicator.pill.className).toBe("custom-indicator");
      expect(indicator.pill.style.position).toBe("absolute");

      indicator.sync(item2, true);

      expect(indicator.pill.style.opacity).toBe("1");
      expect(indicator.pill.style.transform).toBe("translateX(100px)");
      expect(indicator.pill.style.width).toBe("110px");

      // Change active element
      indicator.sync(item1, true);
      expect(indicator.pill.style.transform).toBe("translateX(10px)");
      expect(indicator.pill.style.width).toBe("80px");

      // No active element
      indicator.sync(null, true);
      expect(indicator.pill.style.opacity).toBe("0");

      indicator.destroy();
      expect(container.querySelector(".custom-indicator")).toBeNull();
      document.body.removeChild(container);
    });
  });

  describe("popoverMotion", () => {
    it("animates popover open and unhides element", () => {
      const popover = document.createElement("div");
      popover.hidden = true;
      document.body.appendChild(popover);

      popoverMotion.animatePopoverOpen(popover);
      expect(popover.hidden).toBe(false);
      expect(popover.style.opacity).toBe("1");

      document.body.removeChild(popover);
    });

    it("animates popover close, sets hidden, and invokes onDone callback", async () => {
      const popover = document.createElement("div");
      popover.hidden = false;
      document.body.appendChild(popover);

      const onDone = vi.fn();
      const controls = popoverMotion.animatePopoverClose(popover, onDone);

      await controls.then();

      expect(popover.hidden).toBe(true);
      expect(onDone).toHaveBeenCalledOnce();

      document.body.removeChild(popover);
    });
  });

  describe("attachButtonSpring", () => {
    it("attaches pointer events and cleans up on dispose", () => {
      const btn = document.createElement("button");
      document.body.appendChild(btn);

      const dispose = attachButtonSpring(btn);
      expect(btn.dataset.springAttached).toBe("true");

      btn.dispatchEvent(new PointerEvent("pointerenter"));
      expect(btn.style.transform).toContain("scale(1.03)");

      btn.dispatchEvent(new PointerEvent("pointerdown"));
      expect(btn.style.transform).toContain("scale(0.95)");

      btn.dispatchEvent(new PointerEvent("pointerup"));
      expect(btn.style.transform).toContain("scale(1.03)");

      btn.dispatchEvent(new PointerEvent("pointerleave"));
      expect(btn.style.transform).toContain("scale(1)");

      dispose();
      expect(btn.dataset.springAttached).toBeUndefined();

      document.body.removeChild(btn);
    });
  });

  describe("attachToolbarHoverPill", () => {
    it("slides the pill onto the hovered button and parks on .open", () => {
      const container = document.createElement("div");
      container.style.position = "relative";
      document.body.appendChild(container);

      const chats = document.createElement("button");
      chats.textContent = "Recent Chats";
      Object.defineProperty(chats, "offsetLeft", { configurable: true, value: 8 });
      Object.defineProperty(chats, "offsetWidth", { configurable: true, value: 120 });

      const folders = document.createElement("button");
      folders.textContent = "Recent Folders";
      Object.defineProperty(folders, "offsetLeft", { configurable: true, value: 136 });
      Object.defineProperty(folders, "offsetWidth", { configurable: true, value: 140 });

      container.append(chats, folders);

      const { dispose } = attachToolbarHoverPill(container, { pillClass: "chrome-action-indicator" });
      const pill = container.querySelector(".chrome-action-indicator") as HTMLElement;
      expect(pill).toBeTruthy();
      expect(pill.style.opacity).toBe("0");

      chats.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      expect(pill.style.opacity).toBe("1");
      expect(pill.style.transform).toBe("translateX(8px)");
      expect(pill.style.width).toBe("120px");

      folders.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      expect(pill.style.transform).toBe("translateX(136px)");
      expect(pill.style.width).toBe("140px");

      // Pointer leaves: the pill parks on the open item instead of fading out.
      folders.classList.add("open");
      container.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
      expect(pill.style.opacity).toBe("1");
      expect(pill.style.transform).toBe("translateX(136px)");
      expect(pill.style.width).toBe("140px");

      dispose();
      expect(container.querySelector(".chrome-action-indicator")).toBeNull();
      document.body.removeChild(container);
    });
  });

  describe("attachDualToolbarPills", () => {
    it("tracks the active item without re-triggering its own MutationObserver", async () => {
      const container = document.createElement("div");
      container.style.position = "relative";
      document.body.appendChild(container);

      const first = document.createElement("button");
      first.className = "ctrl-btn";
      Object.defineProperty(first, "offsetLeft", { configurable: true, value: 4 });
      Object.defineProperty(first, "offsetWidth", { configurable: true, value: 40 });

      const second = document.createElement("button");
      second.className = "ctrl-btn";
      Object.defineProperty(second, "offsetLeft", { configurable: true, value: 48 });
      Object.defineProperty(second, "offsetWidth", { configurable: true, value: 60 });

      container.append(first, second);

      const { dispose } = attachDualToolbarPills(container, {
        itemSelector: ".ctrl-btn",
        activeSelector: ".ctrl-btn.open, .ctrl-btn.active",
      });
      const activePill = container.querySelector(".dock-active-indicator") as HTMLElement;
      const hoverPill = container.querySelector(".dock-hover-indicator") as HTMLElement;
      expect(activePill.style.opacity).toBe("0");
      expect(hoverPill.style.opacity).toBe("0");

      // Watch every class/hidden write inside the container: syncing must not
      // produce any of its own, otherwise the internal observer feeds itself and
      // starves the microtask queue (renderer freeze).
      const records: MutationRecord[] = [];
      const spy = new MutationObserver((muts) => records.push(...muts));
      spy.observe(container, { attributes: true, subtree: true, attributeFilter: ["class", "hidden"] });

      second.classList.add("open");
      // Observer callbacks are microtasks; a handful of flushes settles them all.
      for (let i = 0; i < 5; i++) await Promise.resolve();

      expect(records).toHaveLength(1);
      expect(activePill.style.opacity).toBe("1");
      expect(activePill.style.transform).toBe("translateX(48px)");
      expect(activePill.style.width).toBe("60px");

      // Hovering the active item hands off to the active pill.
      second.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      expect(hoverPill.style.opacity).toBe("0");

      first.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      expect(hoverPill.style.opacity).toBe("1");
      expect(hoverPill.style.transform).toBe("translateX(4px)");
      expect(hoverPill.style.width).toBe("40px");

      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(records).toHaveLength(1);

      spy.disconnect();
      dispose();
      expect(container.querySelector(".dock-active-indicator")).toBeNull();
      expect(container.querySelector(".dock-hover-indicator")).toBeNull();
      document.body.removeChild(container);
    });

    it("does not put hover or active pills on skipSelector items", () => {
      const container = document.createElement("div");
      container.style.position = "relative";
      document.body.appendChild(container);

      const other = document.createElement("button");
      other.className = "ctrl-btn";
      Object.defineProperty(other, "offsetLeft", { configurable: true, value: 4 });
      Object.defineProperty(other, "offsetWidth", { configurable: true, value: 40 });

      const plan = document.createElement("button");
      plan.id = "dock-plan";
      plan.className = "ctrl-btn plan-on";
      Object.defineProperty(plan, "offsetLeft", { configurable: true, value: 48 });
      Object.defineProperty(plan, "offsetWidth", { configurable: true, value: 60 });

      container.append(other, plan);

      const { dispose } = attachDualToolbarPills(container, {
        itemSelector: ".ctrl-btn",
        skipSelector: "#dock-plan.plan-on, #dock-plan.plan-paused",
      });
      const hoverPill = container.querySelector(".dock-hover-indicator") as HTMLElement;
      const activePill = container.querySelector(".dock-active-indicator") as HTMLElement;

      other.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      expect(hoverPill.style.opacity).toBe("1");

      plan.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      expect(hoverPill.style.opacity).toBe("0");
      expect(activePill.style.opacity).toBe("0");

      dispose();
      document.body.removeChild(container);
    });
  });
});
