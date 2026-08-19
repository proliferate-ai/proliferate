import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import {
  findLaunchModelById,
} from "#product/lib/domain/chat/models/model-selection-ids";
import type {
  ChatLaunchPreferences,
  ModelSelectorSelection,
} from "#product/lib/domain/chat/models/model-selector-types";

export function resolveEffectiveLaunchSelection(
  agents: DesktopAgentLaunchAgent[],
  preferences: ChatLaunchPreferences,
  requestedAgentKind?: string | null,
): ModelSelectorSelection | null {
  const effectiveKind = requestedAgentKind || preferences.defaultChatAgentKind || "";
  const preferredAgent = effectiveKind
    ? agents.find((agent) => agent.kind === effectiveKind && agent.models.length > 0)
    : undefined;
  return preferredAgent ? resolveAgentLaunchSelection(preferredAgent, preferences) : null;
}

export function launchSelectionIsAvailable(
  agents: readonly DesktopAgentLaunchAgent[],
  selection: ModelSelectorSelection | null | undefined,
): boolean {
  return resolveLaunchableModelSelection(agents, selection) !== null;
}

export function resolveLaunchableModelSelection(
  agents: readonly DesktopAgentLaunchAgent[],
  selection: ModelSelectorSelection | null | undefined,
): ModelSelectorSelection | null {
  if (!selection) {
    return null;
  }

  const agent = agents.find((candidate) => candidate.kind === selection.kind);
  if (!agent) {
    return null;
  }

  const catalogModel = findLaunchModelById(agent, selection.modelId);
  if (catalogModel) {
    return {
      kind: selection.kind,
      modelId: catalogModel.id,
    };
  }

  return null;
}

export function resolveAvailableLaunchSelection(
  agents: readonly DesktopAgentLaunchAgent[],
  preferredSelection: ModelSelectorSelection | null | undefined,
  fallbackSelection: ModelSelectorSelection | null | undefined,
  options?: { requirePreferredSelection?: boolean },
): ModelSelectorSelection | null {
  const preferred = resolveLaunchableModelSelection(agents, preferredSelection);
  if (preferred || options?.requirePreferredSelection) {
    return preferred;
  }
  return resolveLaunchableModelSelection(agents, fallbackSelection);
}

export function resolveConfiguredLaunchAgentSelection(
  agents: DesktopAgentLaunchAgent[],
  preferences: ChatLaunchPreferences,
): ModelSelectorSelection | null {
  if (!preferences.defaultChatAgentKind) {
    return null;
  }

  const preferredAgent = agents.find((agent) => agent.kind === preferences.defaultChatAgentKind);
  if (preferredAgent) {
    return resolveAgentLaunchSelection(preferredAgent, preferences);
  }

  return null;
}

function resolveAgentLaunchSelection(
  agent: DesktopAgentLaunchAgent,
  preferences: ChatLaunchPreferences,
): ModelSelectorSelection | null {
  const preferredModelId = preferences.defaultChatModelIdByAgentKind[agent.kind]?.trim();
  if (preferredModelId) {
    const preferredModel = findLaunchModelById(agent, preferredModelId);
    if (preferredModel) {
      return {
        kind: agent.kind,
        modelId: preferredModel.id,
      };
    }
  }

  const model = resolveDefaultAgentModel(agent);
  return model
    ? {
      kind: agent.kind,
      modelId: model.id,
    }
    : null;
}

function resolveDefaultAgentModel(
  agent: DesktopAgentLaunchAgent,
): DesktopAgentLaunchModel | undefined {
  return agent.models.find((model) => model.id === agent.defaultModelId);
}
