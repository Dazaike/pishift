/**
 * Environment for the hosted omp process.
 *
 * omp selects its terminal capability profile purely from environment variables,
 * checking `KITTY_WINDOW_ID`, `GHOSTTY_RESOURCES_DIR`, `WEZTERM_PANE`,
 * `ITERM_SESSION_ID`, `VSCODE_PID`, `ALACRITTY_WINDOW_ID`, then `TERM_PROGRAM`,
 * `TERM`, `COLORTERM` — in that order. The kitty/ghostty/wezterm profiles select
 * the kitty graphics protocol, which `@xterm/addon-image` cannot decode, and they
 * are checked *before* iterm2. So vars inherited from the launching terminal must
 * be stripped, and `ITERM_SESSION_ID` set: the iterm2 profile is exactly the
 * capability set xterm.js can honour (IIP images, truecolor, OSC 8, OSC 9, and no
 * DECCARA / text sizing / screen-to-scrollback).
 */

const STRIP: readonly string[] = [
  "KITTY_WINDOW_ID",
  "GHOSTTY_RESOURCES_DIR",
  "WEZTERM_PANE",
  "ALACRITTY_WINDOW_ID",
  "VSCODE_PID",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "WT_SESSION",
  "WT_PROFILE_ID",
];

export function buildPtyEnv(
  base: NodeJS.ProcessEnv,
  sessionId: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    env[key] = value;
  }
  for (const key of STRIP) delete env[key];

  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  // Unique per hosted tab so control-bridge telemetry can target the right chrome.
  env.OMPHIF_SESSION_ID = sessionId;
  env.ITERM_SESSION_ID = `w0t0p0:${sessionId}`;
  return env;
}
