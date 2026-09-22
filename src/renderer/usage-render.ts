import type { ProviderUsageReport } from "../shared/ipc";
import { partitionContextWindow, type ContextUsageSnapshot } from "../shared/transcript";
import { renderProviderIconEl } from "./provider-icons";
import { usagePercentOfMax } from "../shared/usage-tracker";
import { safeAnimate, springPresets } from "./motion-utils";
/** Shortest reset window first (5 Hour before Weekly) so related cards read top-to-bottom by urgency. */
function windowRankMinutes(label: string): number {
  const match = label.match(/\(([^)]+)\)\s*$/);
  const text = match ? match[1].toLowerCase() : "";
  const numMatch = text.match(/(\d+(?:\.\d+)?)/);
  const num = numMatch ? parseFloat(numMatch[1]) : 1;
  if (text.includes("min")) return num;
  if (text.includes("hour")) return num * 60;
  if (text.includes("day")) return num * 1440;
  if (text.includes("week")) return num * 10080;
  if (text.includes("month")) return num * 43200;
  return Number.MAX_SAFE_INTEGER;
}

/** Label with the trailing "(Window)" qualifier stripped, used to group same-metric cards together. */
function baseLimitLabel(label: string): string {
  return label.replace(/\s*\([^)]+\)\s*$/, "").trim();
}

/** Groups cards by their base metric (last-seen group appears first), then orders each group by window duration. */
function sortedLimits<T extends { label: string }>(limits: T[]): T[] {
  const firstSeenOrder = new Map<string, number>();
  for (const lim of limits) {
    const key = baseLimitLabel(lim.label);
    if (!firstSeenOrder.has(key)) firstSeenOrder.set(key, firstSeenOrder.size);
  }
  const groupCount = firstSeenOrder.size;
  return [...limits].sort((a, b) => {
    const groupDiff =
      (groupCount - 1 - firstSeenOrder.get(baseLimitLabel(a.label))!) -
      (groupCount - 1 - firstSeenOrder.get(baseLimitLabel(b.label))!);
    if (groupDiff !== 0) return groupDiff;
    return windowRankMinutes(a.label) - windowRankMinutes(b.label);
  });
}

/** Drops filler qualifiers (e.g. "(shared)") from a limit label for compact card display; full text stays in the tooltip. */
function shortenLimitLabel(label: string): string {
  return label
    .replace(/\(\s*shared\s*\)/gi, "")
    .replace(/\(\s*pooled\s*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Renders provider usage/quota rows shared by the Usage popover and the side panel. */
export function renderUsageCards(
  container: HTMLElement,
  reports: ProviderUsageReport[],
  providerIconUrls: Record<string, string> = {},
): void {
  container.replaceChildren();

  if (reports.length === 0) {
    const empty = document.createElement("div");
    empty.className = "usage-empty";
    empty.textContent = "No provider quotas returned by 'omp usage'.";
    container.appendChild(empty);
    return;
  }

  for (const rep of reports) {
    if (rep.rawText) {
      const pre = document.createElement("pre");
      pre.className = "usage-raw-pre";
      pre.textContent = rep.rawText;
      container.appendChild(pre);
      continue;
    }

    const section = document.createElement("div");
    section.className = "usage-provider";

    const name = document.createElement("div");
    name.className = "usage-provider-name";
    const nameLeft = document.createElement("span");
    nameLeft.className = "usage-provider-name-left";
    nameLeft.appendChild(renderProviderIconEl(rep.provider, providerIconUrls[rep.provider]));
    const label = document.createElement("span");
    label.className = "usage-provider-name-label";
    label.textContent = rep.providerName;
    nameLeft.appendChild(label);
    name.appendChild(nameLeft);
    if (rep.account) {
      const acct = document.createElement("span");
      acct.className = "usage-provider-account";
      acct.textContent = rep.account;
      name.appendChild(acct);
    }
    section.appendChild(name);
    if (rep.limits.length === 0) {
      const noLimits = document.createElement("div");
      noLimits.className = "usage-no-limits";
      noLimits.textContent = "Active — no strict rate window or unlimited tier.";
      section.appendChild(noLimits);
    } else {
      const limitList = document.createElement("div");
      limitList.className = "usage-limit-list";

      for (const lim of sortedLimits(rep.limits)) {
        const maxPercent = lim.maxPercent ?? 100;
        const fillPercent = usagePercentOfMax(lim);
        const tier = fillPercent >= 80 ? "high" : fillPercent >= 50 ? "med" : "low";
        const limRow = document.createElement("div");
        limRow.className = "usage-limit-row";

        const limTop = document.createElement("div");
        limTop.className = "usage-limit-top";

        const limLabel = document.createElement("span");
        limLabel.className = "usage-limit-label";
        limLabel.textContent = shortenLimitLabel(lim.label);
        limLabel.title = lim.label;

        const remaining = document.createElement("span");
        remaining.className = "usage-limit-remaining";
        remaining.classList.add(tier);
        remaining.textContent = `${Math.max(0, maxPercent - lim.usedPercent)}%`;

        limTop.append(limLabel, remaining);

        const track = document.createElement("div");
        track.className = "usage-bar-track";
        const fill = document.createElement("div");
        fill.className = "usage-bar-fill";
        if (tier !== "low") fill.classList.add(tier);
        fill.dataset.used = String(lim.usedPercent);
        fill.dataset.max = String(maxPercent);
        fill.style.transformOrigin = "left center";
        fill.style.transform = `scaleX(${Math.min(1, Math.max(0.02, lim.usedPercent / maxPercent))})`;
        track.appendChild(fill);

        const limSub = document.createElement("div");
        limSub.className = "usage-limit-sub";

        const usedSpan = document.createElement("span");
        usedSpan.className = "usage-limit-used";
        usedSpan.textContent = `${lim.usedPercent}% used`;
        limSub.appendChild(usedSpan);

        if (lim.resetsIn) {
          const resetSpan = document.createElement("span");
          resetSpan.className = "usage-reset-countdown";
          resetSpan.textContent = `resets in ${lim.resetsIn}`;
          limSub.appendChild(resetSpan);
        }

        limRow.append(limTop, track, limSub);
        limitList.appendChild(limRow);
      }

      section.appendChild(limitList);
    }

    container.appendChild(section);
  }
}

/** Formats token numbers cleanly (e.g. 1520 -> 1.5k, 24500 -> 24.5k, 200000 -> 200k). */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 10000) {
    const k = (tokens / 1000).toFixed(1);
    return k.endsWith(".0") ? `${k.slice(0, -2)}k` : `${k}k`;
  }
  if (tokens < 1_000_000) {
    return `${Math.round(tokens / 1000)}k`;
  }
  const m = (tokens / 1_000_000).toFixed(1);
  return m.endsWith(".0") ? `${m.slice(0, -2)}M` : `${m}M`;
}

/**
 * Renders the Context Window Usage card for the active conversation.
 */
export function renderContextCard(
  container: HTMLElement,
  contextUsage: ContextUsageSnapshot | null | undefined,
): void {
  // Rendering stays independent from the transcript-backed refresh path.

  const section = document.createElement("div");
  section.className = "usage-provider ctx-section";

  const rawWindow = contextUsage?.contextWindow ?? 0;
  const windowValid = Number.isFinite(rawWindow) && rawWindow > 0;
  // Guarded divisor; invalid windows fall back to a 0% ring with a 0 display value.
  const ctxWindow = windowValid ? rawWindow : 1;
  const displayWindow = windowValid ? rawWindow : 0;
  const rawPercent = windowValid && contextUsage ? contextUsage.percent : 0;
  const percent = Math.min(100, Math.max(0, Math.round(rawPercent)));

  const partition =
    contextUsage && contextUsage.totalTokens > 0 ? partitionContextWindow(contextUsage) : null;
  const usedTokens = partition ? Math.max(0, partition.usedTokens) : 0;
  const freeTokens = partition ? Math.max(0, partition.freeTokens) : 0;
  const bufferTokens = partition ? Math.max(0, partition.autoCompactBufferTokens) : 0;

  const RING_CIRC = 326.73; // 2π × 52
  const ringColor = percent >= 80 ? "#f7768e" : percent >= 50 ? "#f59e0b" : "#38bdf8";
  const ringOffset = (RING_CIRC * (1 - percent / 100)).toFixed(2);

  const hero = document.createElement("div");
  hero.className = "ctx-hero";

  const ringWrap = document.createElement("div");
  ringWrap.className = "ctx-ring-wrap";
  ringWrap.setAttribute("role", "img");
  ringWrap.setAttribute("aria-label", `Context usage ${percent}% — ${usedTokens} of ${displayWindow} tokens`);
  ringWrap.innerHTML =
    `<svg width="112" height="112" viewBox="0 0 120 120" aria-hidden="true">` +
    `<circle cx="60" cy="60" r="52" fill="none" stroke="color-mix(in srgb, var(--fg) 10%, transparent)" stroke-width="10"/>` +
    `<circle cx="60" cy="60" r="52" fill="none" stroke="${ringColor}" stroke-width="10" stroke-linecap="round" transform="rotate(-90 60 60)" stroke-dasharray="326.73" stroke-dashoffset="${ringOffset}"/>` +
    `</svg>`;

  const percentEl = document.createElement("div");
  percentEl.className = "ctx-percent";
  percentEl.textContent = `${percent}%`;
  const percentSub = document.createElement("div");
  percentSub.className = "ctx-percent-sub";
  percentSub.textContent = `${formatTokenCount(usedTokens)}/${formatTokenCount(displayWindow)}`;
  percentEl.appendChild(percentSub);
  ringWrap.appendChild(percentEl);

  const stats = document.createElement("div");
  stats.className = "ctx-stats";
  const modelLine = document.createElement("div");
  modelLine.className = "ctx-model";
  modelLine.textContent = contextUsage?.modelId || "Unknown model";
  modelLine.title = contextUsage?.modelId || "Unknown model";
  const windowLine = document.createElement("div");
  windowLine.className = "ctx-window";
  windowLine.textContent = `${formatTokenCount(displayWindow)} context window`;
  stats.append(modelLine, windowLine);
  if (partition) {
    const freeLine = document.createElement("div");
    freeLine.className = "ctx-free-line";
    freeLine.textContent = `${formatTokenCount(freeTokens)} free · ${formatTokenCount(bufferTokens)} reserved`;
    stats.appendChild(freeLine);
  }


  hero.append(ringWrap, stats);
  section.appendChild(hero);

  if (partition) {
    const cats = document.createElement("div");
    cats.className = "ctx-cats";
    for (const slice of partition.slices) {
      const tokens = Math.max(0, slice.tokens);
      const slicePct = ((tokens / ctxWindow) * 100).toFixed(1);
      const row = document.createElement("div");
      row.className = "ctx-cat";
      const top = document.createElement("div");
      top.className = "ctx-cat-top";
      const catLabel = document.createElement("span");
      catLabel.className = "ctx-cat-label";
      catLabel.textContent = slice.label;
      const catVal = document.createElement("span");
      catVal.className = "ctx-cat-val";
      catVal.textContent = `${formatTokenCount(tokens)} · ${slicePct}%`;
      top.append(catLabel, catVal);
      const track = document.createElement("div");
      track.className = "ctx-cat-track";
      const fill = document.createElement("div");
      fill.className = "ctx-cat-fill";
      fill.style.width = `${slicePct}%`;
      fill.style.background = slice.hollow
        ? `color-mix(in srgb, var(${slice.colorVar}) 55%, transparent)`
        : `var(${slice.colorVar})`;
      track.appendChild(fill);
      row.append(top, track);
      cats.appendChild(row);
    }
    section.appendChild(cats);
  } else {
    const empty = document.createElement("div");
    empty.className = "usage-no-limits";
    empty.textContent = "No messages sent yet in this conversation.";
    section.appendChild(empty);
  }

  container.appendChild(section);
}

export function renderUsageSkeleton(container: HTMLElement): void {
  container.replaceChildren();

  for (let i = 0; i < 2; i++) {
    const provider = document.createElement("div");
    provider.className = "usage-skeleton-provider";

    const name = document.createElement("div");
    name.className = "usage-skeleton-line";
    name.style.width = "42%";
    provider.appendChild(name);

    for (let j = 0; j < 2; j++) {
      const label = document.createElement("div");
      label.className = "usage-skeleton-line";
      label.style.width = "70%";

      const bar = document.createElement("div");
      bar.className = "usage-skeleton-bar";

      const sub = document.createElement("div");
      sub.className = "usage-skeleton-line";
      sub.style.width = "48%";

      provider.append(label, bar, sub);
    }

    container.appendChild(provider);
  }
}

export function animateUsageReveal(container: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  container.querySelectorAll<HTMLElement>(".usage-provider").forEach((el, i) => {
    safeAnimate(el, { opacity: [0, 1], y: [8, 0] }, { ...springPresets.smooth, delay: i * 0.045 });
  });

  container.querySelectorAll<HTMLElement>(".usage-bar-fill").forEach((fill) => {
    const used = Number(fill.dataset.used ?? "0");
    const max = Number(fill.dataset.max ?? "100");
    safeAnimate(fill, { scaleX: [0, Math.min(1, Math.max(0.02, used / max))] }, springPresets.smooth);
  });
}
