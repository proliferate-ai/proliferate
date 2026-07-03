import type {
  AgentAuthRoute,
  AgentAuthSelection,
  AgentAuthSurface,
} from "@proliferate/cloud-sdk";

export interface HarnessCatalogModel {
  id: string;
  displayName: string;
  description: string | null;
  provider: string | null;
  enabled: boolean;
}

// Snapshot entries are loosely-typed JSON (server guarantees only `id`);
// normalize to the fields the grid renders and treat missing `enabled` as on.
export function normalizeCatalogModels(
  models: readonly Record<string, unknown>[],
): HarnessCatalogModel[] {
  const normalized: HarnessCatalogModel[] = [];
  for (const entry of models) {
    const id = entry.id;
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    const displayName = entry.displayName;
    const description = entry.description;
    const provider = entry.provider;
    normalized.push({
      id,
      displayName:
        typeof displayName === "string" && displayName.trim().length > 0
          ? displayName
          : id,
      description:
        typeof description === "string" && description.length > 0
          ? description
          : null,
      provider: typeof provider === "string" && provider.length > 0 ? provider : null,
      enabled: entry.enabled !== false,
    });
  }
  return normalized;
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
