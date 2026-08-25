export interface ParsedModelCommand {
  targetPlan?: "on" | "off" | "toggle";
  remainingSlashCommand?: string;
}

/**
 * Parse a composer `/m` slash command to extract plan mode targets
 * (`plan on`, `plan:on`, `plan=on`, `plan off`, `plan:off`, `plan=off`, `plan`)
 * and separate any remaining model/thinking tokens.
 */
export function parseModelSlashCommand(commandText: string): ParsedModelCommand {
  const trimmed = commandText.trim();
  if (!/^\/m\b/i.test(trimmed)) {
    return {};
  }
  const rawTokens = trimmed.slice(2).trim().split(/\s+/).filter(Boolean);
  let targetPlan: "on" | "off" | "toggle" | undefined;
  const remainingTokens: string[] = [];

  let idx = 0;
  while (idx < rawTokens.length) {
    const token = rawTokens[idx];
    const lower = token.toLowerCase();

    if (lower === "plan") {
      const nextToken = rawTokens[idx + 1]?.toLowerCase();
      if (nextToken === "on" || nextToken === "true" || nextToken === "1") {
        targetPlan = "on";
        idx += 2;
      } else if (nextToken === "off" || nextToken === "false" || nextToken === "0") {
        targetPlan = "off";
        idx += 2;
      } else {
        targetPlan = "toggle";
        idx += 1;
      }
      continue;
    }

    if (lower === "plan:on" || lower === "plan=on") {
      targetPlan = "on";
      idx++;
      continue;
    }

    if (lower === "plan:off" || lower === "plan=off") {
      targetPlan = "off";
      idx++;
      continue;
    }

    remainingTokens.push(token);
    idx++;
  }

  return {
    targetPlan,
    remainingSlashCommand: remainingTokens.length > 0 ? `/m ${remainingTokens.join(" ")}` : undefined,
  };
}
