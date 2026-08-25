import type { ProviderUsageReport } from "../shared/ipc";

/** Renders provider usage/quota cards shared by the Usage modal and the side panel's Usage tab. */
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

    const card = document.createElement("div");
    card.className = "usage-provider-card";

    const titleRow = document.createElement("div");
    titleRow.className = "usage-provider-title-row";

    const nameSpan = document.createElement("span");
    nameSpan.className = "usage-provider-name";
    nameSpan.textContent = rep.providerName;

    titleRow.appendChild(nameSpan);
    card.appendChild(titleRow);
    if (rep.limits.length === 0) {
      const noLimits = document.createElement("div");
      noLimits.className = "usage-no-limits";
      noLimits.textContent = "Active — no strict rate window or unlimited tier.";
      card.appendChild(noLimits);
    } else {
      const limitList = document.createElement("div");
      limitList.className = "usage-limit-list";

      for (const lim of rep.limits) {
        const limRow = document.createElement("div");
        limRow.className = "usage-limit-row";

        const limTop = document.createElement("div");
        limTop.className = "usage-limit-top";

        const limLabel = document.createElement("span");
        limLabel.className = "usage-limit-label";
        limLabel.textContent = lim.label;

        const limPercent = document.createElement("span");
        limPercent.className = "usage-limit-percent";
        limPercent.textContent = `${lim.usedPercent}% used`;
        if (lim.usedPercent >= 80) limPercent.classList.add("high");
        else if (lim.usedPercent >= 50) limPercent.classList.add("med");

        limTop.append(limLabel, limPercent);

        const track = document.createElement("div");
        track.className = "usage-bar-track";
        const fill = document.createElement("div");
        fill.className = "usage-bar-fill";
        fill.style.width = `${Math.min(100, Math.max(1, lim.usedPercent))}%`;
        if (lim.usedPercent >= 80) fill.classList.add("high");
        else if (lim.usedPercent >= 50) fill.classList.add("med");
        track.appendChild(fill);

        const limSub = document.createElement("div");
        limSub.className = "usage-limit-sub";

        const remSpan = document.createElement("span");
        remSpan.textContent = `${100 - lim.usedPercent}% remaining`;

        limSub.appendChild(remSpan);

        if (lim.resetsIn) {
          const resetSpan = document.createElement("span");
          resetSpan.className = "usage-reset-countdown";
          resetSpan.textContent = `\u23F1 resets in ${lim.resetsIn}`;
          limSub.appendChild(resetSpan);
        }

        limRow.append(limTop, track, limSub);
        limitList.appendChild(limRow);
      }

      card.appendChild(limitList);
    }

    container.appendChild(card);
  }
}
