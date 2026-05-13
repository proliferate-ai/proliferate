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
  return agent.models.filter((model) =>
    model.id === selectedModelId
    || isModelVisibleByPreference(
      agent.kind,
      model.id,
      resolveCatalogDefaultOptIn(agent, model),
      overrides,
    )
  );
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
  return registry.models.filter((model) =>
    model.id === selectedModelId
    || isModelVisibleByPreference(
      registry.kind,
      model.id,
      resolveRegistryModelCatalogDefaultOptIn(model),
      overrides,
    )
  );
}

export function withUpdatedModelVisibilityOverride(
  current: ChatModelVisibilityOverridesByAgentKind,
  agentKind: string,
  modelId: string,
  visible: boolean,
): ChatModelVisibilityOverridesByAgentKind {
  const trimmedAgentKind = agentKind.trim();
  const trimmedModelId = modelId.trim();
  if (!trimmedAgentKind || !trimmedModelId) {
    return current;
  }

  return {
    ...current,
    [trimmedAgentKind]: {
      ...(current[trimmedAgentKind] ?? {}),
      [trimmedModelId]: visible,
    },
  };
}
