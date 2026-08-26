import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  GetJobActivityRequest,
  JobActivityDetails,
  JobActivityEvent,
} from "../shared/ipc";

const SESSIONS_DIR = join(homedir(), ".omp", "agent", "sessions");

function sanitizeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function generateCandidateKeys(jobId: string, label: string): string[] {
  const set = new Set<string>();
  const inputs = [jobId, label].filter(Boolean);

  for (const raw of inputs) {
    const rawTrim = raw.trim();
    if (!rawTrim) continue;

    set.add(rawTrim.toLowerCase());
    set.add(sanitizeKey(rawTrim));

    // CamelCase from words (e.g. "Job Fix Implementer" -> "jobfiximplementer")
    const words = rawTrim.split(/[\s_-]+/).filter(Boolean);
    const camel = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
    if (camel) set.add(camel.toLowerCase());

    // Sub-parts if delimited
    for (const part of words) {
      if (part.length >= 2 || /^\d+$/.test(part)) {
        set.add(part.toLowerCase());
      }
    }
  }

  return Array.from(set).filter(Boolean);
}

/** Recursively collect all session directories sorted newest first. */
function findSessionDirs(baseDir: string): string[] {
  if (!existsSync(baseDir)) return [];
  const results: { path: string; mtime: number }[] = [];

  function walk(current: string, depth: number) {
    if (depth > 4) return;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const ent of entries) {
        const full = join(current, ent.name);
        if (ent.isDirectory()) {
          try {
            results.push({ path: full, mtime: statSync(full).mtimeMs });
          } catch {}
          walk(full, depth + 1);
        }
      }
    } catch {}
  }

  walk(baseDir, 1);
  return results.sort((a, b) => b.mtime - a.mtime).map((r) => r.path);
}

export async function loadJobActivity(
  req: GetJobActivityRequest,
): Promise<JobActivityDetails | null> {
  const jobId = (req.jobId || "").trim();
  const label = (req.label || jobId).trim();

  const candidates = generateCandidateKeys(jobId, label);
  const sessionDirs = [SESSIONS_DIR, ...findSessionDirs(SESSIONS_DIR)];

  let matchedJsonl: string | null = null;
  let matchedMd: string | null = null;
  let matchedLog: string | null = null;

  for (const dir of sessionDirs) {
    try {
      const files = readdirSync(dir, { withFileTypes: true });
      for (const f of files) {
        if (f.isDirectory()) continue;
        const name = f.name;
        const nameClean = sanitizeKey(name);
        const nameLow = name.toLowerCase();

        const matches = candidates.some((cand) => {
          if (!cand) return false;
          if (/^\d+$/.test(cand)) {
            // Numeric candidate (e.g. "8") matches "8.bash.log", "8.read.log", etc.
            return nameLow.startsWith(`${cand}.`) || nameLow.includes(`.${cand}.`);
          }
          return nameClean.includes(cand) || nameLow.includes(cand);
        });

        if (!matches) continue;

        const fullPath = join(dir, name);
        if (name.endsWith(".jsonl") && !matchedJsonl && !name.includes("recent-sessions")) {
          matchedJsonl = fullPath;
        } else if (name.endsWith(".md") && !matchedMd) {
          matchedMd = fullPath;
        } else if ((name.endsWith(".log") || name.endsWith(".txt")) && !matchedLog) {
          matchedLog = fullPath;
        }
      }

      if (matchedJsonl) break;
    } catch {}
  }

  const events: JobActivityEvent[] = [];
  let artifactMarkdown: string | undefined;
  let rawLog: string | undefined;

  if (matchedMd && existsSync(matchedMd)) {
    try {
      artifactMarkdown = readFileSync(matchedMd, "utf8");
    } catch {}
  }

  if (matchedLog && existsSync(matchedLog)) {
    try {
      rawLog = readFileSync(matchedLog, "utf8");
    } catch {}
  }

  if (matchedJsonl && existsSync(matchedJsonl)) {
    try {
      const raw = readFileSync(matchedJsonl, "utf8");
      const lines = raw.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const timestamp = typeof entry.timestamp === "string"
            ? new Date(entry.timestamp).getTime()
            : typeof entry.timestamp === "number"
              ? entry.timestamp
              : undefined;

          if (entry.type === "message" && entry.message) {
            const msg = entry.message;
            const role = msg.role;

            if (role === "user") {
              const text = Array.isArray(msg.content)
                ? msg.content.map((c: { text?: string }) => c.text || "").join("\n").trim()
                : typeof msg.content === "string"
                  ? msg.content
                  : "";
              if (text) {
                events.push({
                  type: "user_message",
                  text,
                  timestamp,
                });
              }
            } else if (role === "assistant" && Array.isArray(msg.content)) {
              for (const c of msg.content) {
                if (c.type === "thinking" && c.thinking) {
                  events.push({
                    type: "thinking",
                    text: c.thinking,
                    timestamp,
                  });
                } else if (c.type === "toolCall") {
                  events.push({
                    type: "tool_call",
                    toolName: c.name,
                    toolIntent: c.intent,
                    toolArgs: c.arguments,
                    timestamp,
                  });
                } else if (c.type === "text" && c.text) {
                  events.push({
                    type: "assistant_message",
                    text: c.text,
                    timestamp,
                  });
                }
              }
            } else if (role === "toolResult") {
              const resText = Array.isArray(msg.content)
                ? msg.content.map((c: { text?: string }) => c.text || "").join("\n")
                : typeof msg.content === "string"
                  ? msg.content
                  : "";
              events.push({
                type: "tool_result",
                toolName: msg.toolName,
                toolResult: resText,
                isError: msg.isError === true,
                timestamp: typeof msg.timestamp === "number" ? msg.timestamp : timestamp,
              });
            }
          } else if (entry.type === "custom" && entry.customType === "tool_execution_start" && entry.data) {
            const d = entry.data;
            const last = events[events.length - 1];
            if (!last || last.type !== "tool_call" || last.toolName !== d.toolName) {
              events.push({
                type: "tool_call",
                toolName: d.toolName,
                toolIntent: d.intent,
                toolArgs: d.args,
                timestamp,
              });
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Fallback: convert raw log into event if no structured events were parsed
  if (events.length === 0 && rawLog) {
    events.push({
      type: "raw_log",
      text: rawLog,
    });
  }

  return {
    jobId: jobId || "job",
    label: label || jobId || "Job",
    type: req.type || "job",
    status: req.status || "running",
    startTime: req.startTime || 0,
    artifactMarkdown,
    events,
    rawLog,
  };
}
