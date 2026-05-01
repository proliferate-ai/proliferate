import type { AgentSummary, WorkspaceSessionLaunchAgent } from "@anyharness/sdk";
import type { PendingSessionConfigChangeStatus } from "@/lib/domain/sessions/pending-config";

export interface ModelSelectorSelection {
  kind: string;
  modelId: string;
}

export interface ChatLaunchPreferences {
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
}

export type ModelSelectionActionKind =
  | "select"
  | "update_current_chat"
  | "open_new_chat";

export interface ModelSelectorItem {
  kind: string;
  modelId: string;
  displayName: string;
  actionKind: ModelSelectionActionKind;
  isSelected: boolean;
}

export interface ModelSelectorGroup {
  kind: string;
  providerDisplayName: string;
  models: ModelSelectorItem[];
}

export interface ModelSelectorCurrentModel {
  kind: string;
  displayName: string;
  pendingState: PendingSessionConfigChangeStatus | null;
}

export interface ModelSelectorProps {
  connectionState: string;
  currentModel: ModelSelectorCurrentModel | null;
  groups: ModelSelectorGroup[];
  hasAgents: boolean;
  isLoading: boolean;
  notReadyAgents: AgentSummary[];
  onSelect: (selection: ModelSelectorSelection) => void;
}

export function resolveModelSelectionActionKind(
  activeSelection: ModelSelectorSelection | null | undefined,
  agentKind: string,
  modelId: string,
): ModelSelectionActionKind {
  if (!activeSelection) {
    return "select";
  }
  if (activeSelection.kind !== agentKind) {
    return "open_new_chat";
  }
  if (activeSelection.modelId !== modelId) {
    return "update_current_chat";
  }
  return "select";
}

export function resolveEffectiveLaunchSelection(
  agents: WorkspaceSessionLaunchAgent[],
  preferences: ChatLaunchPreferences,
): ModelSelectorSelection | null {
  const preferredAgent = agents.find((agent) => agent.kind === preferences.defaultChatAgentKind);
  if (preferredAgent) {
    const preferredModelId = preferences.defaultChatModelIdByAgentKind[preferredAgent.kind];
    const preferredModel = preferredModelId
      ? preferredAgent.models.find((model) => model.id === preferredModelId) ?? null
      : null;
    const model = preferredModel ?? resolveDefaultAgentModel(preferredAgent);
    if (model) {
      return {
        kind: preferredAgent.kind,
        modelId: model.id,
      };
    }
  }

  for (const agent of agents) {
    const preferredModelId = preferences.defaultChatModelIdByAgentKind[agent.kind];
    const preferredModel = preferredModelId
      ? agent.models.find((model) => model.id === preferredModelId) ?? null
      : null;
    const model = preferredModel ?? resolveDefaultAgentModel(agent);
    if (model) {
      return {
        kind: agent.kind,
        modelId: model.id,
      };
    }
  }

  return null;
}

export function resolveConfiguredLaunchAgentSelection(
  agents: WorkspaceSessionLaunchAgent[],
  preferences: ChatLaunchPreferences,
): ModelSelectorSelection | null {
  if (!preferences.defaultChatAgentKind) {
    return null;
  }

  const preferredAgent = agents.find((agent) => agent.kind === preferences.defaultChatAgentKind);
  if (preferredAgent) {
    const preferredModelId = preferences.defaultChatModelIdByAgentKind[preferredAgent.kind];
    const preferredModel = preferredModelId
      ? preferredAgent.models.find((model) => model.id === preferredModelId) ?? null
      : null;
    const model = preferredModel ?? resolveDefaultAgentModel(preferredAgent);
    if (model) {
      return {
        kind: preferredAgent.kind,
        modelId: model.id,
      };
    }
  }

  return null;
}

function resolveDefaultAgentModel(
  agent: WorkspaceSessionLaunchAgent,
) {
  return agent.models.find((model) =>
    model.id === agent.defaultModelId || model.isDefault,
  ) ?? agent.models[0];
}

export function buildModelSelectorGroups(
  agents: WorkspaceSessionLaunchAgent[],
  selected: ModelSelectorSelection | null,
  activeSelection: ModelSelectorSelection | null | undefined,
): ModelSelectorGroup[] {
  return agents.map((agent) => ({
    kind: agent.kind,
    providerDisplayName: agent.displayName,
    models: agent.models.map((model) => ({
      kind: agent.kind,
      modelId: model.id,
      displayName: model.displayName,
      actionKind: resolveModelSelectionActionKind(activeSelection, agent.kind, model.id),
      isSelected:
        selected?.kind === agent.kind && selected?.modelId === model.id,
    })),
  }));
}

export function filterModelSelectorGroups(
  groups: ModelSelectorGroup[],
  query: string,
): ModelSelectorGroup[] {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return groups;
  }

  return groups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        model.displayName.toLowerCase().includes(trimmedQuery)
        || model.modelId.toLowerCase().includes(trimmedQuery)
        || group.providerDisplayName.toLowerCase().includes(trimmedQuery),
      ),
    }))
    .filter((group) => group.models.length > 0);
}
