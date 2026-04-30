import type {
  AgentSummary,
  ModelRegistry,
  ModelRegistryModel,
} from "@anyharness/sdk";
import { compareChatLaunchKinds } from "@/config/chat-launch";

export interface AgentModelSelection {
  kind: string;
  modelId: string;
}

export interface AgentModelOption extends AgentModelSelection {
  displayName: string;
  description: string | null;
  isDefault: boolean;
  isSelected: boolean;
}

export interface AgentModelGroup {
  kind: string;
  providerDisplayName: string;
  defaultModelId: string | null;
  models: AgentModelOption[];
}

export interface AgentModelInfo {
  kind: string;
  providerDisplayName: string;
  model: ModelRegistryModel;
}

export interface AgentModelPreferences {
  defaultAgentKind: string;
  defaultModelId: string;
}

interface BuildAgentModelGroupsInput {
  agents: AgentSummary[];
  modelRegistries: ModelRegistry[];
  selected: AgentModelSelection | null;
  isAgentKindAllowed?: (kind: string) => boolean;
  fallbackDisplayName?: (kind: string, agent: AgentSummary | null) => string;
}

export function buildAgentModelGroups({
  agents,
  modelRegistries,
  selected,
  isAgentKindAllowed,
  fallbackDisplayName,
}: BuildAgentModelGroupsInput): AgentModelGroup[] {
  const readyAgentsByKind = new Map(
    agents
      .filter((agent) =>
        agent.readiness === "ready"
        && (isAgentKindAllowed ? isAgentKindAllowed(agent.kind) : true)
      )
      .map((agent) => [agent.kind, agent]),
  );

  return modelRegistries
    .filter((registry) =>
      readyAgentsByKind.has(registry.kind)
      && registry.models.length > 0
    )
    .map((registry) => {
      const agent = readyAgentsByKind.get(registry.kind) ?? null;
      return {
        kind: registry.kind,
        providerDisplayName:
          registry.displayName
          || fallbackDisplayName?.(registry.kind, agent)
          || agent?.displayName
          || registry.kind,
        defaultModelId: registry.defaultModelId ?? null,
        models: registry.models.map((model) => ({
          kind: registry.kind,
          modelId: model.id,
          displayName: model.displayName,
          description: model.description ?? null,
          isDefault: model.isDefault,
          isSelected: selected?.kind === registry.kind && selected.modelId === model.id,
        })),
      } satisfies AgentModelGroup;
    })
    .sort((left, right) =>
      compareChatLaunchKinds(
        left.kind,
        right.kind,
        left.providerDisplayName,
        right.providerDisplayName,
      )
    );
}

export function findAgentModelSelection(
  groups: AgentModelGroup[],
  selection: AgentModelSelection | null | undefined,
): { group: AgentModelGroup; model: AgentModelOption } | null {
  if (!selection) {
    return null;
  }

  const group = groups.find((candidate) => candidate.kind === selection.kind) ?? null;
  const model = group?.models.find((candidate) => candidate.modelId === selection.modelId) ?? null;
  return group && model ? { group, model } : null;
}

export function defaultAgentModelForGroup(
  group: AgentModelGroup,
): AgentModelOption | null {
  return group.models.find((candidate) =>
    candidate.modelId === group.defaultModelId || candidate.isDefault
  ) ?? group.models[0] ?? null;
}

export function resolveEffectiveAgentModelSelection(
  groups: AgentModelGroup[],
  override: AgentModelSelection | null | undefined,
  preferences: AgentModelPreferences,
): AgentModelSelection | null {
  const explicitSelection = findAgentModelSelection(groups, override);
  if (explicitSelection) {
    return {
      kind: explicitSelection.group.kind,
      modelId: explicitSelection.model.modelId,
    };
  }

  const preferredSelection = findAgentModelSelection(groups, {
    kind: preferences.defaultAgentKind,
    modelId: preferences.defaultModelId,
  });
  if (preferredSelection) {
    return {
      kind: preferredSelection.group.kind,
      modelId: preferredSelection.model.modelId,
    };
  }

  for (const group of groups) {
    const model = defaultAgentModelForGroup(group);
    if (model) {
      return { kind: group.kind, modelId: model.modelId };
    }
  }

  return null;
}

export function resolveAgentModelInfo(
  groups: AgentModelGroup[],
  modelRegistries: ModelRegistry[],
  selection: AgentModelSelection | null | undefined,
): AgentModelInfo | null {
  if (!selection) {
    return null;
  }

  const group = groups.find((candidate) => candidate.kind === selection.kind);
  const registry = modelRegistries.find((candidate) => candidate.kind === selection.kind);
  const model = registry?.models.find((candidate) => candidate.id === selection.modelId);

  return group && model
    ? {
      kind: selection.kind,
      providerDisplayName: group.providerDisplayName,
      model,
    }
    : null;
}
