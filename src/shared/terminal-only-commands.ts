/**
 * Slash commands whose output omp (>= 18.5.0) renders above the editor or on a
 * full-screen page instead of writing it into the session transcript. Chat
 * view reads the transcript, so the result is only visible in the terminal.
 *
 * A `null` subcommand set means the bare command always qualifies.
 */
const TERMINAL_ONLY: Readonly<Record<string, readonly string[] | null>> = {
  changelog: null,
  context: null,
  tools: null,
  hotkeys: null,
  jobs: null,
  mcp: ["list", "help", "resources", "prompts", "notifications"],
  ssh: ["list", "help"],
  memory: ["view", "queue", "stats", "diagnostics"],
  advisor: ["status"],
};

export function isTerminalOnlyCommand(text: string): boolean {
  const match = /^\s*\/([a-z][\w-]*)(?:\s+(\S+))?/i.exec(text);
  if (!match) return false;
  const subs = TERMINAL_ONLY[match[1].toLowerCase()];
  if (subs === undefined) return false;
  if (subs === null) return true;
  return match[2] !== undefined && subs.includes(match[2].toLowerCase());
}
