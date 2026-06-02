import {
  dynamicLaunchAgentAcceptsModel,
  type DesktopAgentLaunchAgent,
  type DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { agentsWithVisibleModels, agentWithVisibleModels } from "@/lib/domain/chat/models/launch-visible-agents";
import { findLaunchModelByIdOrAlias } from "@/lib/domain/chat/models/model-selection-ids";
import type {
  ChatLaunchPreferences,
  ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selector-types";

export function resolveEffectiveLaunchSelection(
  agents: DesktopAgentLaunchAgent[],
  preferences: ChatLaunchPreferences,
): ModelSelectorSelection | null {
  const visibleAgents = agentsWithVisibleModels(agents, {
    selected: null,
    visibilityOverrides: preferences.chatModelVisibilityOverridesByAgentKind,
  });
  const sourceAgentsByKind = new Map(agents.map((agent) => [agent.kind, agent]));
  const preferredAgent = visibleAgents.find((agent) => agent.kind === preferences.defaultChatAgentKind);
  if (preferredAgent) {
    const selection = resolveAgentLaunchSelection(
      preferredAgent,
      preferences,
      sourceAgentsByKind.get(preferredAgent.kind),
    );
    if (selection) {
      return selection;
    }
  }

  for (const agent of visibleAgents) {
    const selection = resolveAgentLaunchSelection(
      agent,
      preferences,
      sourceAgentsByKind.get(agent.kind),
    );
    if (selection) {
      return selection;
    }
  }

  return null;
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

  const catalogModel = findLaunchModelByIdOrAlias(agent, selection.modelId);
  if (catalogModel) {
    return {
      kind: selection.kind,
      modelId: catalogModel.id,
    };
  }

  if (dynamicLaunchAgentAcceptsModel(agent)) {
    const modelId = selection.modelId.trim();
    return modelId
      ? {
        kind: selection.kind,
        modelId,
      }
      : null;
  }

  return null;
}

export function resolveAvailableLaunchSelection(
  agents: readonly DesktopAgentLaunchAgent[],
  preferredSelection: ModelSelectorSelection | null | undefined,
  fallbackSelection: ModelSelectorSelection | null | undefined,
): ModelSelectorSelection | null {
  return resolveLaunchableModelSelection(agents, preferredSelection)
    ?? resolveLaunchableModelSelection(agents, fallbackSelection);
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
    return resolveAgentLaunchSelection(
      agentWithVisibleModels(preferredAgent, {
        selected: null,
        visibilityOverrides: preferences.chatModelVisibilityOverridesByAgentKind,
      }),
      preferences,
      preferredAgent,
    );
  }

  return null;
}

function resolveAgentLaunchSelection(
  agent: DesktopAgentLaunchAgent,
  preferences: ChatLaunchPreferences,
  sourceAgent: DesktopAgentLaunchAgent = agent,
): ModelSelectorSelection | null {
  const preferredModelId = preferences.defaultChatModelIdByAgentKind[agent.kind]?.trim();
  if (preferredModelId) {
    const preferredModel = findLaunchModelByIdOrAlias(agent, preferredModelId);
    if (preferredModel) {
      return {
        kind: agent.kind,
        modelId: preferredModel.id,
      };
    }
    const knownSourceModel = findLaunchModelByIdOrAlias(sourceAgent, preferredModelId);
    if (!knownSourceModel && dynamicLaunchAgentAcceptsModel(agent)) {
      return {
        kind: agent.kind,
        modelId: preferredModelId,
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
  return agent.models.find((model) =>
    model.id === agent.defaultModelId || model.isDefault,
  ) ?? agent.models[0];
}
