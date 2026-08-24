/**
 * omp's slash commands — GENERATED, do not edit.
 *
 * Source: omp.exe (internal CLI command registry)
 * Regenerate: node scripts/extract-slash-commands.mjs
 *
 * The composer palette filters this list, but never restricts input: an unknown
 * command is still typed through to omp verbatim.
 */

export type SlashCommand = {
  name: string;
  description: string;
  /** Argument placeholder shown in the palette, e.g. `<path>`. */
  hint?: string;
  /** Whether the command takes arguments. */
  args?: boolean;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "add-dir", description: "Add a workspace directory to this session (multi-root)", hint: "<path>", args: true },
  { name: "agents", description: "Open the agents hub (per-agent model, prewalk, and advisor)" },
  { name: "branch", description: "Create a new branch from a previous message" },
  { name: "btw", description: "Ask an ephemeral side question using the current session context", hint: "<question>", args: true },
  { name: "budget", description: "Adjust the token budget", hint: "[objective]", args: true },
  { name: "cleanse", description: "Detect and fix project diagnostics with weighted parallel subagents", hint: "[request] [--all]", args: true },
  { name: "clear", description: "Clear the conversation context in place, keeping the session" },
  { name: "compact", description: "Manually compact the session context", args: true },
  { name: "configure", description: "Open the advisor configuration editor (TUI)", args: true },
  { name: "context", description: "Show estimated context usage breakdown" },
  { name: "copy", description: "Pick text or code from the conversation to copy", args: true },
  { name: "debug", description: "Open debug tools selector" },
  { name: "dirs", description: "List this session's workspace directories" },
  { name: "disable", description: "Disable a marketplace plugin", args: true },
  { name: "disposition", description: "Set a finding disposition with rationale" },
  { name: "drop", description: "Delete the current session and start a new one" },
  { name: "dump", description: "Copy session transcript to clipboard (and write LLM request JSON to tmp)", args: true },
  { name: "exit", description: "Exit the application" },
  { name: "export", description: "Export session to HTML file", hint: "[--themes] [path]", args: true },
  { name: "extensions", description: "Open Extension Control Center dashboard" },
  { name: "force", description: "Force next turn to use a specific tool", hint: "<tool-name> [prompt]", args: true },
  { name: "fork", description: "Create a new fork from a previous message" },
  { name: "fresh", description: "Reset provider stream state without changing the local transcript" },
  { name: "full", description: "Show complete changelog", args: true },
  { name: "git", description: "Open the git UI (split diff viewer, staging, commit composer)", hint: "[revision]", args: true },
  { name: "guided-goal", description: "Have the agent interview you in chat, then set up goal mode", hint: "[rough objective]", args: true },
  { name: "handoff", description: "Hand off session context to a new session", hint: "[focus instructions]", args: true },
  { name: "help", description: "Show help message", args: true },
  { name: "hotkeys", description: "Show all keyboard shortcuts" },
  { name: "jobs", description: "Show async background jobs status" },
  { name: "join", description: "Join a shared collab session", hint: "<link>", args: true },
  { name: "leave", description: "Leave the collab session" },
  { name: "live", description: "Start Codex-backed realtime voice mode" },
  { name: "login", description: "Login with OAuth provider", hint: "[provider|redirect URL]", args: true },
  { name: "logout", description: "Logout from OAuth provider", hint: "[provider]", args: true },
  { name: "loop", description: "Toggle loop mode. While enabled, the next prompt you send re-submits after every yield. Esc cancels the current iteration; /loop again to disable.", hint: "[count|duration] [prompt]", args: true },
  { name: "m", description: "Instantly switch to a specific model (shorthand)", hint: "<model>", args: true },
  { name: "model", description: "Switch model for this session" },
  { name: "move", description: "Move the current session to a different directory", hint: "[<path>]", args: true },
  { name: "new", description: "Start a new session" },
  { name: "omfg", description: "Forge a TTSR rule from a complaint to stop a recurring behavior", hint: "<complaint>", args: true },
  { name: "pause", description: "Freeze all agents (main, subagents, advisor) until resumed" },
  { name: "pin", description: "Pin or unpin a session at the top of the resume list", hint: "[session id]", args: true },
  { name: "plan", description: "Toggle plan mode (agent plans before executing)", hint: "[prompt]", args: true },
  { name: "plan-review", description: "Re-open the plan review for the latest plan (plan mode only)" },
  { name: "prewalk", description: "Switch to a fast/cheap model at the next action (works even without --prewalk)" },
  { name: "providers", description: "Configure sign-in and web search providers" },
  { name: "queue", description: "Queue a message for after the agent yields", hint: "<message>", args: true },
  { name: "quit", description: "Quit the application" },
  { name: "rebuild", description: "Alias for enqueue", args: true },
  { name: "reload-plugins", description: "Reload all plugins (skills, commands, hooks, tools, agents, MCP)" },
  { name: "remove-dir", description: "Remove a workspace directory from this session", hint: "<path>", args: true },
  { name: "rename", description: "Rename the current session", hint: "<title>", args: true },
  { name: "reset", description: "Spend a saved Codex rate-limit reset", args: true },
  { name: "resume", description: "Resume a different session", hint: "[session id|@claude|@codex]", args: true },
  { name: "retry", description: "Retry the last failed agent turn" },
  { name: "rm", description: "Remove task/phase/all (fuzzy-matched)", args: true },
  { name: "settings", description: "Open settings menu" },
  { name: "share", description: "Share session via an encrypted link (share server or secret gist)" },
  { name: "stats", description: "Launch the local stats dashboard", hint: "[--port <port>] [--host <host>]", args: true },
  { name: "status", description: "Show fast mode status", args: true },
  { name: "stop", description: "Stop sharing", args: true },
  { name: "switch", description: "Switch model for this session (same as alt+p)" },
  { name: "switchto", description: "Instantly switch to a specific model", hint: "<model>", args: true },
  { name: "tan", description: "Run a full background agent on tangential work", hint: "<work>", args: true },
  { name: "thinking", description: "Drop all thinking blocks", args: true },
  { name: "tools", description: "Show tools currently visible to the agent" },
  { name: "tree", description: "Navigate session tree (switch branches)" },
  { name: "vibe", description: "Toggle vibe mode (direct persistent fast/good worker sessions; read-only toolset)", hint: "[prompt]", args: true },
  { name: "visible", description: "Switch to visible mode", args: true },
];
