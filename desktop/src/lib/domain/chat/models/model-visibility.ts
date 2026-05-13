import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
  DesktopLaunchModelRegistry,
  DesktopLaunchModelRegistryModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type { ChatModelVisibilityOverridesByAgentKind } from "@/lib/domain/preferences/user/session-defaults";

export function resolveCatalogDefaultOptIn(
  agent: Pick<DesktopAgentLaunchAgent, "modelDisplayPolicy">,
  model: Pick<DesktopAgentLaunchModel, "id" | "isDefault" | "defaultOptIn" | "tags">,
): boolean {
  if (typeof model.defaultOptIn === "boolean") {
    return model.defaultOptIn;
  }

  return Boolean(
    agent.modelDisplayPolicy?.defaultVisibleModelIds?.includes(model.id)
    || model.isDefault
    || model.tags.includes("recommended"),
  );
}

export function isModelVisibleByPreference(
  agentKind: string,
  modelId: string,
  catalogDefaultOptIn: boolean,
  overrides: ChatModelVisibilityOverridesByAgentKind,
): boolean {
  return overrides[agentKind]?.[modelId] ?? catalogDefaultOptIn;
}

export function filterVisibleLaunchModels({
  agent,
  selectedModelId,
  overrides,
}: {
  agent: DesktopAgentLaunchAgent;
  selectedModelId?: string | null;
  overrides: ChatModelVisibilityOverridesByAgentKind;
}): DesktopAgentLaunchModel[] {
  const visibleIds = resolveVisibleLaunchModelIds({ agent, selectedModelId, overrides });
  return agent.models.filter((model) => visibleIds.has(model.id));
}

export function resolveRegistryModelCatalogDefaultOptIn(
  model: DesktopLaunchModelRegistryModel,
): boolean {
  if (typeof model.defaultOptIn === "boolean") {
    return model.defaultOptIn;
  }
  return model.isDefault;
}

export function filterVisibleRegistryModels({
  registry,
  selectedModelId,
  overrides,
}: {
  registry: DesktopLaunchModelRegistry;
  selectedModelId?: string | null;
  overrides: ChatModelVisibilityOverridesByAgentKind;
}): DesktopLaunchModelRegistryModel[] {
  const visibleIds = resolveVisibleRegistryModelIds({ registry, selectedModelId, overrides });
  return registry.models.filter((model) => visibleIds.has(model.id));
}

export function filterVisibleModelRegistries<T extends DesktopLaunchModelRegistry>({
  modelRegistries,
  selected,
  overrides,
}: {
  modelRegistries: T[];
  selected?: { kind: string; modelId: string } | null;
  overrides: ChatModelVisibilityOverridesByAgentKind;
}): T[] {
  return modelRegistries
    .map((registry) => ({
      ...registry,
      models: filterVisibleRegistryModels({
        registry,
        selectedModelId: selected?.kind === registry.kind ? selected.modelId : null,
        overrides,
      }) as T["models"],
    }))
    .filter((registry) => registry.models.length > 0);
}

export function resolveVisibleRegistryModelIds({
  registry,
  selectedModelId,
  overrides,
}: {
  registry: DesktopLaunchModelRegistry;
  selectedModelId?: string | null;
  overrides: ChatModelVisibilityOverridesByAgentKind;
}): Set<string> {
  const visibleIds = new Set<string>();
  for (const model of registry.models) {
    if (
      model.id === selectedModelId
      || isModelVisibleByPreference(
        registry.kind,
        model.id,
        resolveRegistryModelCatalogDefaultOptIn(model),
        overrides,
      )
    ) {
      visibleIds.add(model.id);
    }
  }

  const fallbackModelId = resolveRegistryVisibilityFallbackModelId(registry, selectedModelId);
  if (visibleIds.size === 0 && fallbackModelId) {
    visibleIds.add(fallbackModelId);
  }

  return visibleIds;
}

function resolveVisibleLaunchModelIds({
  agent,
  selectedModelId,
  overrides,
}: {
  agent: DesktopAgentLaunchAgent;
  selectedModelId?: string | null;
  overrides: ChatModelVisibilityOverridesByAgentKind;
}): Set<string> {
  const visibleIds = new Set<string>();
  for (const model of agent.models) {
    if (
      model.id === selectedModelId
      || isModelVisibleByPreference(
        agent.kind,
        model.id,
        resolveCatalogDefaultOptIn(agent, model),
        overrides,
      )
    ) {
      visibleIds.add(model.id);
    }
  }

  const fallbackModelId = resolveLaunchVisibilityFallbackModelId(agent, selectedModelId);
  if (visibleIds.size === 0 && fallbackModelId) {
    visibleIds.add(fallbackModelId);
  }

  return visibleIds;
}

function resolveRegistryVisibilityFallbackModelId(
  registry: DesktopLaunchModelRegistry,
  selectedModelId?: string | null,
): string | null {
  return registry.models.find((model) => model.id === selectedModelId)?.id
    ?? registry.models.find((model) => model.id === registry.defaultModelId)?.id
    ?? registry.models.find((model) => model.isDefault)?.id
    ?? registry.models[0]?.id
    ?? null;
}

function resolveLaunchVisibilityFallbackModelId(
  agent: DesktopAgentLaunchAgent,
  selectedModelId?: string | null,
): string | null {
  return agent.models.find((model) => model.id === selectedModelId)?.id
    ?? agent.models.find((model) => model.id === agent.defaultModelId)?.id
    ?? agent.models.find((model) => model.isDefault)?.id
    ?? agent.models[0]?.id
    ?? null;
}

export function withUpdatedModelVisibilityOverride(
  current: ChatModelVisibilityOverridesByAgentKind,
  agentKind: string,
  modelId: string,
  visible: boolean,
  catalogDefaultOptIn: boolean,
): ChatModelVisibilityOverridesByAgentKind {
  const trimmedAgentKind = agentKind.trim();
  const trimmedModelId = modelId.trim();
  if (!trimmedAgentKind || !trimmedModelId) {
    return current;
  }

  if (visible === catalogDefaultOptIn) {
    const currentAgentOverrides = current[trimmedAgentKind] ?? {};
    if (!(trimmedModelId in currentAgentOverrides)) {
      return current;
    }
    const remainingAgentOverrides = { ...currentAgentOverrides };
    delete remainingAgentOverrides[trimmedModelId];
    if (Object.keys(remainingAgentOverrides).length === 0) {
      const remainingOverrides = { ...current };
      delete remainingOverrides[trimmedAgentKind];
      return remainingOverrides;
    }
    return {
      ...current,
      [trimmedAgentKind]: remainingAgentOverrides,
    };
  }

  return {
    ...current,
    [trimmedAgentKind]: {
      ...(current[trimmedAgentKind] ?? {}),
      [trimmedModelId]: visible,
    },
  };
}
