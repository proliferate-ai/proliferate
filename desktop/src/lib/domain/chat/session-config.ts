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
  const normalizedModelId = modelId?.trim();
  return (
    registry.models.find((model) => model.id === normalizedModelId)
    ?? (normalizedModelId
      ? registry.models.find((model) => model.aliases?.includes(normalizedModelId))
      : undefined)
    ?? registry.models.find((model) => model.id === registry.defaultModelId)
    ?? registry.models.find((model) => model.isDefault)
    ?? registry.models[0]
    ?? null
  );
}

function resolveRegistryModelForRow(
  registry: ModelRegistry,
  modelId: string,
): ModelRegistryModel | null {
  return (
    registry.models.find((model) => model.id === modelId)
    ?? registry.models.find((model) => model.aliases?.includes(modelId))
    ?? null
  );
}

function rowMatchesRegistryModel(
  rowId: string,
  model: ModelRegistryModel,
): boolean {
  return rowId === model.id || (model.aliases ?? []).includes(rowId);
}

function resolveRegistryDefaultModel(registry: ModelRegistry): ModelRegistryModel | null {
  return (
    registry.models.find((model) => model.id === registry.defaultModelId)
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

    const decoratedModels = agent.models.map((model) => {
      const registryModel = resolveRegistryModelForRow(registry, model.id);
      const sessionDefaultControls =
        model.sessionDefaultControls ?? registryModel?.sessionDefaultControls ?? [];
      return {
        ...model,
        displayName: registryModel?.displayName ?? model.displayName,
        ...(sessionDefaultControls.length > 0 ? { sessionDefaultControls } : {}),
      };
    });

    const registryDefaultModel = resolveRegistryDefaultModel(registry);
    const registryDefaultRow = registryDefaultModel
      ? decoratedModels.find((model) => rowMatchesRegistryModel(model.id, registryDefaultModel))
      : undefined;
    const runtimeDefaultRow = decoratedModels.find((model) =>
      model.id === agent.defaultModelId || model.isDefault
    );
    const defaultModelId = (
      registryDefaultRow?.id
      ?? runtimeDefaultRow?.id
      ?? decoratedModels[0]?.id
      ?? null
    );

    const models = decoratedModels.map((model) => ({
      ...model,
      isDefault: model.id === defaultModelId,
    }));

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

export function buildRegistryLaunchAgents(
  modelRegistries: ModelRegistry[],
): WorkspaceSessionLaunchAgent[] {
  return modelRegistries.flatMap((registry) => {
    if (registry.models.length === 0) {
      return [];
    }

    const defaultModel =
      registry.models.find((model) => model.id === registry.defaultModelId)
      ?? registry.models.find((model) => model.isDefault)
      ?? registry.models[0];
    const defaultModelId = defaultModel?.id ?? null;

    return [{
      kind: registry.kind,
      displayName: registry.displayName,
      defaultModelId,
      models: registry.models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        isDefault: model.id === defaultModelId,
        ...((model.sessionDefaultControls ?? []).length > 0
          ? { sessionDefaultControls: model.sessionDefaultControls }
          : {}),
      })),
    }];
  });
}
