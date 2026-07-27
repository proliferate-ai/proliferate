import type { AgentLaunchOptionsResponse } from "@anyharness/sdk";

export interface HarnessCatalogModelEffort {
  values: string[];
  default: string | null;
}

export interface HarnessCatalogModel {
  id: string;
  displayName: string;
  // Catalog description (contract §5): becomes the table's name-block subtitle
  // when present; null for probe-only ids and old thin snapshots.
  description: string | null;
  provider: string | null;
  status: string | null;
  effort: HarnessCatalogModelEffort | null;
  fastMode: boolean | null;
  // The permission/agent modes the model supports (contract §5), joined from the
  // catalog's `controls.mode.values`; null when the model has no mode control or
  // for old thin snapshots that predate mode enrichment.
  modes: string[] | null;
  enabled: boolean;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// The enriched modes list (contract §5): a non-empty array of non-empty strings.
// Old thin snapshots (pre-enrichment) omit it → null, so the row renders sparse.
function normalizeModes(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const modes = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return modes.length > 0 ? modes : null;
}

// The enriched effort control (contract §1): `{ values, default }`. Old thin
// snapshots (pre-enrichment) omit it entirely → null, so the row renders sparse.
function normalizeEffort(value: unknown): HarnessCatalogModelEffort | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as { values?: unknown; default?: unknown };
  if (!Array.isArray(raw.values)) {
    return null;
  }
  const values = raw.values.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  if (values.length === 0) {
    return null;
  }
  return { values, default: normalizeString(raw.default) };
}

// Snapshot entries are loosely-typed JSON (server guarantees only `id`);
// normalize to the enriched fields the table renders (contract §1) and treat
// missing `enabled` as on. Post-enrichment cloud snapshots carry the rich
// `provider`/`status`/`effort`/`fastMode` keys; older thin snapshots omit them
// and fall through to null → the table renders those cells sparse.
export function normalizeCatalogModels(
  models: readonly Record<string, unknown>[],
): HarnessCatalogModel[] {
  const normalized: HarnessCatalogModel[] = [];
  for (const entry of models) {
    const id = entry.id;
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    normalized.push({
      id,
      displayName: normalizeString(entry.displayName) ?? id,
      description: normalizeString(entry.description),
      provider: normalizeString(entry.provider),
      status: normalizeString(entry.status),
      effort: normalizeEffort(entry.effort),
      fastMode: typeof entry.fastMode === "boolean" ? entry.fastMode : null,
      modes: normalizeModes(entry.modes),
      enabled: entry.enabled !== false,
    });
  }
  return normalized;
}

// Local Settings must be useful without a Proliferate Cloud session. The
// AnyHarness launch catalog is already the runtime-resolved source used by the
// composer, so normalize that response directly instead of requiring a cloud
// catalog snapshot merely to display the models installed on this machine.
export function normalizeRuntimeLaunchModels(
  harnessKind: string,
  launchOptions: AgentLaunchOptionsResponse | undefined,
): HarnessCatalogModel[] {
  const models = launchOptions?.agents.find(
    (agent) => agent.kind === harnessKind,
  )?.models ?? [];

  return models.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    description: normalizeString(model.description),
    provider: normalizeString(model.provider),
    status: normalizeString(model.status),
    effort: normalizeEffort(model.effort),
    fastMode: typeof model.fastMode === "boolean" ? model.fastMode : null,
    modes: normalizeModes(model.modes),
    enabled: true,
  }));
}

// Overrides have no GET endpoint, so the enabled-set is reconstructed from the
// layered catalog (this pane is the only override writer) and re-upserted as a
// whole `update` patch on every toggle.
export function buildEnabledOverridePatchJson(
  models: readonly HarnessCatalogModel[],
  modelId: string,
  enabled: boolean,
): string {
  const disabledIds = new Set(
    models.filter((model) => !model.enabled).map((model) => model.id),
  );
  if (enabled) {
    disabledIds.delete(modelId);
  } else {
    disabledIds.add(modelId);
  }
  const update: Record<string, { enabled: false }> = {};
  for (const id of [...disabledIds].sort()) {
    update[id] = { enabled: false };
  }
  return JSON.stringify({ update });
}

// The route/auth-context helpers that used to live here
// (`defaultRouteForSurface`, `catalogRouteForSurface`,
// `apiKeyProviderHintForSurface`, `authContextIdForRoute`,
// `NATIVE_AUTH_CONTEXT_ID_BY_HARNESS`) are deleted with the composed cloud
// re-key (model-catalog.md §Cloud routes): the layered read is keyed by
// (owner, harness) alone, so the pane no longer resolves a per-context scope.
