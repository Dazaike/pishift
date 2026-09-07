export const TAB_LAYOUTS = ["vertical", "vertical-floating", "vertical-icons", "horizontal"] as const;
export type TabLayout = (typeof TAB_LAYOUTS)[number];

export const DEFAULT_TAB_LAYOUT: TabLayout = "vertical";

export function isTabLayout(value: unknown): value is TabLayout {
  return typeof value === "string" && (TAB_LAYOUTS as readonly string[]).includes(value);
}

/** Vertical session rail edge. Horizontal strip ignores this. */
export const TAB_RAIL_SIDES = ["left", "right"] as const;
export type TabRailSide = (typeof TAB_RAIL_SIDES)[number];

export const DEFAULT_TAB_RAIL_SIDE: TabRailSide = "left";

export function isTabRailSide(value: unknown): value is TabRailSide {
  return typeof value === "string" && (TAB_RAIL_SIDES as readonly string[]).includes(value);
}

/**
 * Invisible hover hit strip width (px) extending from the collapsed rail into
 * the content area. Larger = easier accidental open; smaller = must aim closer.
 */
export const DEFAULT_TAB_RAIL_HOVER_REACH_PX = 150;
export const MIN_TAB_RAIL_HOVER_REACH_PX = 24;
export const MAX_TAB_RAIL_HOVER_REACH_PX = 280;

export function clampTabRailHoverReachPx(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TAB_RAIL_HOVER_REACH_PX;
  return Math.min(
    MAX_TAB_RAIL_HOVER_REACH_PX,
    Math.max(MIN_TAB_RAIL_HOVER_REACH_PX, Math.round(n)),
  );
}
