import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";

import * as dgram from "node:dgram";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type Activity = "idle" | "working" | "thinking";

interface BridgeState {
  running: boolean;
  activity: Activity;
  model: string | null;
  thinkingLevel: string;
  plan: boolean;
  pid: number;
  cwd: string | null;
  /** Matches host `OMPHIF_SESSION_ID` so multi-tab chrome can route activity. */
  sessionId: string | null;
  updatedAt: string;
}

const STATUS_FILE = join(
  homedir(),
  ".omp",
  "agent",
  "runtime-status.json",
);

const UDP_HOST = "127.0.0.1";
const UDP_PORT = 37991;

const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  off: (ThinkingLevel?.Off ?? "off") as ThinkingLevel,

  auto: (ThinkingLevel?.Auto ?? "auto") as ThinkingLevel,

  min: (ThinkingLevel?.Minimal ?? "minimal") as ThinkingLevel,
  minimal: (ThinkingLevel?.Minimal ?? "minimal") as ThinkingLevel,

  low: (ThinkingLevel?.Low ?? "low") as ThinkingLevel,

  med: (ThinkingLevel?.Medium ?? "medium") as ThinkingLevel,
  medium: (ThinkingLevel?.Medium ?? "medium") as ThinkingLevel,

  high: (ThinkingLevel?.High ?? "high") as ThinkingLevel,

  xhigh: (ThinkingLevel?.XHigh ?? "xhigh") as ThinkingLevel,
  xhi: (ThinkingLevel?.XHigh ?? "xhigh") as ThinkingLevel,

  max: (ThinkingLevel?.Max ?? "max") as ThinkingLevel,
};

function getEventType(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  if ("assistantMessageEvent" in event) {
    const ame = event.assistantMessageEvent;
    if (ame && typeof ame === "object" && "type" in ame && typeof ame.type === "string") {
      return ame.type;
    }
  }
  if ("type" in event && typeof event.type === "string") {
    return event.type;
  }
  return undefined;
}

export default function controlBridge(pi: ExtensionAPI) {
  let activity: Activity = "idle";
  let running = false;
  let planModeState = false;

  let udp: dgram.Socket | undefined;
  let heartbeatStarted = false;

  function getUdp(): dgram.Socket {
    if (!udp) {
      udp = dgram.createSocket("udp4");
      udp.unref();
    }

    return udp;
  }

  function readPlanMode(ctx: ExtensionContext): boolean {
    if ("getPlanMode" in pi && typeof pi.getPlanMode === "function") {
      const fn = pi.getPlanMode as () => boolean;
      return fn();
    }

    if ("planModeEnabled" in ctx && typeof ctx.planModeEnabled === "boolean") {
      return ctx.planModeEnabled;
    }

    if ("session" in ctx && ctx.session && typeof ctx.session === "object") {
      const session = ctx.session;
      if ("getPlanModeState" in session && typeof session.getPlanModeState === "function") {
        const getter = session.getPlanModeState as () => { enabled?: boolean } | undefined;
        const res = getter();
        if (res && typeof res === "object" && typeof res.enabled === "boolean") {
          return res.enabled;
        }
      }
    }

    return planModeState;
  }

  async function applyPlanMode(
    enable: boolean,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    planModeState = enable;

    // Official hook when present.
    if ("setPlanMode" in pi && typeof pi.setPlanMode === "function") {
      const res = await (
        pi.setPlanMode as (v: boolean) => Promise<boolean> | boolean
      )(enable);
      return typeof res === "boolean" ? res : true;
    }

    // Best-effort session state. Full TUI enable still requires native `/plan`
    // or Alt+Shift+P (handlePlanModeCommand); the desktop host sends that.
    if ("session" in ctx && ctx.session && typeof ctx.session === "object") {
      const session = ctx.session;
      if (
        "setPlanModeState" in session &&
        typeof session.setPlanModeState === "function"
      ) {
        const setter = session.setPlanModeState as (state: unknown) => void;
        if (enable) {
          let planFilePath = "local://PLAN.md";
          if (
            "getPlanReferencePath" in session &&
            typeof session.getPlanReferencePath === "function"
          ) {
            const path = (session.getPlanReferencePath as () => string | undefined)();
            if (path) planFilePath = path;
          }
          setter({
            enabled: true,
            planFilePath,
            workflow: "parallel",
          });
        } else {
          setter(undefined);
        }
      }
    }

    // Queue native command text so a host that only sets the editor can submit.
    if (ctx.hasUI && ctx.ui && "setEditorText" in ctx.ui) {
      const setText = (ctx.ui as { setEditorText?: (t: string) => void }).setEditorText;
      if (typeof setText === "function") setText("/plan");
    }

    return true;
  }

  function makeState(ctx: ExtensionContext): BridgeState {
    const model = ctx.models.current();
    const thinking = pi.getThinkingLevel();
    const plan = readPlanMode(ctx);
    const sessionId =
      process.env.OMPHIF_SESSION_ID ||
      process.env.ITERM_SESSION_ID?.split(":").pop() ||
      null;

    return {
      running,
      activity,
      model: model
        ? `${model.provider}/${model.id}`
        : null,
      thinkingLevel: thinking
        ? String(thinking)
        : "off",
      plan,
      pid: process.pid,
      cwd: ctx.cwd ?? null,
      sessionId,
      updatedAt: new Date().toISOString(),
    };
  }

  function publish(
    ctx: ExtensionContext,
    sendUdp = true,
  ) {
    // Ignore subagents/headless copies of the extension.
    if (!ctx.hasUI) return;

    const state = makeState(ctx);
    const json = JSON.stringify(state);

    mkdirSync(dirname(STATUS_FILE), {
      recursive: true,
    });

    // Pretty JSON makes manual inspection less miserable.
    writeFileSync(
      STATUS_FILE,
      JSON.stringify(state, null, 2),
      "utf8",
    );


    if (sendUdp) {
      try {
        const socket = getUdp();

        socket.send(
          Buffer.from(json),
          UDP_PORT,
          UDP_HOST,
        );
      } catch {
        // UDP telemetry should never break OMP.
      }
    }
  }

  function setActivity(
    ctx: ExtensionContext,
    next: Activity,
  ) {
    if (!ctx.hasUI) return;

    // Don't hammer the filesystem for every streamed token.
    if (activity === next) return;

    activity = next;
    publish(ctx);
  }

  function showCurrent(ctx: ExtensionContext) {
    publish(ctx);
  }

  function setThinking(
    level: ThinkingLevel,
    ctx: ExtensionContext,
  ) {
    // false = session-only, don't rewrite your global default.
    pi.setThinkingLevel(level, false);

    publish(ctx);
  }

  // --------------------------------------------------
  // /m command
  // --------------------------------------------------

  pi.registerCommand("m", {
    description:
      "Show/set model, thinking level, and plan mode",

    handler: async (args, ctx) => {
      const rawTokens = args
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      // /m or /m status
      if (rawTokens.length === 0 || (rawTokens.length === 1 && rawTokens[0].toLowerCase() === "status")) {
        showCurrent(ctx);
        return;
      }

      let targetModelSpec: string | undefined;
      let targetThinking: ThinkingLevel | undefined;
      let targetPlan: boolean | undefined;

      let idx = 0;
      while (idx < rawTokens.length) {
        const token = rawTokens[idx];
        const lower = token.toLowerCase();

        if (lower === "status") {
          idx++;
          continue;
        }

        if (lower === "plan") {
          const nextToken = rawTokens[idx + 1]?.toLowerCase();
          if (nextToken === "on" || nextToken === "true" || nextToken === "1") {
            targetPlan = true;
            idx += 2;
          } else if (nextToken === "off" || nextToken === "false" || nextToken === "0") {
            targetPlan = false;
            idx += 2;
          } else {
            // Direct toggle
            const currentPlan = readPlanMode(ctx);
            targetPlan = !currentPlan;
            idx += 1;
          }
          continue;
        }

        if (lower === "plan:on" || lower === "plan=on") {
          targetPlan = true;
          idx++;
          continue;
        }

        if (lower === "plan:off" || lower === "plan=off") {
          targetPlan = false;
          idx++;
          continue;
        }

        const maybeThinking = THINKING_LEVELS[lower];
        if (maybeThinking !== undefined) {
          targetThinking = maybeThinking;
          idx++;
          continue;
        }

        // Otherwise treat as model spec
        targetModelSpec = token;
        idx++;
      }

      // Switch model first so thinking gets clamped against NEW model
      if (targetModelSpec) {
        const model = ctx.models.resolve(targetModelSpec);

        if (!model) {
          ctx.ui.notify(
            `Model not found: ${targetModelSpec}`,
            "error",
          );
          return;
        }

        const success = await pi.setModel(model);

        if (!success) {
          ctx.ui.notify(
            `Could not switch to ${model.provider}/${model.id}. Check authentication.`,
            "error",
          );
          return;
        }
      }

      if (targetThinking !== undefined) {
        pi.setThinkingLevel(targetThinking, false);
      }

      if (targetPlan !== undefined) {
        await applyPlanMode(targetPlan, ctx);
      }

      publish(ctx);
      showCurrent(ctx);
    },
  });

  // --------------------------------------------------
  // Direct thinking keybinds
  // --------------------------------------------------

  const shortcuts = [
    ["alt+0", (ThinkingLevel?.Off ?? "off") as ThinkingLevel],
    ["alt+1", (ThinkingLevel?.Minimal ?? "minimal") as ThinkingLevel],
    ["alt+2", (ThinkingLevel?.Low ?? "low") as ThinkingLevel],
    ["alt+3", (ThinkingLevel?.Medium ?? "medium") as ThinkingLevel],
    ["alt+4", (ThinkingLevel?.High ?? "high") as ThinkingLevel],
    ["alt+5", (ThinkingLevel?.XHigh ?? "xhigh") as ThinkingLevel],
    ["alt+6", (ThinkingLevel?.Max ?? "max") as ThinkingLevel],
  ] as const;

  for (const [key, level] of shortcuts) {
    pi.registerShortcut(key, {
      description: `Set thinking to ${level}`,

      handler: (ctx) => {
        setThinking(level, ctx);
      },
    });
  }

  // --------------------------------------------------
  // Direct plan mode toggle (OFF <-> ON, no pause)
  // --------------------------------------------------

  pi.registerShortcut("alt+shift+o", {
    description: "Toggle Plan Mode (ON/OFF)",

    handler: async (ctx) => {
      const current = readPlanMode(ctx);
      const next = !current;
      await applyPlanMode(next, ctx);
      publish(ctx);
    },
  });

  // --------------------------------------------------
  // State/event bridge
  // --------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    running = true;
    activity = "idle";

    publish(ctx);

    // Heartbeat so consumers can distinguish
    // "OMP is alive but idle" from a stale file.
    if (!heartbeatStarted) {
      heartbeatStarted = true;

      ctx.setInterval(() => {
        publish(ctx, false);
      }, 5000);
    }
  });

  pi.on("session_switch", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    activity = "idle";
    publish(ctx);
  });

  pi.on(
    "before_agent_start",
    async (_event, ctx) => {
      setActivity(ctx, "working");
    },
  );

  pi.on("agent_start", async (_event, ctx) => {
    setActivity(ctx, "working");
  });

  pi.on("message_update", async (event, ctx) => {
    if (!ctx.hasUI) return;

    const type = getEventType(event);

    switch (type) {
      case "thinking_start":
      case "thinking_delta":
        setActivity(ctx, "thinking");
        break;

      case "thinking_end":
      case "text_start":
      case "text_delta":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
        setActivity(ctx, "working");
        break;
    }
  });

  pi.on(
    "tool_execution_start",
    async (_event, ctx) => {
      setActivity(ctx, "working");
    },
  );

  pi.on(
    "tool_execution_update",
    async (_event, ctx) => {
      setActivity(ctx, "working");
    },
  );

  pi.on(
    "tool_execution_end",
    async (_event, ctx) => {
      setActivity(ctx, "working");
    },
  );

  pi.on("agent_end", async (_event, ctx) => {
    setActivity(ctx, "idle");
  });

  pi.on(
    "session_shutdown",
    async (_event, ctx) => {
      if (!ctx.hasUI) return;

      running = false;
      activity = "idle";

      publish(ctx);

      try {
        udp?.close();
      } catch {
        // Already closed.
      }
    },
  );
}
