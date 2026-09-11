/**
 * Environment for the hosted omp process.
 * omp selects a terminal capability profile from environment variables. Strip
 * identities inherited from the terminal that launched PiShift, then expose a
 * conservative xterm profile. Explicitly do not set `ITERM_SESSION_ID`:
 * in-terminal IIP graphics can wedge xterm's write queue on malformed image
 * data or an unsettled decode, hiding omp's footer and every later frame. With
 * the ordinary xterm profile, omp presents image attachments as its durable text
 * fallback — the same behavior as Windows Terminal.
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
  "ITERM_SESSION_ID",
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
  env.PISHIFT_SESSION_ID = sessionId;
  // No ITERM_SESSION_ID: in-terminal IIP graphics are unsafe in this shell.
  return env;
}
