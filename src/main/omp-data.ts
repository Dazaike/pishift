import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type {
  InstalledModelGroup,
  ProviderLimit,
  ProviderUsageReport,
  ProviderUsageStat,
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
