import { expect, test } from "bun:test";
import type { UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";
import { evaluateUsage, registerUsageGuard, type UsagePause, type UsageTarget } from "../extensions/lib/usage-guard";

const nowMs = 1_800_000_000_000;
const provider = "openai-codex";
const a = "account-fixture-a";
const b = "account-fixture-b";
const email = "fixture-a@example.test";
const active: UsageTarget = { provider, modelId: "gpt-codex", identity: { accountId: a, email } };

function window(amount: UsageLimit["amount"], overrides: Partial<UsageLimit> = {}): UsageLimit {
  return { id: `${provider}:secondary`, label: "Weekly", scope: { provider }, amount, ...overrides };
}

function report(limits: UsageLimit[], overrides: Partial<UsageReport> = {}): UsageReport {
  return { provider, fetchedAt: nowMs, limits, metadata: { account_id: ` ${a.toUpperCase()} `, email }, ...overrides };
}

const assess = (reports: UsageReport[], target = active) => evaluateUsage(reports, target, nowMs);
const remaining = (remainingFraction: number): UsageLimit["amount"] => ({ unit: "percent", remainingFraction });

test("uses the lowest applicable window at full precision", () => {
  const short = window(remaining(0.85), { id: `${provider}:primary`, label: "5 hours" });
  const unknown = window({ unit: "percent" });
  expect(assess([report([short, unknown, window(remaining(0.10))])]).status).toBe("low");
  expect(assess([report([short, window(remaining(0.1001))])]).status).toBe("ok");
  expect(assess([report([window({ unit: "percent", usedFraction: 0.90 })])]).status).toBe("low");
});

test("attributes reports and windows to the active model and account only", () => {
  const other = report([window(remaining(0))], { metadata: { accountId: b, email } });
  const otherModel = window(remaining(0), { scope: { provider, modelId: "gpt-unrelated" } });
  const scopeConflict = window(remaining(0), { scope: { provider, accountId: b } });
  const result = assess([other, report([otherModel, scopeConflict, window(remaining(0.75))])]);
  expect(result.status).toBe("ok");
  expect(result.windows.map(row => row.remainingPercent)).toEqual([75]);
  expect(assess([other]).status).toBe("unknown");
  expect(assess([report([window(remaining(0), { scope: { provider, accountId: a } })], { metadata: {} })]).status).toBe("low");
  const byProject = report([window(remaining(0), { scope: { provider, projectId: " proj ", orgId: "tenant" } })], { metadata: {} });
  expect(assess([byProject], { ...active, identity: { projectId: "PROJ", orgId: "tenant" } }).status).toBe("low");
  expect(assess([byProject], { ...active, identity: { projectId: "proj", orgId: "other" } }).status).toBe("unknown");
  expect(assess([byProject], { ...active, identity: { orgId: "tenant" } }).status).toBe("unknown");
});

test("rejects stale, future, expired, unquantified and unverified samples", () => {
  const empty = report([window({ unit: "percent" })]);
  const low = report([window(remaining(0))]);
  const expired = report([window(remaining(0), { window: { id: "weekly", label: "Weekly", resetsAt: nowMs } })]);
  const anonymous = { ...low, metadata: undefined };
  for (const sample of [empty, { ...low, fetchedAt: nowMs - 120_001 }, { ...low, fetchedAt: nowMs + 1 }, expired, anonymous]) {
    expect(assess([sample]).status).toBe("unknown");
  }
  expect(assess([{ ...low, fetchedAt: nowMs - 120_000 }]).status).toBe("low");
  expect(assess([anonymous]).windows[0]?.attribution).toBe("unverified");
  expect(assess([low], { ...active, credentialOrigin: "runtime" }).status).toBe("unknown");
});

test("quantifies normalized amounts without treating balances or reset credits as headroom", () => {
  for (const amount of [
    { unit: "requests", used: 90, limit: 100 },
    { unit: "percent", remaining: 10 },
    { unit: "credits", remaining: 0 },
    { unit: "requests", remainingFraction: 0.05, usedFraction: 0.20 },
  ] satisfies UsageLimit["amount"][]) {
    expect(assess([report([window(amount)])]).status).toBe("low");
  }
  const balance = window({ unit: "usd", remaining: 2, remainingFraction: -1 });
  expect(assess([report([balance])]).status).toBe("unknown");
  expect(assess([report([balance])]).windows[0]?.amount).toMatchObject({ unit: "usd", remaining: 2 });
  expect(assess([report([window({ unit: "percent", used: 90, limit: 0 })])]).status).toBe("unknown");
  const exhausted = window(remaining(0.8), { status: "exhausted" });
  const result = assess([report([exhausted, balance], { resetCredits: { availableCount: 2 } })]);
  expect(result.status).toBe("low");
  expect(result.windows[0]?.remainingPercent).toBe(0);
  expect(result.savedResetCredits).toBe(2);
  expect(assess([report([balance], { metadata: {}, resetCredits: { availableCount: 2 } })]).savedResetCredits).toBeUndefined();
});

test("only exports allowlisted display fields", () => {
  const result = assess([report([window(remaining(0), {
    label: "Weekly\u001b[31m\nquota" + "x".repeat(130),
    scope: { provider, accountId: a },
    notes: ["limit private note"],
  })], { raw: { secret: "raw provider data" }, notes: ["report private note"] })]);
  expect(result.windows[0]?.label).toBe("Weekly quota" + "x".repeat(108));
  const json = JSON.stringify(result);
  for (const secret of [email, a, a.toUpperCase(), b, "raw", "private note"]) expect(json).not.toContain(secret);
});

test("separates Codex base and Spark windows and requires a model match for extras", () => {
  const spark = { ...active, modelId: "gpt-codex-SPARK" };
  const base = window(remaining(0.75), { scope: { provider, tier: "plus" } });
  const sparkWindow = window(remaining(0), { id: `${provider}:spark:primary`, scope: { provider, tier: "spark" } });
  const extra = window(remaining(0), { id: `${provider}:extra:primary` });
  const data = report([base, sparkWindow, extra], { metadata: { accountId: a, planType: " PLUS " } });
  expect(assess([data]).status).toBe("ok");
  expect(assess([data], spark).status).toBe("low");
  expect(assess([data], { ...active, modelId: "gpt-codex-sparkle" }).status).toBe("ok");
  expect(assess([report([base])]).status).toBe("unknown");
  expect(assess([report([{ ...extra, scope: { provider, modelId: "GPT-CODEX", tier: "not-the-plan" } }])]).status).toBe("low");
});

const claude: UsageTarget = {
  provider: "anthropic",
  modelId: "claude-sonnet",
  credentialOrigin: "oauth",
  identity: { accountId: a },
  accounts: [{ accountId: a }, { accountId: b }],
};

function claudeReport(accountId: string, fraction: number, id = "anthropic:7d", fetchedAt = nowMs): UsageReport {
  return {
    provider: "anthropic", fetchedAt, metadata: { accountId },
    limits: [window(remaining(fraction), { id, scope: { provider: "anthropic" } })],
  };
}

test("two Claude accounts pause below 5% combined, not when just the active account runs out", () => {
  const drained = claudeReport(a, 0);
  const healthy = assess([drained, claudeReport(b, 0.80)], claude);
  expect(healthy.status).toBe("ok");
  expect(healthy.pool?.windows[0]?.remainingPercent).toBe(40);
  expect(assess([drained, claudeReport(b, 0.10)], claude).status).toBe("ok");
  const low = assess([drained, claudeReport(b, 0.08)], claude);
  expect(low.status).toBe("low");
  expect(low.pool?.windows[0]?.remainingPercent).toBe(4);
  expect(JSON.stringify(low)).not.toContain(b);

  const single = { ...claude, accounts: [{ accountId: a }] };
  expect(assess([claudeReport(a, 0.10), claudeReport(b, 0.80)], single).status).toBe("low");
  expect(assess([claudeReport(a, 0.1001)], single).status).toBe("ok");
});

test("does not pool duplicate, stale, anonymous, unsigned or different windows as another account", () => {
  const drained = claudeReport(a, 0);
  const anonymous = { ...claudeReport(b, 0), metadata: undefined };
  const samples = [
    drained, claudeReport(a, 0), claudeReport("unlisted", 0), anonymous,
    claudeReport(b, 0, "anthropic:7d", nowMs - 120_001),
    claudeReport(b, 0, "anthropic:5h"),
  ];
  const result = assess(samples, claude);
  expect(result.status).toBe("unknown");
  expect(result.pool?.windows.map(row => [row.remainingPercent, row.observedAccounts])).toEqual([[null, 1], [null, 1]]);

  const ambiguous = { ...claude, accounts: [{ email, orgId: "one" }, { email, orgId: "two" }] };
  expect(assess([{ ...drained, metadata: { email } }], ambiguous).status).toBe("unknown");
  expect(assess([drained, claudeReport(b, 0)], { ...claude, credentialOrigin: "runtime" }).status).toBe("unknown");
});

test("evaluates the lowest complete pool window without pooling saved reset credits", () => {
  const reports = [
    { ...claudeReport(a, 0.06), resetCredits: { availableCount: 2 } },
    { ...claudeReport(b, 0.02), resetCredits: { availableCount: 5 } },
    claudeReport(a, 0.85, "anthropic:5h"),
    claudeReport(b, 0.85, "anthropic:5h"),
  ];
  const result = assess(reports, claude);
  expect(result.status).toBe("low");
  expect(result.savedResetCredits).toBe(2);
  expect(result.pool?.windows.map(row => row.remainingPercent)).toEqual([4, 85]);
});

test("blocks dispatch, restores the pause, and only bypasses the guard for one forced continuation", async () => {
  type GuardApi = Parameters<typeof registerUsageGuard>[0];
  type GuardContext = Parameters<NonNullable<Parameters<typeof registerUsageGuard>[1]>>[0];
  type Block = { block: boolean; reason: string };
  type Handler<T> = (value: T, ctx: GuardContext) => unknown;
  const branch: { type: "custom"; customType: string; data: unknown }[] = [];
  const warnings: string[] = [];
  const stops: string[] = [];
  const continuations: { text: string; attribution: string; blocked: boolean }[] = [];
  let currentPause: UsagePause | null = null;
  let quota = 0.08;
  let fetches = 0;
  let busy = false;

  const ctx = {
    mode: "tui", hasUI: true, agent: { kind: "main" }, model: { provider, id: active.modelId },
    sessionManager: { getSessionId: () => "fixture-session", getBranch: () => branch },
    modelRegistry: { authStorage: {
      oauth: { accounts: () => [{ accountId: a, credentialId: 1 }], identity: () => ({ accountId: a }) },
      usage: { reports: async () => {
        fetches++;
        return [report([window(remaining(quota))], { fetchedAt: Date.now() })];
      } },
    } },
    isIdle: () => !busy,
    abort: () => { stops.push("abort"); busy = false; },
    ui: { setStatus() {}, notify: (message: string) => warnings.push(message) },
  } as unknown as GuardContext;

  function register() {
    const hooks = new Map<string, Handler<unknown>>();
    const commands = new Map<string, Handler<string>>();
    const fire = async (name: string, args?: unknown) => hooks.get(name)?.(args, ctx);
    const call = async (toolName: string) => await fire("tool_call", { toolName }) as Block | undefined;
    const pi = {
      zod: { object() {}, enum: () => ({ default() {} }), string: () => ({ max: () => ({ optional() {} }) }) },
      registerTool() {},
      on: (name: string, handler: Handler<unknown>) => hooks.set(name, handler),
      registerCommand: (name: string, command: { handler: Handler<string> }) => commands.set(name, command.handler),
      appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
      async sendUserMessage(text: string, { attribution }: { attribution: string }) {
        busy = true;
        await fire("agent_start");
        continuations.push({ text, attribution, blocked: Boolean((await call("bash"))?.block) });
        busy = false;
        await fire("agent_end");
      },
    } as unknown as GuardApi;
    registerUsageGuard(pi, (_ctx, pause) => { currentPause = pause; });
    return { fire, call, resume: async (args = "") => commands.get("usage-resume")?.(args, ctx) };
  }

  let host = register();
  await host.fire("session_start");
  busy = true;
  const [first, second] = await Promise.all([host.call("bash"), host.call("write")]);
  expect(first?.block).toBe(true);
  expect(second?.block).toBe(true);
  expect(fetches).toBe(1);
  expect(stops).toEqual(["abort"]);
  expect(warnings.filter(line => line.startsWith("Paused for low usage"))).toHaveLength(1);
  const saved = currentPause as UsagePause | null;
  expect(saved?.message).toContain("8% remaining");
  expect(await host.call("read")).toBeUndefined();
  expect((await host.call("bash"))?.block).toBe(true);
  expect(fetches).toBe(1);

  host = register();
  await host.fire("session_start");
  expect(currentPause).toEqual(saved);
  expect(warnings).toHaveLength(1);
  await host.resume();
  expect(currentPause).toEqual(saved);
  expect(continuations).toHaveLength(0);

  await host.resume("force");
  expect(currentPause).toBeNull();
  expect(continuations).toEqual([{
    text: expect.stringContaining("Usage checkpoint: Blocked before bash."),
    attribution: "agent",
    blocked: false,
  }]);
  expect(branch.at(-1)?.data).toBeNull();
  busy = true;
  expect((await host.call("bash"))?.block).toBe(true);
  expect(stops).toEqual(["abort", "abort"]);

  quota = 0.75;
  await host.resume();
  expect(currentPause).toBeNull();
  expect(continuations.map(run => run.blocked)).toEqual([false, false]);
});
