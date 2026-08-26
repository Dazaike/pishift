import type { InstalledModel } from "./ipc";

/** Provider ids in models.db are truncated at ":" (`openrouter:pseudo-api` → `openrouter`); normalize both sides the same way. */
function normalizeProvider(raw: string): string {
  const low = raw.trim().toLowerCase();
  const colon = low.indexOf(":");
  return colon > 0 ? low.slice(0, colon) : low;
}

function bareId(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

/**
 * Resolve a control-bridge model spec (`<provider>/<model-id>`, where the model
 * id may itself contain slashes) against the models.db catalog.
 *
 * Matching is ranked, never substring: `grok-4` must not absorb `grok-4.6`, and
 * `openrouter/google/gemini-3.7-flash` must not answer for
 * `google-antigravity/gemini-3.7-flash`.
 */
export function findInstalledModel(
  modelSpec: string,
  models: readonly InstalledModel[],
): InstalledModel | undefined {
  const spec = (modelSpec ?? "").trim().toLowerCase();
  if (!spec) return undefined;

  const slash = spec.indexOf("/");
  const providerHint = slash > 0 ? normalizeProvider(spec.slice(0, slash)) : "";
  const idHint = slash > 0 ? spec.slice(slash + 1) : spec;
  const bareHint = bareId(idHint);

  let best: InstalledModel | undefined;
  let bestScore = 0;

  for (const m of models) {
    const id = m.id.toLowerCase();
    // Rank the id match: exact > exact-with-provider-prefix > bare-name > suffix.
    let idScore = 0;
    if (id === idHint || id === spec) idScore = 4;
    else if (bareId(id) === bareHint) idScore = 3;
    else if (id.endsWith("/" + idHint) || idHint.endsWith("/" + id)) idScore = 2;
    if (idScore === 0) continue;

    const provider = normalizeProvider(m.provider);
    // No provider hint → neutral; exact provider wins over a same-name row elsewhere.
    const providerScore = providerHint === "" ? 1 : provider === providerHint ? 2 : 0;

    const score = idScore * 10 + providerScore;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  return best;
}
