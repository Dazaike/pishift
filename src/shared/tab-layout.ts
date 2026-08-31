/**
 * How the tab strip copes with more sessions than the header can show.
 *
 * The three modes are mutually exclusive presentations of the same tab list;
 * none of them changes tab order, so persisted state stays layout-agnostic.
 *
 * - `scroll`  — one row, tabs keep their natural width, the row scrolls
 *               (nudge arrows + wheel).
 * - `stack`   — tabs wrap into stacked rows and the header grows, capped at
 *               TAB_STACK_MAX_ROWS before the rows themselves scroll.
 * - `menu`    — tabs keep their natural width, the ones that do not fit are
 *               hidden behind a `+N` chip that opens a filterable switcher.
 */

export const TAB_LAYOUT_MODES = ["scroll", "stack", "menu"] as const;
export type TabLayoutMode = (typeof TAB_LAYOUT_MODES)[number];

export const DEFAULT_TAB_LAYOUT_MODE: TabLayoutMode = "scroll";

export const TAB_LAYOUT_LABELS: Record<TabLayoutMode, string> = {
  scroll: "Scrolling Strip (Arrows + Wheel)",
  stack: "Stacked Rows (Wrap Vertically)",
  menu: "Condense Extras into a +N Menu",
};

export function isTabLayoutMode(value: unknown): value is TabLayoutMode {
  return (
    typeof value === "string" && (TAB_LAYOUT_MODES as readonly string[]).includes(value)
  );
}

/** Rows the stacked strip may grow to before it scrolls instead of growing. */
export const TAB_STACK_MAX_ROWS = 3;

/** Width held back for the `+N` chip once condensing is unavoidable. */
export const TAB_OVERFLOW_CHIP_RESERVE = 48;

export type TabOverflowPlan = {
  /** Indices to hide, ascending. Never contains `activeIndex`. */
  hidden: number[];
};

const NOTHING_HIDDEN: TabOverflowPlan = { hidden: [] };

/**
 * Decide which tabs the `menu` mode must hide.
 *
 * The visible set is a left-to-right prefix so the strip stays positionally
 * stable as sessions come and go: filling later gaps with whichever narrow tab
 * happened to fit would reshuffle the header on every rename. The one
 * exception is the active tab, which is always kept — hiding it would leave
 * the header with no indication of which session is on screen.
 */
export function planTabOverflow(opts: {
  /** Natural (unshrunk) pixel width of each tab, in list order. */
  widths: readonly number[];
  /** Pixels the strip can paint into. */
  available: number;
  /** Index of the tab currently on screen, or -1. */
  activeIndex: number;
  /** Gap between adjacent tabs. */
  gap: number;
  /** Width to reserve for the overflow chip. */
  chipWidth?: number;
}): TabOverflowPlan {
  const { widths, available, activeIndex, gap } = opts;
  const count = widths.length;
  if (count <= 1) return NOTHING_HIDDEN;

  let total = 0;
  for (let i = 0; i < count; i++) total += widths[i] + (i > 0 ? gap : 0);
  if (total <= available) return NOTHING_HIDDEN;

  const budget = available - (opts.chipWidth ?? TAB_OVERFLOW_CHIP_RESERVE) - gap;
  const keep = new Uint8Array(count);
  let used = 0;

  // The active tab claims its width before anything else, so it survives even
  // when the strip is narrower than the tabs to its left.
  if (activeIndex >= 0 && activeIndex < count) {
    keep[activeIndex] = 1;
    used = widths[activeIndex];
  }

  for (let i = 0; i < count; i++) {
    if (keep[i]) continue;
    const cost = (used > 0 ? gap : 0) + widths[i];
    if (used + cost > budget) break;
    keep[i] = 1;
    used += cost;
  }

  const hidden: number[] = [];
  for (let i = 0; i < count; i++) if (!keep[i]) hidden.push(i);
  return { hidden };
}
