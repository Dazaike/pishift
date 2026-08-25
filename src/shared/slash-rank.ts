/** Ranking for the composer's slash palette, shared by renderer and tests. */

import type { SlashCommand } from "./slash-commands";

/**
 * Rank a command against a lowercased query. Lower is better; 4 = no match.
 * Namespaced commands (`skill:pdf`) also match on the segment after the last
 * `:`, so typing `pdf` surfaces `/skill:pdf`.
 */
export function rankSlashCommand(cmd: SlashCommand, q: string): number {
  const names = [cmd.name.toLowerCase()];
  const colon = cmd.name.lastIndexOf(":");
  if (colon >= 0) names.push(cmd.name.slice(colon + 1).toLowerCase());
  let best = 4;
  for (const name of names) {
    if (name === q) return 0;
    if (name.startsWith(q)) best = Math.min(best, 1);
    else if (name.includes(q)) best = Math.min(best, 2);
  }
  if (best === 4 && cmd.description.toLowerCase().includes(q)) return 3;
  return best;
}

/** Filter + order commands: match quality, then usage count, then name. */
export function rankSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
  usage: Readonly<Record<string, number>>,
): SlashCommand[] {
  const q = query.toLowerCase().trim();
  return commands
    .map((c) => ({ c, r: rankSlashCommand(c, q), u: usage[c.name] ?? 0 }))
    .filter(({ r }) => r < 4)
    .sort((a, b) => a.r - b.r || b.u - a.u || a.c.name.localeCompare(b.c.name))
    .map(({ c }) => c);
}
