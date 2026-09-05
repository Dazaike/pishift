import type { ProviderUsageReport } from "../shared/ipc";
import { safeAnimate, springPresets } from "./motion-utils";

function usedScale(usedPercent: number): number {
  return Math.min(1, Math.max(0.02, usedPercent / 100));
}

/** Renders provider usage/quota rows shared by the Usage popover and the side panel. */
export function renderUsageCards(container: HTMLElement, reports: ProviderUsageReport[]): void {
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
    name.textContent = rep.providerName;
    section.appendChild(name);

    if (rep.limits.length === 0) {
      const noLimits = document.createElement("div");
      noLimits.className = "usage-no-limits";
      noLimits.textContent = "Active — no strict rate window or unlimited tier.";
      section.appendChild(noLimits);
    } else {
      const limitList = document.createElement("div");
      limitList.className = "usage-limit-list";

      for (const lim of rep.limits) {
        const tier = lim.usedPercent >= 80 ? "high" : lim.usedPercent >= 50 ? "med" : "low";
        const limRow = document.createElement("div");
        limRow.className = "usage-limit-row";

        const limTop = document.createElement("div");
        limTop.className = "usage-limit-top";

        const limLabel = document.createElement("span");
        limLabel.className = "usage-limit-label";
        limLabel.textContent = lim.label;

        const remaining = document.createElement("span");
        remaining.className = "usage-limit-remaining";
        remaining.classList.add(tier);
        remaining.textContent = `${Math.max(0, 100 - lim.usedPercent)}%`;

        limTop.append(limLabel, remaining);

        const track = document.createElement("div");
        track.className = "usage-bar-track";
        const fill = document.createElement("div");
        fill.className = "usage-bar-fill";
        if (tier !== "low") fill.classList.add(tier);
        fill.dataset.used = String(lim.usedPercent);
        fill.style.transformOrigin = "left center";
        fill.style.transform = `scaleX(${usedScale(lim.usedPercent)})`;
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
    safeAnimate(fill, { scaleX: [0, usedScale(used)] }, springPresets.smooth);
  });
}
