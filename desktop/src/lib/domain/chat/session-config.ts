import type {
  ModelRegistry,
  ModelRegistryModel,
  WorkspaceSessionLaunchAgent,
} from "@anyharness/sdk";

export interface RegistryModelInfo {
  registry: ModelRegistry;
  model: ModelRegistryModel;
}

export interface SessionConfigSnapshot {
  agentKind: string | null;
  modelId: string | null;
}

export function defaultModelIdForAgentKind(
  modelRegistries: ModelRegistry[],
  agentKind: string | null | undefined,
): string | undefined {
  if (!agentKind) return undefined;
  const registry = resolveModelRegistry(modelRegistries, agentKind);
  return registry?.defaultModelId ?? registry?.models.find((model) => model.isDefault)?.id ?? registry?.models[0]?.id;
}

export function resolveModelRegistry(
  modelRegistries: ModelRegistry[],
  agentKind: string | null | undefined,
): ModelRegistry | null {
  if (!agentKind) {
    return null;
  }
  return modelRegistries.find((item) => item.kind === agentKind) ?? null;
}

export function resolveModelForRegistry(
  registry: ModelRegistry,
  modelId: string | null | undefined,
): ModelRegistryModel | null {
  return (
    registry.models.find((model) => model.id === modelId)
    ?? registry.models.find((model) => model.id === registry.defaultModelId)
    ?? registry.models.find((model) => model.isDefault)
    ?? registry.models[0]
    ?? null
  );
}

export function resolveModelInfo(
  modelRegistries: ModelRegistry[],
  agentKind: string | null | undefined,
  modelId: string | null | undefined,
): RegistryModelInfo | null {
  const registry = resolveModelRegistry(modelRegistries, agentKind);
  if (!registry) {
    return null;
  }
  const model = resolveModelForRegistry(registry, modelId);
  return model ? { registry, model } : null;
}

export function mergeLaunchAgentsWithRegistries(
  launchAgents: WorkspaceSessionLaunchAgent[],
  modelRegistries: ModelRegistry[],
): WorkspaceSessionLaunchAgent[] {
  const registryByKind = new Map(modelRegistries.map((registry) => [registry.kind, registry]));

  return launchAgents.flatMap((agent) => {
    const registry = registryByKind.get(agent.kind);
    if (!registry) {
      return agent.models.length > 0 ? [agent] : [];
    }

    const models = registry.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      isDefault: model.isDefault,
    }));

    const defaultModelId = models.some((model) => model.id === registry.defaultModelId)
      ? registry.defaultModelId
      : (
        models.find((model) => model.isDefault)?.id
        ?? models[0]?.id
        ?? null
      );

    if (models.length === 0) {
      return [];
    }

    return [{
      ...agent,
      displayName: registry.displayName,
      defaultModelId,
      models,
    }];
  });
}
