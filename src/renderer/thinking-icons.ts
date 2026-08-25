/**
 * SVG icons for each thinking / reasoning effort level.
 *
 * Rendered inline with `currentColor` so they scale with font-size, inherit
 * theme colors, and never suffer 404/asset resolution issues in production builds.
 */

export function normalizeThinkingLevelKey(raw: string): "off" | "min" | "low" | "medium" | "high" | "xhigh" | "auto" {
  const key = (raw || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "off" || key === "none" || key === "disabled" || key === "0") return "off";
  if (key === "min" || key === "minimal" || key === "minimum" || key === "1") return "min";
  if (key === "low" || key === "2") return "low";
  if (key === "med" || key === "medium" || key === "mid" || key === "3") return "medium";
  if (key === "high" || key === "hi" || key === "4") return "high";
  if (key === "xhigh" || key === "xhi" || key === "extrahigh" || key === "max" || key === "maximum" || key === "5") return "xhigh";
  return "auto";
}

const THINKING_SVGS: Record<"off" | "min" | "low" | "medium" | "high" | "xhigh" | "auto", string> = {
  off: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" class="btn-icon thinking-icon thinking-icon-off" aria-hidden="true">
  <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3" stroke-opacity="0.45"/>
  <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" stroke="currentColor" stroke-width="1.4" stroke-opacity="0.75" stroke-linecap="round"/>
</svg>`,

  min: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" class="btn-icon thinking-icon thinking-icon-min" aria-hidden="true">
  <rect x="1.5" y="11" width="2" height="3" rx="0.5" fill="currentColor"/>
  <rect x="4.5" y="9" width="2" height="5" rx="0.5" fill="currentColor" fill-opacity="0.22"/>
  <rect x="7.5" y="7" width="2" height="7" rx="0.5" fill="currentColor" fill-opacity="0.22"/>
  <rect x="10.5" y="5" width="2" height="9" rx="0.5" fill="currentColor" fill-opacity="0.22"/>
  <rect x="13.5" y="3" width="2" height="11" rx="0.5" fill="currentColor" fill-opacity="0.22"/>
</svg>`,

  low: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" class="btn-icon thinking-icon thinking-icon-low" aria-hidden="true">
  <rect x="1.5" y="11" width="2" height="3" rx="0.5" fill="currentColor"/>
  <rect x="4.5" y="9" width="2" height="5" rx="0.5" fill="currentColor"/>
  <rect x="7.5" y="7" width="2" height="7" rx="0.5" fill="currentColor" fill-opacity="0.22"/>
  <rect x="10.5" y="5" width="2" height="9" rx="0.5" fill="currentColor" fill-opacity="0.22"/>
  <rect x="13.5" y="3" width="2" height="11" rx="0.5" fill="currentColor" fill-opacity="0.22"/>
</svg>`,

  medium: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" class="btn-icon thinking-icon thinking-icon-medium" aria-hidden="true">
  <rect x="1.5" y="11" width="2" height="3" rx="0.5" fill="currentColor"/>
  <rect x="4.5" y="9" width="2" height="5" rx="0.5" fill="currentColor"/>
  <rect x="7.5" y="7" width="2" height="7" rx="0.5" fill="currentColor"/>
  <rect x="10.5" y="5" width="2" height="9" rx="0.5" fill="currentColor" fill-opacity="0.22"/>
  <rect x="13.5" y="3" width="2" height="11" rx="0.5" fill="currentColor" fill-opacity="0.22"/>
</svg>`,

  high: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" class="btn-icon thinking-icon thinking-icon-high" aria-hidden="true">
  <rect x="1.5" y="11" width="2" height="3" rx="0.5" fill="currentColor"/>
  <rect x="4.5" y="9" width="2" height="5" rx="0.5" fill="currentColor"/>
  <rect x="7.5" y="7" width="2" height="7" rx="0.5" fill="currentColor"/>
  <rect x="10.5" y="5" width="2" height="9" rx="0.5" fill="currentColor"/>
  <rect x="13.5" y="3" width="2" height="11" rx="0.5" fill="currentColor" fill-opacity="0.22"/>
</svg>`,

  xhigh: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" class="btn-icon thinking-icon thinking-icon-xhigh" aria-hidden="true">
  <rect x="1.5" y="11" width="2" height="3" rx="0.5" fill="currentColor"/>
  <rect x="4.5" y="9" width="2" height="5" rx="0.5" fill="currentColor"/>
  <rect x="7.5" y="7" width="2" height="7" rx="0.5" fill="currentColor"/>
  <rect x="10.5" y="5" width="2" height="9" rx="0.5" fill="currentColor"/>
  <rect x="13.5" y="3" width="2" height="11" rx="0.5" fill="currentColor"/>
</svg>`,

  auto: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" class="btn-icon thinking-icon thinking-icon-auto" aria-hidden="true">
  <path d="M8 1.5 C8 4.5 5.5 7 2.5 7 C5.5 7 8 9.5 8 12.5 C8 9.5 10.5 7 13.5 7 C10.5 7 8 4.5 8 1.5 Z" fill="currentColor" fill-opacity="0.85"/>
  <path d="M12.5 1.5 C12.5 2.5 11.5 3.5 10.5 3.5 C11.5 3.5 12.5 4.5 12.5 5.5 C12.5 4.5 13.5 3.5 14.5 3.5 C13.5 3.5 12.5 2.5 12.5 1.5 Z" fill="currentColor" fill-opacity="0.95"/>
</svg>`,
};

/** Get the inline SVG markup for a given thinking level. */
export function getThinkingIconSvg(rawLevel: string): string {
  const key = normalizeThinkingLevelKey(rawLevel);
  return THINKING_SVGS[key] ?? THINKING_SVGS.auto;
}
