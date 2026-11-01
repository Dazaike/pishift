export type ThemeSettings = {
  bg: string;
  bgRaised: string;
  bgTab: string;
  border: string;
  fg: string;
  fgDim: string;
  accent: string;
  termCursor: string;
  termSelection: string;
};

/** Per-theme user color overrides, keyed by preset name. Only changed fields are stored. */
export type ThemeOverrides = Record<string, Partial<ThemeSettings>>;

export const THEME_COLOR_FIELDS: ReadonlyArray<{ key: keyof ThemeSettings; label: string }> = [
  { key: "bg", label: "Background" },
  { key: "bgRaised", label: "Raised surface" },
  { key: "bgTab", label: "Tab" },
  { key: "border", label: "Border" },
  { key: "fg", label: "Text" },
  { key: "fgDim", label: "Dim text" },
  { key: "accent", label: "Accent" },
  { key: "termCursor", label: "Cursor" },
  { key: "termSelection", label: "Selection" },
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Drops unknown keys and non-hex values from untrusted persisted/imported overrides. */
export function sanitizeThemeOverrides(raw: unknown): ThemeOverrides {
  const out: ThemeOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [name, fields] of Object.entries(raw)) {
    if (!fields || typeof fields !== "object") continue;
    const clean: Partial<ThemeSettings> = {};
    for (const { key } of THEME_COLOR_FIELDS) {
      const value = (fields as Record<string, unknown>)[key];
      if (typeof value === "string" && HEX_COLOR.test(value)) clean[key] = value;
    }
    if (Object.keys(clean).length > 0) out[name] = clean;
  }
  return out;
}

export const DEFAULT_THEME: ThemeSettings = {
  bg: "#12131a",
  bgRaised: "#191b24",
  bgTab: "#1e2130",
  border: "#262a3a",
  fg: "#d7dae4",
  fgDim: "#8b93a8",
  accent: "#7aa2f7",
  termCursor: "#7aa2f7",
  termSelection: "#2b3350",
};
