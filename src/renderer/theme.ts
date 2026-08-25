import type { ITheme } from "@xterm/xterm";
import {
  DEFAULT_THEME_NAME,
  getThemeByName,
  THEME_PRESETS,
  type ThemePreset,
} from "../shared/themes";

export { DEFAULT_THEME_NAME, getThemeByName, THEME_PRESETS, type ThemePreset };

export function buildXtermTheme(preset: ThemePreset): ITheme {
  return {
    background: preset.bg,
    foreground: preset.fg,
    cursor: preset.termCursor,
    cursorAccent: preset.bg,
    selectionBackground: preset.termSelection,
    scrollbarSliderBackground: `${preset.accent}59`,
    scrollbarSliderHoverBackground: `${preset.accent}8c`,
    scrollbarSliderActiveBackground: `${preset.accent}bf`,
    ...preset.ansi,
  };
}

export const DEFAULT_PRESET = getThemeByName(DEFAULT_THEME_NAME);
export const TERMINAL_THEME: ITheme = buildXtermTheme(DEFAULT_PRESET);
export const FONT_FAMILY = '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';
export const FONT_SIZE = 13;
