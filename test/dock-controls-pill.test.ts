// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { attachDualToolbarPills } from "../src/renderer/motion-utils";

describe("dock-controls hover pill (real markup)", () => {
  it("shows a hover pill when pointing at a ctrl-btn", () => {
    document.body.innerHTML = `
      <div id="dock-controls">
        <div id="dock-tools-wrap"><button id="dock-tools-btn" class="ctrl-btn">Tools</button></div>
        <div id="dock-usage-wrap"><button id="dock-usage-btn" class="ctrl-btn">Usage</button></div>
        <div id="dock-plan-wrap"><button id="dock-plan" class="ctrl-btn plan-off">Plan: OFF</button></div>
        <div id="dock-action-group">
          <button id="dock-stop" hidden>Stop</button>
          <button id="dock-send">Send</button>
        </div>
      </div>`;
    const container = document.getElementById("dock-controls")!;
    for (const btn of container.querySelectorAll<HTMLElement>("button")) {
      Object.defineProperty(btn, "getBoundingClientRect", {
        value: () => ({ left: 10, top: 0, right: 60, bottom: 30, width: 50, height: 30 }),
      });
    }
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 300, bottom: 30, width: 300, height: 30 }),
    });
    Object.defineProperty(container, "offsetWidth", { value: 300, configurable: true });
    Object.defineProperty(container, "offsetHeight", { value: 30, configurable: true });

    const { dispose } = attachDualToolbarPills(container, {
      itemSelector: ".ctrl-btn, #dock-send, #dock-stop",
      activeSelector: ".ctrl-btn.open, .ctrl-btn.active",
      activePillClass: "dock-active-indicator",
      hoverPillClass: "dock-hover-indicator",
    });

    const sendBtn = document.getElementById("dock-send")!;
    sendBtn.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));

    const hoverPill = container.querySelector(".dock-hover-indicator") as HTMLElement;
    expect(hoverPill).toBeTruthy();
    expect(hoverPill.style.opacity).toBe("1");
    expect(hoverPill.style.transform).toContain("translateX(10px)");
    expect(hoverPill.style.width).toBe("50px");
    dispose();
  });
});
