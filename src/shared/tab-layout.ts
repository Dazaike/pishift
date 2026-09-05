export const TAB_LAYOUTS = ["vertical", "vertical-floating", "horizontal"] as const;
export type TabLayout = (typeof TAB_LAYOUTS)[number];

export const DEFAULT_TAB_LAYOUT: TabLayout = "vertical";

export function isTabLayout(value: unknown): value is TabLayout {
  return typeof value === "string" && (TAB_LAYOUTS as readonly string[]).includes(value);
}
