/** WCAG 2.x contrast helpers. All colors are 6-digit `#rrggbb`. */

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear mix of two colors; `t` is the weight of `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/**
 * Returns `color` when it already meets `ratio` against `bg`; otherwise the first mix toward
 * `pole` (in 10% steps) that does, falling back to `pole` itself.
 */
export function ensureContrast(color: string, bg: string, ratio: number, pole: string): string {
  if (contrastRatio(color, bg) >= ratio) return color;
  for (let step = 1; step <= 10; step++) {
    const c = mixHex(color, pole, step / 10);
    if (contrastRatio(c, bg) >= ratio) return c;
  }
  return pole;
}
