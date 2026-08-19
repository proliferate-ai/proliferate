import type {
  DesktopAgentCatalogStatus,
  DesktopSessionDefaultControl,
} from "#product/lib/domain/agents/cloud-launch-catalog";

export interface SessionConfigModel {
  id: string;
  displayName: string;
  description?: string | null;
  aliases?: string[];
  status?: DesktopAgentCatalogStatus;
  isDefault: boolean;
  sessionDefaultControls?: DesktopSessionDefaultControl[];
}

export interface SessionConfigModelRegistry {
  kind: string;
  displayName: string;
  defaultModelId?: string | null;
  models: SessionConfigModel[];
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
  return registry?.defaultModelId ?? undefined;
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
    (normalizedModelId
      ? registry.models.find((model) => model.id === normalizedModelId) ?? null
      : null)
    ?? registry.models.find((model) => model.id === registry.defaultModelId)
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
