import { BorderBeam } from "border-beam";
import { Fragment, createElement, type CSSProperties } from "react";
import { createRoot, type Root } from "react-dom/client";

/** React island that paints BorderBeam over the imperative composer dock. */
export class ChatComposerBeam {
  private readonly host = document.createElement("div");
  private readonly root: Root;
  private active = false;

  constructor(dock: HTMLElement) {
    this.host.id = "chat-composer-beam";
    this.host.hidden = true;
    this.host.setAttribute("aria-hidden", "true");
    dock.prepend(this.host);
    this.root = createRoot(this.host);
    this.render();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.host.hidden = !active;
    this.render();
  }

  private render(): void {
    // Two pulse-inner breathes (second hue-flipped 180° + mirrored so its
    // palette sits on the opposite side) plus one md traveler on top. The
    // pulse driver keys phase off absolute time, so equal durations stay
    // locked forever — the second breathe runs 2.3s vs 3.5s so the pair
    // drifts in and out instead of breathing as one.
    const breathe = (extra?: { duration?: number; style?: CSSProperties }) =>
      createElement(BorderBeam, {
        active: this.active,
        borderRadius: 22,
        brightness: 1,
        children: createElement("div", { className: "chat-composer-beam-surface" }),
        className: "chat-composer-beam-effect",
        colorVariant: "colorful",
        saturation: 0.8,
        size: "pulse-inner",
        strength: 1,
        theme: "dark",
        ...extra,
      });
    this.root.render(
      createElement(
        Fragment,
        null,
        breathe(),
        breathe({
          duration: 3.5,
          style: { filter: "hue-rotate(180deg)", transform: "scaleX(-1)" },
        }),
        createElement(BorderBeam, {
          active: this.active,
          borderRadius: 22,
          brightness: 1.4,
          children: createElement("div", { className: "chat-composer-beam-surface" }),
          className: "chat-composer-beam-effect",
          colorVariant: "colorful",
          duration: 1.6,
          saturation: 1.2,
          size: "md",
          strength: 0.8,
          theme: "dark",
        }),
      ),
    );
  }
}
