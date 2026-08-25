import { animate, type JSAnimation } from "animejs";
import type { GlowActivity } from "../shared/ipc";

/** Trailing dots that fade out behind the head, forming a soft comet tail. */
const SEGMENTS = 16;
/** Visible length of each segment as a fraction of the perimeter. */
const SEG_LEN = 0.011;
const HEAD_OPACITY = 1.0;
const HEAD_WIDTH = 2.0;
const TAIL_WIDTH = 0.9;
/** Travel direction: 1 = counter-clockwise, -1 = clockwise. */
const DIRECTION = 1;
/** true = faint leading edge brightening toward the trailing end. */
const FADE_REVERSED = true;

/**
 * Single soft comet that travels the composer border, tapering toward its tail.
 *
 * A stroke gradient cannot follow a path, so the taper is built from stacked
 * short dashes phase-offset behind the head, each dimmer and thinner than the
 * last. All segments share one linear loop so they stay rigid relative to
 * each other.
 *
 * @see https://animejs.com/documentation/animation
 */
export class DockGlow {
  private readonly svg: SVGSVGElement;
  private readonly track: SVGPathElement;
  private readonly segments: SVGPathElement[] = [];
  private readonly anims: JSAnimation[] = [];
  private ro: ResizeObserver | null = null;
  private running = false;
  private kind: GlowActivity = "working";

  constructor(private readonly host: HTMLElement) {
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("id", "dock-editor-glow");
    this.svg.setAttribute("aria-hidden", "true");

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <filter id="dock-glow-soft" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="1.8" result="b"/>
        <feMerge>
          <feMergeNode in="b"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    `;

    this.track = this.makePath("glow-track");
    this.track.setAttribute("stroke-dasharray", "1 0");
    this.svg.append(defs, this.track);

    // Segments are contiguous (no overlap), so paint order does not matter.
    for (let i = SEGMENTS - 1; i >= 0; i--) {
      const seg = this.makePath("glow-seg");
      seg.setAttribute("stroke-dasharray", `${SEG_LEN} ${1 - SEG_LEN}`);
      seg.setAttribute("filter", "url(#dock-glow-soft)");
      // Cubic falloff along the comet; reversed puts the bright end last.
      const t = i / (SEGMENTS - 1);
      const fade = FADE_REVERSED ? t ** 2.2 : (1 - t) ** 2.2;
      seg.style.opacity = String(Math.max(0.015, HEAD_OPACITY * fade));
      seg.style.strokeWidth = String(TAIL_WIDTH + (HEAD_WIDTH - TAIL_WIDTH) * fade);
      this.segments[i] = seg;
      this.svg.appendChild(seg);
    }

    this.host.prepend(this.svg);

    this.layout();
    this.ro = new ResizeObserver(() => {
      const was = this.running;
      const kind = this.kind;
      this.layout();
      if (was) {
        this.stopAnimOnly();
        this.play(kind);
      }
    });
    this.ro.observe(this.host);
  }

  start(kind: GlowActivity = "working"): void {
    this.kind = kind;
    this.svg.classList.add("active");
    this.svg.style.color = `var(--glow-${kind})`;
    if (!this.running || this.anims.length === 0) {
      this.layout();
      this.play(kind);
      this.running = true;
    }
  }

  stop(): void {
    this.running = false;
    this.svg.classList.remove("active");
    this.stopAnimOnly();
    for (const seg of this.segments) seg.style.strokeDashoffset = "0";
  }

  dispose(): void {
    this.stop();
    this.ro?.disconnect();
    this.ro = null;
    this.svg.remove();
  }

  private play(kind: GlowActivity): void {
    this.stopAnimOnly();
    // Slower orbit while the agent is only waiting on the model, so a stalled
    // request reads as calm rather than as busy work.
    const duration = kind === "thinking" ? 5200 : kind === "waiting" ? 6400 : 3800;

    for (const [i, seg] of this.segments.entries()) {
      // Segments trail behind the head along the direction of travel.
      const base = DIRECTION * i * SEG_LEN;
      this.anims.push(
        animate(seg, {
          strokeDashoffset: [base, base + DIRECTION],
          ease: "linear",
          duration,
          loop: true,
        }),
      );
    }
  }

  private stopAnimOnly(): void {
    for (const a of this.anims) a.pause();
    this.anims.length = 0;
  }

  private makePath(className: string): SVGPathElement {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", className);
    p.setAttribute("pathLength", "1");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    return p;
  }

  private layout(): void {
    const w = Math.max(this.host.clientWidth, 2);
    const h = Math.max(this.host.clientHeight, 2);
    const pad = 1.5;
    const rw = w - pad * 2;
    const rh = h - pad * 2;
    const r = Math.min(8, rw / 2, rh / 2);
    const x = pad;
    const y = pad;

    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.svg.setAttribute("width", String(w));
    this.svg.setAttribute("height", String(h));

    const d = [
      `M ${x + r} ${y}`,
      `H ${x + rw - r}`,
      `A ${r} ${r} 0 0 1 ${x + rw} ${y + r}`,
      `V ${y + rh - r}`,
      `A ${r} ${r} 0 0 1 ${x + rw - r} ${y + rh}`,
      `H ${x + r}`,
      `A ${r} ${r} 0 0 1 ${x} ${y + rh - r}`,
      `V ${y + r}`,
      `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
      "Z",
    ].join(" ");

    this.track.setAttribute("d", d);
    for (const seg of this.segments) seg.setAttribute("d", d);
  }
}
