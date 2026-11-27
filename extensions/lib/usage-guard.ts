import type { UsageAmount, UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const ENTRY = "dev.ohmypi.pishift.usage-guard";
const STATUS = "pishift-usage-guard";
const POLICY = "Before a substantial implementation phase, rebuild, or delegation, call usage_guard with action=pause_if_low and a short checkpoint. A low result pauses the session; do not retry or work around the pause. Unknown quota is not proof of headroom. Ordinary replies and read-only inspection do not need a preflight.";
const GUARDED = {
  bash: true, eval: true, debug: true, edit: true, write: true, ast_edit: true, task: true,
  hub: true, browser: true, computer: true, rewind: true, memory_edit: true, retain: true,
  learn: true, manage_skill: true,
};
const KNOWN_UNITS: readonly UsageAmount["unit"][] = ["percent", "tokens", "requests", "credits", "usd", "minutes", "bytes"];
const SINGLE_ACCOUNT_RESERVE = 10;
const PERCENT_EPSILON = 1e-7;
const FRESH_MS = 120_000;
const WAIT_MS = 2_000;
const DIMENSIONS = ["accountId", "projectId", "email", "orgId"] as const;
type AccountIdentity = Partial<Record<(typeof DIMENSIONS)[number], string>>;

export type UsageTarget = {
  provider: string;
  modelId: string;
  identity?: AccountIdentity;
  accounts?: readonly AccountIdentity[];
  credentialOrigin?: string;
};

interface AssessedWindow {
  label: string;
  amount: Pick<UsageAmount, "unit" | "used" | "limit" | "remaining">;
  remainingPercent: number | null;
  fetchedAt: number;
  resetsAt: number | null;
  attribution: "matched" | "unverified";
  stale: boolean;
}

interface PooledWindow {
  label: string;
  remainingPercent: number | null;
  observedAccounts: number;
  resetsAt: number | null;
}

export interface UsageAssessment {
  status: "ok" | "low" | "unknown";
  provider: string;
  modelId: string;
  windows: AssessedWindow[];
  pool?: { accountCount: number; thresholdPercent: number; windows: PooledWindow[] };
  savedResetCredits?: number;
}

export interface UsagePause {
  id: string;
  message: string;
}

type SavedPause = UsagePause & { checkpoint: string };

type UsageLookup = (options: {
  provider?: string;
  baseUrlResolver: (provider: UsageReport["provider"]) => string | undefined;
  signal: AbortSignal;
}) => Promise<UsageReport[] | null>;

type ListedAccount = AccountIdentity & { credentialId: number };

// Native OMP auth moved from flat methods to namespaces. Neither path reads credentials.
interface NativeAuth {
  fetchUsageReports?: UsageLookup;
  getCredentialOrigin?(provider: string): { kind: string } | undefined;
  getOAuthAccountIdentity?(provider: string, sessionId: string): UsageTarget["identity"];
  listOAuthAccounts?(provider: string): ListedAccount[];
  usage?: { reports?: UsageLookup };
  keys?: { source?(provider: string): { kind: string } | undefined };
  oauth?: {
    identity?(provider: string, sessionId: string): AccountIdentity | undefined;
    accounts?(provider: string, sessionId: string): ListedAccount[];
  };
  sessions?: { permits?(provider: string, sessionId: string, credentialId: number): boolean };
}

function label(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").trim().slice(0, 120);
}

function key(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase() || undefined : undefined;
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function epoch(value: unknown): value is number {
  return nonnegative(value) && value <= 8.64e15;
}

function fraction(value: unknown): value is number {
  return nonnegative(value) && value <= 1;
}

function remainingFraction(limit: UsageLimit): number | null {
  if (limit.status === "exhausted") return 0;
  const a = limit.amount;
  if (fraction(a.remainingFraction)) return a.remainingFraction;
  if (fraction(a.usedFraction)) return 1 - a.usedFraction;
  const denominator = nonnegative(a.limit) && a.limit > 0 ? a.limit
    : a.limit === undefined && a.unit === "percent" ? 100 : undefined;
  if (denominator !== undefined) {
    if (nonnegative(a.remaining) && a.remaining <= denominator) return a.remaining / denominator;
    if (nonnegative(a.used)) return Math.max(0, 1 - a.used / denominator);
  }
  return a.remaining === 0 && KNOWN_UNITS.includes(a.unit) ? 0 : null;
}

function attribution(report: UsageReport, identity: UsageTarget["identity"], scope?: UsageLimit["scope"]) {
  if (!identity) return "unverified";
  const meta = report.metadata;
  let positive = false;
  for (const dimension of DIMENSIONS) {
    const expected = key(identity[dimension]);
    if (!expected) continue;
    const reported = [meta?.[dimension], dimension === "accountId" ? meta?.account_id : undefined,
      dimension !== "email" ? scope?.[dimension] : undefined];
    for (const value of reported) {
      const actual = key(value);
      if (!actual) continue;
      if (actual !== expected) return "other";
      if (dimension !== "orgId") positive = true;
    }
  }
  return positive ? "matched" : "unverified";
}

function applies(report: UsageReport, limit: UsageLimit, target: UsageTarget): boolean {
  if (limit.scope.provider !== target.provider) return false;
  const model = key(target.modelId);
  const scopedModel = key(limit.scope.modelId);
  if (scopedModel && scopedModel !== model) return false;
  if (target.provider === "openai-codex") {
    const spark = model?.split("-").includes("spark");
    if (/^openai-codex:(?:primary|secondary)$/.test(limit.id)) {
      if (spark) return false;
    } else if (/^openai-codex:spark:(?:primary|secondary)$/.test(limit.id)) {
      return spark === true;
    } else {
      return scopedModel !== undefined;
    }
  }
  const tier = key(limit.scope.tier);
  const plan = key(report.metadata?.planType) ?? key(report.metadata?.subscriptionPlan);
  return !!scopedModel || !tier || tier === plan;
}

type WindowSample = { remaining: number | null; fetchedAt: number; resetsAt: number | null; stale: boolean };
type WindowBucket = { label: string; samples: Map<number, WindowSample> };

function summarizePool(accountCount: number, buckets: Map<string, WindowBucket>): NonNullable<UsageAssessment["pool"]> {
  const windows: PooledWindow[] = [];
  for (const bucket of buckets.values()) {
    let observedAccounts = 0;
    let totalRemaining = 0;
    let nextReset = Infinity;
    let knownResets = 0;
    for (const sample of bucket.samples.values()) {
      if (sample.stale || sample.remaining === null) continue;
      observedAccounts++;
      totalRemaining += sample.remaining;
      if (sample.resetsAt !== null) {
        knownResets++;
        nextReset = Math.min(nextReset, sample.resetsAt);
      }
    }
    windows.push({
      label: bucket.label,
      remainingPercent: observedAccounts === accountCount ? totalRemaining * 100 / accountCount : null,
      observedAccounts,
      resetsAt: knownResets === accountCount ? nextReset : null,
    });
  }
  return { accountCount, thresholdPercent: SINGLE_ACCOUNT_RESERVE / accountCount, windows };
}

export function evaluateUsage(reports: readonly UsageReport[], target: UsageTarget, nowMs: number): UsageAssessment {
  const result: UsageAssessment = { status: "unknown", provider: label(target.provider), modelId: label(target.modelId), windows: [] };
  const oauth = !target.credentialOrigin || target.credentialOrigin === "oauth";
  const accounts = oauth ? target.accounts : undefined;
  const identity = oauth ? (accounts?.length === 1 ? accounts[0] : accounts?.length === 0 ? undefined : target.identity) : undefined;
  const pooled = accounts && accounts.length > 1 ? accounts : undefined;
  const buckets = new Map<string, WindowBucket>();
  for (const report of reports) {
    if (report.provider !== target.provider || !epoch(report.fetchedAt)) continue;
    const fresh = report.fetchedAt <= nowMs && report.fetchedAt >= nowMs - FRESH_MS;
    const reportAttribution = attribution(report, identity);
    if (reportAttribution === "other" && !pooled) continue;
    let matchedScope = false;
    let conflictingScope = false;
    const resetCredits = report.resetCredits?.availableCount;
    // Reset credits are account-wide, independent of model applicability.
    for (const limit of report.limits) {
      if (limit.scope.provider !== target.provider) continue;
      const owner = attribution(report, identity, limit.scope);
      matchedScope ||= owner === "matched";
      conflictingScope ||= owner === "other";
      if (!applies(report, limit, target)) continue;
      const reset = limit.window?.resetsAt;
      const resetsAt = epoch(reset) ? reset : null;
      const stale = !fresh || (reset !== undefined && (resetsAt === null || resetsAt <= nowMs));
      const remaining = remainingFraction(limit);
      const windowLabel = label(limit.label) || "Usage window";
      if (pooled && report.fetchedAt <= nowMs) {
        let accountIndex = -1;
        for (let i = 0; i < pooled.length; i++) {
          if (attribution(report, pooled[i], limit.scope) !== "matched") continue;
          if (accountIndex !== -1) {
            accountIndex = -1; // Never count an ambiguous report toward either account.
            break;
          }
          accountIndex = i;
        }
        if (accountIndex !== -1) {
          // IDs distinguish model/family limits that share a label or reset period.
          const bucketId = JSON.stringify([limit.id, limit.window?.id ?? limit.scope.windowId, limit.amount.unit]);
          let bucket = buckets.get(bucketId);
          if (!bucket) buckets.set(bucketId, bucket = { label: windowLabel, samples: new Map() });
          const prior = bucket.samples.get(accountIndex);
          if (!prior || prior.fetchedAt < report.fetchedAt || (prior.fetchedAt === report.fetchedAt
            && !stale && remaining !== null && (prior.stale || prior.remaining === null || remaining < prior.remaining))) {
            bucket.samples.set(accountIndex, { remaining, fetchedAt: report.fetchedAt, resetsAt, stale });
          }
        }
      }
      if (owner === "other") continue;
      const a = limit.amount;
      result.windows.push({
        label: windowLabel,
        amount: {
          unit: KNOWN_UNITS.includes(a.unit) ? a.unit : "unknown",
          used: nonnegative(a.used) ? a.used : undefined,
          limit: nonnegative(a.limit) ? a.limit : undefined,
          remaining: nonnegative(a.remaining) ? a.remaining : undefined,
        },
        remainingPercent: remaining === null ? null : remaining * 100,
        fetchedAt: report.fetchedAt,
        resetsAt,
        attribution: owner,
        stale,
      });
      if (!pooled && owner === "matched" && !stale && remaining !== null) {
        if (remaining * 100 <= SINGLE_ACCOUNT_RESERVE + PERCENT_EPSILON) result.status = "low";
        else if (result.status === "unknown") result.status = "ok";
      }
    }
    if (fresh && nonnegative(resetCredits) && Number.isInteger(resetCredits)
      && (reportAttribution === "matched" || matchedScope) && !conflictingScope) {
      result.savedResetCredits = Math.min(result.savedResetCredits ?? resetCredits, resetCredits);
    }
  }
  if (pooled) {
    const pool = summarizePool(pooled.length, buckets);
    result.pool = pool;
    if (pool.windows.some(row => row.remainingPercent !== null && row.remainingPercent < pool.thresholdPercent - PERCENT_EPSILON)) {
      result.status = "low";
    } else if (pool.windows.some(row => row.remainingPercent !== null)
      && !pool.windows.some(row => row.observedAccounts > 0 && row.remainingPercent === null)) {
      result.status = "ok";
    }
  }
  return result;
}

function isMainTui(ctx: ExtensionContext): boolean {
  return ctx.mode === "tui" && ctx.hasUI && ctx.agent?.kind !== "sub";
}

function readTarget(ctx: ExtensionContext) {
  const registry = ctx.modelRegistry;
  const auth: NativeAuth | undefined = registry?.authStorage;
  const model = ctx.model;
  const provider = model?.provider ?? "";
  const modelId = model?.id ?? "";
  const session = ctx.sessionManager?.getSessionId?.();
  let credentialOrigin: string | undefined;
  let identity: UsageTarget["identity"];
  let accounts: AccountIdentity[] | undefined;
  let accountSignature: string[] | undefined;
  if (model && session) {
    try {
      credentialOrigin = (auth?.keys?.source?.(provider) ?? auth?.getCredentialOrigin?.(provider))?.kind;
      if (!credentialOrigin || credentialOrigin === "oauth") {
        identity = auth?.oauth?.identity?.(provider, session) ?? auth?.getOAuthAccountIdentity?.(provider, session);
        const listed = auth?.oauth?.accounts?.(provider, session) ?? auth?.listOAuthAccounts?.(provider);
        if (listed) {
          const distinct = new Map<string, AccountIdentity>();
          for (const account of listed) {
            if (auth?.sessions?.permits?.(provider, session, account.credentialId) === false) continue;
            const values = DIMENSIONS.map(dimension => key(account[dimension]));
            const fingerprint = JSON.stringify(values.some(Boolean) ? values : [account.credentialId]);
            distinct.set(fingerprint, account);
          }
          accountSignature = [...distinct.keys()].sort();
          accounts = accountSignature.map(id => distinct.get(id)!);
        }
      }
    } catch {
      // Unknown attribution must never create a pause.
      accounts = [];
      accountSignature = [];
    }
  }
  const target: UsageTarget = { provider, modelId, credentialOrigin, identity, accounts };
  return { registry, auth, target, signature: JSON.stringify([session, provider, modelId, credentialOrigin,
    ...DIMENSIONS.map(d => key(identity?.[d])), accountSignature]) };
}

interface PendingUsage {
  signature: string;
  branch: number;
  waiters: Set<(reports: readonly UsageReport[]) => void>;
}

async function waitForReports(request: PendingUsage, signal: AbortSignal): Promise<readonly UsageReport[]> {
  if (signal.aborted) return [];
  const { promise, resolve } = Promise.withResolvers<readonly UsageReport[]>();
  const abort = () => resolve([]);
  request.waiters.add(resolve);
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await promise;
  } finally {
    signal.removeEventListener("abort", abort);
    request.waiters.delete(resolve);
  }
}

function percentage(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function pauseMessage(assessment: UsageAssessment): string {
  const pool = assessment.pool;
  const windows = pool?.windows ?? assessment.windows.filter(row => row.attribution === "matched" && !row.stale);
  const worst = windows.reduce<(typeof windows)[number] | undefined>((best, row) =>
    row.remainingPercent !== null && (!best || row.remainingPercent < best.remainingPercent!) ? row : best, undefined)!;
  const reset = worst.resetsAt === null ? "" : ` ${pool ? "Next reported reset" : "Resets"} ${new Date(worst.resetsAt).toISOString()}.`;
  const percent = worst.remainingPercent!;
  const formatted = pool && Number(percentage(percent)) >= pool.thresholdPercent
    ? `<${percentage(pool.thresholdPercent)}`
    : percentage(Math.min(pool?.thresholdPercent ?? SINGLE_ACCOUNT_RESERVE, percent));
  const combined = pool ? ` across ${pool.accountCount} accounts` : "";
  return `Paused for low usage: ${assessment.provider} · ${worst.label}: ${formatted}% remaining${combined}.${reset} Use /usage-resume after quota recovers or after switching models/accounts.`;
}

function describeWindow(row: AssessedWindow): string {
  const { remaining, used, limit, unit } = row.amount;
  const amounts = [remaining === undefined ? "" : `${remaining} ${unit} remaining`,
    used === undefined ? "" : `${used} ${unit} used`, limit === undefined ? "" : `${limit} ${unit} limit`].filter(Boolean);
  return `${row.label}: ${[
    row.remainingPercent === null ? "percentage unknown" : `${percentage(row.remainingPercent)}% remaining`,
    ...amounts,
    row.stale ? "stale" : "",
    row.attribution === "unverified" ? "unverified account" : "",
    row.resetsAt === null ? "" : `Resets ${new Date(row.resetsAt).toISOString()}`,
  ].filter(Boolean).join(" · ")}`;
}

function validPause(value: unknown): value is SavedPause {
  if (!value || typeof value !== "object") return false;
  const { id, message, checkpoint } = value as Partial<SavedPause>;
  return typeof id === "string" && /^[\w-]{1,120}$/.test(id)
    && typeof message === "string" && !!message.trim() && message.length <= 500 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(message)
    && typeof checkpoint === "string" && checkpoint.length <= 500;
}

export function registerUsageGuard(pi: ExtensionAPI, publishPause?: (ctx: ExtensionContext, pause: UsagePause | null) => void): void {
  let pause: SavedPause | null = null;
  let generation = 0;
  let resume: { force: boolean; admitted: boolean } | null = null;
  type Registry = ExtensionContext["modelRegistry"];
  const pending = new WeakMap<Registry, Map<string, PendingUsage>>();

  async function assess(ctx: ExtensionContext, caller?: AbortSignal): Promise<UsageAssessment | null> {
    const branch = generation;
    const before = readTarget(ctx);
    const { registry, target, auth } = before;
    const timeout = AbortSignal.timeout(WAIT_MS);
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
    let reports: readonly UsageReport[] = [];
    if (!signal.aborted && registry && auth && target.provider && target.modelId
      && (auth.usage?.reports || auth.fetchUsageReports)) {
      let requests = pending.get(registry);
      if (!requests) pending.set(registry, requests = new Map());
      const id = JSON.stringify([target.provider, target.modelId]);
      let request = requests.get(id);
      if (!request) {
        const active = requests;
        const next: PendingUsage = { branch, signature: before.signature, waiters: new Set() };
        request = next;
        active.set(id, next);
        const options = { baseUrlResolver: (provider: UsageReport["provider"]) => registry.getProviderBaseUrl?.(provider), signal: timeout };
        const settle = (value: readonly UsageReport[] | null) => {
          active.delete(id);
          for (const waiter of next.waiters) waiter(value ?? []);
          next.waiters.clear();
        };
        void Promise.resolve().then(() => auth.usage?.reports
          ? auth.usage.reports({ ...options, provider: target.provider })
          : auth.fetchUsageReports!(options)).then(settle, () => settle(null));
      }
      if (request.branch === branch && request.signature === before.signature) reports = await waitForReports(request, signal);
    }
    const after = readTarget(ctx);
    if (caller?.aborted || generation !== branch || registry !== after.registry || before.signature !== after.signature) return null;
    return evaluateUsage(signal.aborted ? [] : reports, target, Date.now());
  }

  function publish(ctx: ExtensionContext): void {
    try { ctx.ui.setStatus(STATUS, pause ? "Paused for low usage · /usage-resume" : undefined); } catch {}
    try { publishPause?.(ctx, pause ? { id: pause.id, message: pause.message } : null); } catch {}
  }

  function persist(ctx: ExtensionContext): void {
    try { pi.appendEntry(ENTRY, pause); }
    catch {
      try { ctx.ui.notify("Could not save the usage guard checkpoint to this session.", "warning"); } catch {}
    }
  }

  function restore(ctx: ExtensionContext): void {
    generation++;
    resume = null;
    pause = null;
    if (!isMainTui(ctx)) return;
    const branch = ctx.sessionManager?.getBranch?.() ?? [];
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
      if (entry.data === null) break;
      if (validPause(entry.data)) {
        pause = entry.data;
        break;
      }
    }
    publish(ctx);
  }

  function bypassed(): boolean {
    return !!(resume?.force && resume.admitted);
  }

  function latch(ctx: ExtensionContext, assessment: UsageAssessment, checkpoint: string): void {
    if (pause || bypassed() || assessment.status !== "low") return;
    const message = pauseMessage(assessment);
    pause = { id: crypto.randomUUID(), message, checkpoint };
    persist(ctx);
    publish(ctx);
    try { ctx.ui.notify(message, "warning"); } catch {}
    try { ctx.abort(); } catch {}
  }

  async function gate(ctx: ExtensionContext, tool: string, signal?: AbortSignal) {
    if (!isMainTui(ctx) || bypassed()) return;
    if (signal?.aborted) return { block: true, reason: "Usage guard check interrupted before dispatch." };
    const branch = generation;
    const session = ctx.sessionManager?.getSessionId?.();
    if (!pause) {
      const wasRunning = !ctx.isIdle();
      const assessment = await assess(ctx, signal);
      if (generation !== branch || ctx.sessionManager?.getSessionId?.() !== session || signal?.aborted
        || (wasRunning && ctx.isIdle())) {
        return { block: true, reason: "Usage guard check interrupted before dispatch." };
      }
      if (assessment && !pause) latch(ctx, assessment, `Blocked before ${tool}. Inspect completed actions and continue the unfinished user request.`);
    }
    if (pause) return { block: true, reason: pause.message };
  }

  pi.registerTool({
    name: "usage_guard",
    label: "Usage guard",
    description: `Check native provider quota or pause substantial work on a low result. ${POLICY} When bypassed is true, the user authorized this run with /usage-resume force; low quota is informational for this run.`,
    approval: "read",
    loadMode: "essential",
    parameters: pi.zod.object({
      action: pi.zod.enum(["check", "pause_if_low"]).default("check"),
      checkpoint: pi.zod.string().max(500).optional(),
    }),
    async execute(_id, { action, checkpoint }, signal, _onUpdate, ctx) {
      const interactive = isMainTui(ctx);
      const branch = generation;
      const wasRunning = interactive && !ctx.isIdle();
      const forced = interactive && bypassed();
      const assessment = interactive ? await assess(ctx, signal) : null;
      if (assessment && !forced && action === "pause_if_low" && generation === branch && !signal?.aborted
        && (!wasRunning || !ctx.isIdle())) {
        latch(ctx, assessment, checkpoint?.trim() || "Blocked before usage_guard. Inspect completed actions and continue the unfinished user request.");
      }
      const result = { ...(assessment ?? evaluateUsage([], {
        provider: ctx.model?.provider ?? "", modelId: ctx.model?.id ?? "",
      }, Date.now())), paused: interactive && pause !== null, bypassed: forced };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });

  const restoreBranch = (_event: unknown, ctx: ExtensionContext) => restore(ctx);
  pi.on("session_start", restoreBranch);
  pi.on("session_switch", restoreBranch);
  pi.on("session_branch", restoreBranch);
  pi.on("session_tree", restoreBranch);
  pi.on("session_clear", restoreBranch);
  pi.on("before_agent_start", (event, ctx) => {
    if (isMainTui(ctx) && event.reason !== "revive" && Array.isArray(event.systemPrompt) && !event.systemPrompt.includes(POLICY)) {
      return { systemPrompt: [...event.systemPrompt, POLICY] };
    }
  });
  pi.on("tool_call", (event, ctx) => {
    if (Object.hasOwn(GUARDED, event.toolName)) return gate(ctx, event.toolName, "signal" in event ? event.signal as AbortSignal : undefined);
  });
  pi.on("before_subagent_spawn", (event, ctx) => gate(ctx, event.invocationKind, "signal" in event ? event.signal as AbortSignal : undefined));
  pi.on("agent_start", (_event, ctx) => {
    if (isMainTui(ctx) && resume) resume.admitted = true;
  });
  pi.on("agent_end", (_event, ctx) => {
    if (isMainTui(ctx) && resume?.admitted) resume = null;
  });

  pi.registerCommand("usage-guard", {
    description: "Show the current provider quota and usage pause status",
    async handler(args, ctx) {
      if (!isMainTui(ctx)) return;
      if (args.trim()) return ctx.ui.notify("Usage: /usage-guard", "warning");
      const assessment = await assess(ctx);
      if (!assessment) return ctx.ui.notify("Usage check interrupted. Try /usage-guard again.", "warning");
      const { provider, modelId, status, windows, savedResetCredits, pool } = assessment;
      const lines = [`${[provider, modelId].filter(Boolean).join("/") || "No model"}: quota ${status} · ${pause ? "paused" : "not paused"}`];
      if (pool) {
        lines.push(`${pool.accountCount} accounts combined · pause below ${percentage(pool.thresholdPercent)}%`);
        for (const row of pool.windows) {
          lines.push(`${row.label}: ${row.remainingPercent === null
            ? `combined percentage unknown (${row.observedAccounts}/${pool.accountCount} accounts verified)`
            : `${percentage(row.remainingPercent)}% combined remaining`}`);
        }
      } else {
        lines.push(...windows.map(describeWindow));
      }
      if (savedResetCredits !== undefined) lines.push(`Saved rate-limit resets${pool ? " (active account)" : ""}: ${savedResetCredits}`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("usage-resume", {
    description: "Resume the unfinished request after a usage pause; force bypasses the guard for one run",
    async handler(args, ctx) {
      if (!isMainTui(ctx)) return;
      const force = args.trim() === "force";
      if (args.trim() && !force) return ctx.ui.notify("Usage: /usage-resume [force]", "warning");
      const idle = () => ctx.isIdle() && !ctx.hasPendingMessages?.();
      if (resume || !idle()) return ctx.ui.notify("Wait until the agent is idle before resuming.", "warning");
      const previous = pause;
      if (!previous) return ctx.ui.notify("This session is not paused for low usage.", "info");
      const branch = generation;
      const session = ctx.sessionManager?.getSessionId?.();
      const sameBranch = () => generation === branch && ctx.sessionManager?.getSessionId?.() === session;
      if (!force) {
        const assessment = await assess(ctx);
        if (!sameBranch() || pause !== previous) return;
        if (assessment?.status !== "ok") {
          return ctx.ui.notify("Quota is low or unknown. Wait, switch models/accounts, or use /usage-resume force.", "warning");
        }
        if (!idle()) return ctx.ui.notify("Wait until the agent is idle before resuming.", "warning");
      }
      const run = { force, admitted: false };
      resume = run;
      pause = null;
      persist(ctx);
      publish(ctx);
      try {
        await pi.sendUserMessage(`Resume the unfinished user request in this session. Use the existing transcript and current files; do not repeat completed work. Usage checkpoint: ${previous.checkpoint}`, { attribution: "agent" });
      } catch {
        if (!run.admitted && sameBranch() && resume === run && !pause) {
          pause = previous;
          persist(ctx);
          publish(ctx);
          ctx.ui.notify("The continuation was not admitted. The usage pause is still active.", "warning");
        }
      } finally {
        if (resume === run && !run.admitted) resume = null;
      }
    },
  });
}
