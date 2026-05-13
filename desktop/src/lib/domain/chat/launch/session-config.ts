import type {
  DesktopAgentCatalogStatus,
  DesktopAgentLaunchRemediation,
  DesktopSessionDefaultControl,
} from "@/lib/domain/agents/cloud-launch-catalog";

export interface SessionConfigModel {
  id: string;
  displayName: string;
  description?: string | null;
  aliases?: string[];
  status?: DesktopAgentCatalogStatus;
  isDefault: boolean;
  launchRemediation?: DesktopAgentLaunchRemediation | null;
  sessionDefaultControls?: DesktopSessionDefaultControl[];
}

export interface SessionConfigModelRegistry {
  kind: string;
  displayName: string;
  defaultModelId?: string | null;
  models: SessionConfigModel[];
}

export interface SessionLaunchAgentModel {
  id: string;
  displayName: string;
  isDefault: boolean;
}

export interface SessionLaunchAgent {
  kind: string;
  displayName: string;
  defaultModelId: string | null;
  models: SessionLaunchAgentModel[];
}

export interface RegistryModelInfo {
  registry: SessionConfigModelRegistry;
  model: SessionConfigModel;
}

export interface SessionConfigSnapshot {
  agentKind: string | null;
  modelId: string | null;
}

export function defaultModelIdForAgentKind(
  modelRegistries: SessionConfigModelRegistry[],
  agentKind: string | null | undefined,
): string | undefined {
  if (!agentKind) return undefined;
  const registry = resolveModelRegistry(modelRegistries, agentKind);
  return registry?.defaultModelId ?? registry?.models.find((model) => model.isDefault)?.id ?? registry?.models[0]?.id;
}

export function resolveModelRegistry(
  modelRegistries: SessionConfigModelRegistry[],
  agentKind: string | null | undefined,
): SessionConfigModelRegistry | null {
  if (!agentKind) {
    return null;
  }
  return modelRegistries.find((item) => item.kind === agentKind) ?? null;
}

export function resolveModelForRegistry(
  registry: SessionConfigModelRegistry,
  modelId: string | null | undefined,
): SessionConfigModel | null {
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
  registry: SessionConfigModelRegistry,
  modelId: string,
): SessionConfigModel | null {
  return (
    registry.models.find((model) => model.id === modelId)
    ?? registry.models.find((model) => model.aliases?.includes(modelId))
    ?? null
  );
}

function rowMatchesRegistryModel(
  rowId: string,
  model: SessionConfigModel,
): boolean {
  return rowId === model.id || (model.aliases ?? []).includes(rowId);
}

function resolveRegistryDefaultModel(registry: SessionConfigModelRegistry): SessionConfigModel | null {
  return (
    registry.models.find((model) => model.id === registry.defaultModelId)
    ?? registry.models.find((model) => model.isDefault)
    ?? registry.models[0]
    ?? null
  );
}

export function resolveModelInfo(
  modelRegistries: SessionConfigModelRegistry[],
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
  launchAgents: SessionLaunchAgent[],
  modelRegistries: SessionConfigModelRegistry[],
): SessionLaunchAgent[] {
  const registryByKind = new Map(modelRegistries.map((registry) => [registry.kind, registry]));

  return launchAgents.flatMap((agent) => {
    const registry = registryByKind.get(agent.kind);
    if (!registry) {
      return agent.models.length > 0 ? [agent] : [];
    }

    const decoratedModels = agent.models.map((model) => {
      const registryModel = resolveRegistryModelForRow(registry, model.id);
      return {
        ...model,
        id: model.id,
        displayName: registryModel?.displayName ?? model.displayName,
        isDefault: model.isDefault,
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
