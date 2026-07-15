import type { AgentLaunchOptionsResponse, GatewayModelEntry } from "@anyharness/sdk";
import type {
  AgentAuthRoute,
  AgentAuthSelection,
  AgentAuthSurface,
} from "@proliferate/cloud-sdk";

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

// The runtime's resolved gateway model plan (contract §1/§5): each id is joined
// onto the bundled catalog, so entries carry enriched display metadata
// (probe-only ids stay sparse `{ id, provider? }`). There's no override layering
// (the runtime doesn't know about cloud catalog overrides), so every resolved
// model is enabled; the table disables the toggle for this source (see
// HarnessAllModelsSection).
export function normalizeGatewayModels(
  models: readonly GatewayModelEntry[],
): HarnessCatalogModel[] {
  return models
    .filter((model) => model.id.length > 0)
    .map((model) => ({
      id: model.id,
      displayName: normalizeString(model.displayName) ?? model.id,
      description: normalizeString(model.description),
      provider: normalizeString(model.provider),
      status: normalizeString(model.status),
      effort: normalizeEffort(model.effort),
      fastMode: typeof model.fastMode === "boolean" ? model.fastMode : null,
      modes: normalizeModes(model.modes),
      enabled: true,
    }));
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

// native/api_key routes probe on the CLIENT (catalog.py's refresh_catalog
// contract): rich live probing is deferred, so v1 sources the payload from the
// local AnyHarness runtime's already-resolved launch catalog (the same
// bundled catalog-v2 model list `useAgentLaunchOptionsQuery` feeds the session
// model picker) instead of spawning a harness process. Returns null when the
// runtime has no ready models for this harness — the caller should show a
// "runtime unavailable" toast and skip the server call rather than upload an
// empty snapshot.
export function buildRuntimeCatalogModelsJson(
  harnessKind: string,
  launchOptions: AgentLaunchOptionsResponse | undefined,
): string | null {
  const agent = launchOptions?.agents.find((entry) => entry.kind === harnessKind);
  if (!agent || agent.models.length === 0) {
    return null;
  }
  const entries = agent.models.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    ...(model.aliases && model.aliases.length > 0 ? { aliases: model.aliases } : {}),
    // Forward the runtime-enriched catalog fields so cloud snapshots stored from
    // this upload carry the same richness as the gateway-models endpoint (the
    // server's parse_models_json preserves arbitrary keys beside `id`).
    ...(model.description != null ? { description: model.description } : {}),
    ...(model.provider != null ? { provider: model.provider } : {}),
    ...(model.status != null ? { status: model.status } : {}),
    ...(model.effort != null ? { effort: model.effort } : {}),
    ...(model.fastMode != null ? { fastMode: model.fastMode } : {}),
    ...(model.modes != null ? { modes: model.modes } : {}),
  }));
  return JSON.stringify(entries);
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

export function defaultRouteForSurface(surface: AgentAuthSurface): AgentAuthRoute {
  return surface === "cloud" ? "gateway" : "native";
}

// The catalog is scoped per (surface, route); resolve which route's catalog to
// show from the enabled selection sources. Gateway wins over an api_key source;
// an empty (native) scope falls back to the surface default.
export function catalogRouteForSurface(
  harnessKind: string,
  surface: AgentAuthSurface,
  selections: readonly AgentAuthSelection[],
): AgentAuthRoute {
  const scope = selections.filter(
    (entry) =>
      entry.harnessKind === harnessKind
      && entry.surface === surface
      && entry.enabled,
  );
  if (scope.some((entry) => entry.sourceKind === "gateway")) {
    return "gateway";
  }
  if (scope.some((entry) => entry.sourceKind === "api_key")) {
    return "api_key";
  }
  return defaultRouteForSurface(surface);
}
