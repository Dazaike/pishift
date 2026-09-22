import { ThinkingOrb, type OrbState, type OrbTheme } from "thinking-orbs";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ControlBridgeActivity, GlowActivity } from "../shared/ipc";

/**
 * Which orb animation stands in for which agent activity. Each orb state is a
 * separately tuned animation, so the mapping is by gesture, not by name:
 * scanning for reads, morphing shapes for edits, orbiting particles for a
 * shell command.
 */
const ORB_STATE: Record<GlowActivity, OrbState> = {
  waiting: "breathing",
  thinking: "solving",
  responding: "composing",
  reading: "searching",
  editing: "shaping",
  running: "working",
  working: "weaving",
};

/** Inline-text tuning; 64 is the chat-avatar preset and dwarfs the header row. */
const ORB_SIZE = 20;

/**
 * The app ships both dark and light terminal themes and exposes neither as a
 * `data-theme` attribute, so `theme: "auto"` (which reads the Tailwind/shadcn
 * convention, then `prefers-color-scheme`) would pick the wrong ink. Resolve
 * from the live `--bg` instead.
 */
function resolveOrbTheme(): OrbTheme {
  const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg);
  if (!match) return "dark";
  const hex = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
  const n = Number.parseInt(hex, 16);
  // Rec. 601 luma is close enough to decide light vs dark ink.
  const luma = (0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)) / 255;
  return luma > 0.5 ? "light" : "dark";
}

/**
 * React island painting a `ThinkingOrb` inside the imperative chat activity
 * header. One instance per `ChatView`: the host element is moved between
 * activity sections rather than re-created, so the animation is continuous and
 * exactly one canvas ever runs.
 */
export class ActivityOrb {
  private readonly host = document.createElement("span");
  private readonly root: Root;
  private state: OrbState = "working";
  /** Detached orbs stay mounted but frozen — a hidden canvas must not drive rAF. */
  private paused = true;

  constructor() {
    this.host.className = "chat-activity-orb";
    this.host.setAttribute("aria-hidden", "true");
    this.root = createRoot(this.host);
    this.render();
  }

  /** Move the orb into `head`, running, and switch it to `activity`'s animation. */
  show(head: HTMLElement, activity: ControlBridgeActivity): void {
    const state = activity === "idle" ? "working" : ORB_STATE[activity as GlowActivity] ?? "working";
    const moved = this.host.parentElement !== head;
    if (moved) head.prepend(this.host);
    if (!moved && state === this.state && !this.paused) return;
    this.state = state;
    this.paused = false;
    this.render();
  }

  hide(): void {
    this.host.remove();
    if (this.paused) return;
    this.paused = true;
    this.render();
  }

  dispose(): void {
    this.host.remove();
    // React forbids unmounting a root while it renders; this never runs from
    // inside one, but the microtask keeps that guarantee cheap.
    queueMicrotask(() => this.root.unmount());
  }

  private render(): void {
    this.root.render(
      createElement(ThinkingOrb, {
        paused: this.paused,
        size: ORB_SIZE,
        state: this.state,
        theme: resolveOrbTheme(),
      }),
    );
  }
}
