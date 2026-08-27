import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type {
  InstalledModelGroup,
  ProviderLimit,
  ProviderUsageReport,
  ProviderUsageStat,
  RecentChatInfo,
  SessionMessage,
} from "../shared/ipc";
import { resolveOmpPath } from "./omp-locate";

const OMP_DIR = join(homedir(), ".omp");

export function formatProviderName(provider: string): string {
  const map: Record<string, string> = {
    "google-antigravity": "Google Antigravity",
    "google-vertex": "Google Vertex AI",
    "openai-codex": "OpenAI Codex",
    openai: "OpenAI",
    anthropic: "Anthropic",
    "xai-oauth": "xAI Grok",
    nanogpt: "NanoGPT",
    "kimi-code": "Kimi",
    openrouter: "OpenRouter",
    devin: "Devin",
    litellm: "LiteLLM",
    zenmux: "ZenMux",
  };
  return map[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

function getDatabaseSyncConstructor(): (new (
  path: string,
  options?: { readOnly?: boolean },
) => DatabaseSyncType) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require("node:sqlite") as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => DatabaseSyncType;
    };
    return sqlite.DatabaseSync ?? null;
  } catch {
    return null;
  }
}

export function loadInstalledModels(): InstalledModelGroup[] {
  const dbPath = join(OMP_DIR, "agent", "models.db");
  if (!existsSync(dbPath)) return [];

  const DatabaseSync = getDatabaseSyncConstructor();
  if (!DatabaseSync) return [];

  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare("SELECT provider_id, models FROM model_cache").all() as {
      provider_id: string;
      models: string;
    }[];

    const groups: InstalledModelGroup[] = [];

    for (const row of rows) {
      if (!row.models) continue;
      try {
        const rawList = JSON.parse(row.models) as {
          id: string;
          name?: string;
          description?: string;
          reasoning?: boolean;
          thinking?: {
            efforts?: string[];
            requiresEffort?: boolean;
          } | null;
        }[];
        if (!Array.isArray(rawList) || rawList.length === 0) continue;

        const provider = row.provider_id.split(":")[0] ?? row.provider_id;
        const models = rawList.map((m) => {
          const efforts = Array.isArray(m.thinking?.efforts)
            ? m.thinking!.efforts!.map((e) => String(e).toLowerCase())
            : undefined;
          return {
            id: m.id,
            name: m.name || m.id,
            provider,
            description: m.description,
            reasoning: m.reasoning,
            thinkingEfforts: efforts,
            thinkingRequiresEffort: m.thinking?.requiresEffort === true,
          };
        });

        const existing = groups.find((g) => g.provider === provider);
        if (existing) {
          existing.models.push(...models);
        } else {
          groups.push({
            provider,
            providerName: formatProviderName(provider),
            models,
          });
        }
      } catch {
        // Skip corrupt entry
      }
    }

    return groups;
  } catch (err) {
    console.error("Failed to load models.db:", err);
    return [];
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

/** Execute `omp usage --json` to get live provider rate limits, quotas, and accounts. */
export async function queryOmpUsage(): Promise<ProviderUsageReport[]> {
  const { promise, resolve } = Promise.withResolvers<ProviderUsageReport[]>();
  let exe: string;
  try {
    exe = resolveOmpPath();
  } catch {
    return [];
  }

  execFile(exe, ["usage", "--json"], { timeout: 10000 }, (err, stdout) => {
    if (err || !stdout) {
      // Fallback: try plain `omp usage` text
      execFile(exe, ["usage"], { timeout: 10000 }, (_e, plainText) => {
        if (plainText) {
          resolve([
            {
              provider: "all",
              providerName: "OMP Usage Output",
              limits: [],
              rawText: plainText.trim(),
            },
          ]);
        } else {
          resolve([]);
        }
      });
      return;
    }

    try {
      const parsed = JSON.parse(stdout) as {
        reports?: {
          provider: string;
          status?: string;
          account?: string;
          limits?: {
            label: string;
            amount?: { used?: number; limit?: number; remaining?: number; unit?: string; usedFraction?: number };
            window?: { resetsAt?: number };
          }[];
        }[];
      };

      if (!Array.isArray(parsed.reports)) {
        resolve([]);
        return;
      }

      const now = Date.now();
      const reports: ProviderUsageReport[] = parsed.reports.map((r) => {
        const limits: ProviderLimit[] = (r.limits ?? []).map((l) => {
          const used = l.amount?.used ?? 0;
          const limit = l.amount?.limit ?? 100;
          const remaining = l.amount?.remaining ?? 0;
          const unit = l.amount?.unit ?? "percent";
          const usedFraction = l.amount?.usedFraction ?? (limit > 0 ? used / limit : 0);
          const usedPercent = Math.round(usedFraction * 100);
          const resetsAt = l.window?.resetsAt;
          const resetsIn = resetsAt && resetsAt > now ? formatDuration(resetsAt - now) : undefined;

          return {
            label: l.label,
            used,
            limit,
            remaining,
            unit,
            usedPercent,
            resetsIn,
          };
        });

        return {
          provider: r.provider,
          providerName: formatProviderName(r.provider),
          status: r.status,
          account: r.account,
          limits,
        };
      });

      resolve(reports);
    } catch {
      resolve([]);
    }
  });

  return promise;
}

export function loadDatabaseStats(): ProviderUsageStat[] {
  const dbPath = join(OMP_DIR, "stats.db");
  if (!existsSync(dbPath)) return [];

  const DatabaseSync = getDatabaseSyncConstructor();
  if (!DatabaseSync) return [];

  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        `
        SELECT 
          provider,
          COUNT(*) as total_requests,
          COALESCE(SUM(input_tokens), 0) as total_input,
          COALESCE(SUM(output_tokens), 0) as total_output,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_total), 0) as total_cost,
          MAX(timestamp) as last_used
        FROM messages
        WHERE provider IS NOT NULL AND provider != ''
        GROUP BY provider
        ORDER BY total_tokens DESC
      `,
      )
      .all() as {
      provider: string;
      total_requests: number;
      total_input: number;
      total_output: number;
      total_tokens: number;
      total_cost: number;
      last_used: number;
    }[];

    return rows.map((r) => ({
      provider: formatProviderName(r.provider),
      totalRequests: Number(r.total_requests) || 0,
      totalInput: Number(r.total_input) || 0,
      totalOutput: Number(r.total_output) || 0,
      totalTokens: Number(r.total_tokens) || 0,
      totalCost: Number(r.total_cost) || 0,
      lastUsed: Number(r.last_used) || undefined,
    }));
  } catch (err) {
    console.error("Failed to load stats.db:", err);
    return [];
  }
}

function normalizeDirPath(dir: string): string {
  try {
    return resolve(dir).replace(/[\\/]+$/, "");
  } catch {
    return dir.replace(/[\\/]+$/, "");
  }
}

/** Gather all past project directories opened in PiShift or discovered from OMP records. */
export function loadRecentFolders(persistedFolders?: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  const add = (dir: string | null | undefined): void => {
    if (!dir || typeof dir !== "string") return;
    const norm = normalizeDirPath(dir);
    const key = norm.toLowerCase();
    if (seen.has(key)) return;
    try {
      if (existsSync(norm) && statSync(norm).isDirectory()) {
        seen.add(key);
        results.push(norm);
      }
    } catch {
      // Skip inaccessible paths
    }
  };

  // 1. Persisted folders first (most recent first)
  if (Array.isArray(persistedFolders)) {
    for (const f of persistedFolders) add(f);
  }

  // 2. ~/.omp/agent/projects.json
  try {
    const projFile = join(OMP_DIR, "agent", "projects.json");
    if (existsSync(projFile)) {
      const data = JSON.parse(readFileSync(projFile, "utf8")) as { projects?: { path?: string }[] };
      if (Array.isArray(data.projects)) {
        for (const p of data.projects) add(p.path);
      }
    }
  } catch {
    // Ignore parse errors
  }

  // 3. ~/.omp/agent/history.db
  const DatabaseSync = getDatabaseSyncConstructor();
  if (DatabaseSync) {
    try {
      const historyDbPath = join(OMP_DIR, "agent", "history.db");
      if (existsSync(historyDbPath)) {
        const db = new DatabaseSync(historyDbPath, { readOnly: true });
        const rows = db.prepare("SELECT DISTINCT cwd FROM history WHERE cwd IS NOT NULL").all() as { cwd: string }[];
        for (const row of rows) add(row.cwd);
      }
    } catch {
      // Ignore SQLite errors
    }
  }

  // 4. Session directories from ~/.omp/agent/sessions
  try {
    const sessionsDir = join(OMP_DIR, "agent", "sessions");
    if (existsSync(sessionsDir)) {
      const subdirs = readdirSync(sessionsDir);
      for (const sub of subdirs) {
        const subPath = join(sessionsDir, sub);
        if (!statSync(subPath).isDirectory()) continue;
        const files = readdirSync(subPath).filter((f) => f.endsWith(".jsonl"));
        for (const file of files.slice(0, 3)) {
          const filePath = join(subPath, file);
          try {
            const fd = openSync(filePath, "r");
            const buf = Buffer.alloc(8192);
            const bytesRead = readSync(fd, buf, 0, 8192, 0);
            closeSync(fd);
            const text = buf.toString("utf8", 0, bytesRead);
            const lines = text.split("\n");
            for (const line of lines.slice(0, 5)) {
              if (!line.trim()) continue;
              try {
                const obj = JSON.parse(line) as { type?: string; cwd?: string };
                if (obj.type === "session" && obj.cwd) {
                  add(obj.cwd);
                  break;
                }
              } catch {}
            }
          } catch {}
        }
      }
    }
  } catch {}

  return results.slice(0, 50);
}

/** Load recent chats/sessions for a specific folder or all folders. */
export function loadRecentChats(targetCwd?: string): RecentChatInfo[] {
  const normTarget = targetCwd ? normalizeDirPath(targetCwd).toLowerCase() : null;
  const sessionsDir = join(OMP_DIR, "agent", "sessions");
  if (!existsSync(sessionsDir)) return [];

  // Query session titles map if history.db is available
  const titlesMap = new Map<string, string>();
  const DatabaseSync = getDatabaseSyncConstructor();
  if (DatabaseSync) {
    try {
      const historyDbPath = join(OMP_DIR, "agent", "history.db");
      if (existsSync(historyDbPath)) {
        const db = new DatabaseSync(historyDbPath, { readOnly: true });
        const rows = db.prepare("SELECT session_id, title FROM session_titles WHERE title IS NOT NULL").all() as {
          session_id: string;
          title: string;
        }[];
        for (const row of rows) {
          if (row.session_id && row.title) {
            titlesMap.set(row.session_id, row.title);
          }
        }
      }
    } catch {}
  }

  const results: RecentChatInfo[] = [];
  try {
    const subdirs = readdirSync(sessionsDir);
    for (const sub of subdirs) {
      const subPath = join(sessionsDir, sub);
      try {
        if (!statSync(subPath).isDirectory()) continue;
        const files = readdirSync(subPath).filter((f) => f.endsWith(".jsonl"));
        for (const file of files) {
          const filePath = join(subPath, file);
          try {
            const stat = statSync(filePath);
            const fd = openSync(filePath, "r");
            const buf = Buffer.alloc(65536);
            const bytesRead = readSync(fd, buf, 0, 65536, 0);
            closeSync(fd);
            const text = buf.toString("utf8", 0, bytesRead);
            const lines = text.split("\n");

            let sessionInfo: { id?: string; cwd?: string; timestamp?: string; title?: string } | null = null;
            let titleInfo: { title?: string; updatedAt?: string } | null = null;
            let firstUserPrompt: string | null = null;

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) continue;
              try {
                const obj = JSON.parse(line) as {
                  type?: string;
                  id?: string;
                  cwd?: string;
                  timestamp?: string;
                  title?: string;
                  updatedAt?: string;
                  role?: string;
                  content?: string | { text?: string }[];
                };
                if (obj.type === "session") sessionInfo = obj;
                if (obj.type === "title" && obj.title) titleInfo = obj;
                if (
                  !firstUserPrompt &&
                  obj.type === "message" &&
                  obj.role === "user" &&
                  obj.content
                ) {
                  firstUserPrompt =
                    typeof obj.content === "string"
                      ? obj.content
                      : obj.content[0]?.text ?? null;
                }
              } catch {}
              if (sessionInfo && titleInfo) break;
            }

            if (sessionInfo?.id && sessionInfo.cwd) {
              const normCwd = normalizeDirPath(sessionInfo.cwd).toLowerCase();
              if (!normTarget || normCwd === normTarget) {
                const title =
                  titlesMap.get(sessionInfo.id) ||
                  titleInfo?.title ||
                  sessionInfo.title ||
                  firstUserPrompt ||
                  "Untitled Session";

                results.push({
                  id: sessionInfo.id,
                  title: title.trim(),
                  cwd: sessionInfo.cwd,
                  updatedAt: titleInfo?.updatedAt || sessionInfo.timestamp || stat.mtime.toISOString(),
                  mtime: stat.mtimeMs,
                });
              }
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}

  return results.sort((a, b) => b.mtime - a.mtime).slice(0, 100);
}

/** Preview-scan byte budget when locating which session file holds `sessionId`. */
const SESSION_ID_PREVIEW_BYTES = 65536;

/**
 * Load every user-typed turn from a specific session's on-disk JSONL
 * transcript, oldest first — used to backfill the activity tab's history
 * after `/resume` loads a chat that predates this window.
 */
export function loadSessionMessages(sessionId: string): SessionMessage[] {
  const sessionsDir = join(OMP_DIR, "agent", "sessions");
  if (!existsSync(sessionsDir)) return [];

  let matchedPath: string | null = null;
  try {
    outer: for (const sub of readdirSync(sessionsDir)) {
      const subPath = join(sessionsDir, sub);
      try {
        if (!statSync(subPath).isDirectory()) continue;
        for (const file of readdirSync(subPath).filter((f) => f.endsWith(".jsonl"))) {
          const filePath = join(subPath, file);
          try {
            const fd = openSync(filePath, "r");
            const buf = Buffer.alloc(SESSION_ID_PREVIEW_BYTES);
            const bytesRead = readSync(fd, buf, 0, SESSION_ID_PREVIEW_BYTES, 0);
            closeSync(fd);
            const preview = buf.toString("utf8", 0, bytesRead);
            for (const rawLine of preview.split("\n")) {
              const line = rawLine.trim();
              if (!line) continue;
              try {
                const obj = JSON.parse(line) as { type?: string; id?: string };
                if (obj.type === "session" && obj.id === sessionId) {
                  matchedPath = filePath;
                  break outer;
                }
              } catch {}
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}

  if (!matchedPath) return [];

  const messages: SessionMessage[] = [];
  try {
    const text = readFileSync(matchedPath, "utf8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      let obj: {
        type?: string;
        timestamp?: string;
        message?: {
          role?: string;
          attribution?: string;
          content?: string | { type?: string; text?: string }[];
        };
      };
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = obj.message;
      if (obj.type !== "message" || msg?.role !== "user" || msg.attribution !== "user" || !msg.content) continue;
      const text2 =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((part) => part.type === "text" && part.text)
              .map((part) => part.text)
              .join("");
      const trimmed = text2.trim();
      if (!trimmed) continue;
      const at = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now();
      messages.push({ text: trimmed, at: Number.isNaN(at) ? Date.now() : at });
    }
  } catch {}

  return messages;
}
