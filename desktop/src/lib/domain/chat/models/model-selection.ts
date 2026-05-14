import type { AgentSummary } from "@anyharness/sdk";
import {
  resolveModelDisplayName,
  shouldHideModel,
} from "@/lib/domain/chat/models/model-display";
import type { PendingSessionConfigChangeStatus } from "@/lib/domain/sessions/pending-config";
import {
  dynamicLaunchAgentAcceptsModel,
  type DesktopAgentLaunchAgent,
  type DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import {
  filterVisibleLaunchModels,
} from "@/lib/domain/chat/models/model-visibility";
import type { ChatModelVisibilityOverridesByAgentKind } from "@/lib/domain/preferences/user/session-defaults";

export interface ModelSelectorSelection {
  kind: string;
  modelId: string;
}

export interface ChatLaunchPreferences {
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
  chatModelVisibilityOverridesByAgentKind?: ChatModelVisibilityOverridesByAgentKind;
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

export interface ActiveModelSelectorControl {
  kind: string;
  values: ReadonlyArray<{
    value: string;
    label: string;
    description?: string | null;
  }>;
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
  agents: DesktopAgentLaunchAgent[],
  preferences: ChatLaunchPreferences,
): ModelSelectorSelection | null {
  const visibleAgents = agentsWithVisibleModels(agents, preferences, null);
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
      agentWithVisibleModels(preferredAgent, preferences, null),
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
    const preferredModel =
      agent.models.find((model) => model.id === preferredModelId)
      ?? agent.models.find((model) => model.aliases.includes(preferredModelId))
      ?? null;
    if (preferredModel) {
      return {
        kind: agent.kind,
        modelId: preferredModel.id,
      };
    }
    const knownSourceModel =
      sourceAgent.models.find((model) => model.id === preferredModelId)
      ?? sourceAgent.models.find((model) => model.aliases.includes(preferredModelId))
      ?? null;
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

export function buildModelSelectorGroups(
  agents: DesktopAgentLaunchAgent[],
  selected: ModelSelectorSelection | null,
  activeSelection: ModelSelectorSelection | null | undefined,
  activeModelControl?: ActiveModelSelectorControl | null,
  visibilityOverrides: ChatModelVisibilityOverridesByAgentKind = {},
): ModelSelectorGroup[] {
  const sourceAgentsByKind = new Map(agents.map((agent) => [agent.kind, agent]));
  return agentsWithVisibleModels(agents, { chatModelVisibilityOverridesByAgentKind: visibilityOverrides }, selected)
    .map((agent) => ({
    kind: agent.kind,
    providerDisplayName: agent.displayName,
    models: resolveSelectorModels(
      agent,
      activeModelControl,
      selected,
      sourceAgentsByKind.get(agent.kind) ?? agent,
    ).map((model) => ({
      kind: agent.kind,
      modelId: model.id,
      displayName: model.displayName,
      actionKind: resolveModelSelectionActionKindForModel(
        activeSelection,
        sourceAgentsByKind.get(agent.kind) ?? agent,
        agent.kind,
        model.id,
      ),
      isSelected: modelSelectionMatchesModel(
        selected,
        sourceAgentsByKind.get(agent.kind) ?? agent,
        agent.kind,
        model.id,
      ),
    })),
  }));
}

function resolveSelectorModels(
  agent: DesktopAgentLaunchAgent,
  activeModelControl: ActiveModelSelectorControl | null | undefined,
  selected: ModelSelectorSelection | null,
  sourceAgent: DesktopAgentLaunchAgent,
): Array<{ id: string; displayName: string }> {
  if (activeModelControl?.kind === agent.kind && activeModelControl.values.length > 0) {
    return activeModelControl.values.flatMap((value) => {
      const isSelected = modelSelectionMatchesModel(
        selected,
        sourceAgent,
        agent.kind,
        value.value,
      );
      const knownModel = findLaunchModelByIdOrAlias(sourceAgent, value.value);
      const visibleModel = findLaunchModelByIdOrAlias(agent, value.value);
      const isFilteredByVisibility =
        Boolean(knownModel) && !visibleModel;
      const isUnknownDynamicModel =
        !knownModel && dynamicLaunchAgentAcceptsModel(sourceAgent);
      const isHiddenByProductPolicy = shouldHideSelectorModel(agent.kind, value);
      if (
        (isFilteredByVisibility || isUnknownDynamicModel || isHiddenByProductPolicy)
        && !isSelected
      ) {
        return [];
      }

      const displayName = resolveModelDisplayName({
        agentKind: agent.kind,
        modelId: value.value,
        sourceLabels: [value.label],
        preferKnownAlias: !isHiddenByProductPolicy,
      }) ?? value.label;

      return [{
        id: value.value,
        displayName,
      }];
    });
  }

  return agent.models;
}

function resolveModelSelectionActionKindForModel(
  activeSelection: ModelSelectorSelection | null | undefined,
  agent: DesktopAgentLaunchAgent,
  agentKind: string,
  modelId: string,
): ModelSelectionActionKind {
  if (!activeSelection) {
    return "select";
  }
  if (activeSelection.kind !== agentKind) {
    return "open_new_chat";
  }
  return modelSelectionMatchesModel(activeSelection, agent, agentKind, modelId)
    ? "select"
    : "update_current_chat";
}

function modelSelectionMatchesModel(
  selection: ModelSelectorSelection | null | undefined,
  agent: DesktopAgentLaunchAgent,
  agentKind: string,
  modelId: string,
): boolean {
  if (!selection || selection.kind !== agentKind) {
    return false;
  }
  if (selection.modelId === modelId) {
    return true;
  }

  const model = findLaunchModelByIdOrAlias(agent, modelId);
  return Boolean(
    model
    && (
      model.id === selection.modelId
      || model.aliases.includes(selection.modelId)
    ),
  );
}

function findLaunchModelByIdOrAlias(
  agent: DesktopAgentLaunchAgent,
  modelId: string,
): DesktopAgentLaunchModel | null {
  return agent.models.find((model) =>
    model.id === modelId || model.aliases.includes(modelId)
  ) ?? null;
}

function agentsWithVisibleModels(
  agents: DesktopAgentLaunchAgent[],
  preferences: Pick<ChatLaunchPreferences, "chatModelVisibilityOverridesByAgentKind">,
  selected: ModelSelectorSelection | null,
): DesktopAgentLaunchAgent[] {
  return agents
    .map((agent) => agentWithVisibleModels(agent, preferences, selected))
    .filter((agent) => agent.models.length > 0);
}

function agentWithVisibleModels(
  agent: DesktopAgentLaunchAgent,
  preferences: Pick<ChatLaunchPreferences, "chatModelVisibilityOverridesByAgentKind">,
  selected: ModelSelectorSelection | null,
): DesktopAgentLaunchAgent {
  return {
    ...agent,
    models: filterVisibleLaunchModels({
      agent,
      selectedModelId: selected?.kind === agent.kind ? selected.modelId : null,
      overrides: preferences.chatModelVisibilityOverridesByAgentKind ?? {},
    }),
  };
}

function shouldHideSelectorModel(
  agentKind: string,
  value: ActiveModelSelectorControl["values"][number],
): boolean {
  if (shouldHideModel(agentKind, value.value)) {
    return true;
  }

  if (agentKind !== "claude") {
    return false;
  }

  const label = value.label.toLowerCase();
  return /\bopus\s*4\.1\b/.test(label)
    || /\bopus\s*4\.5\b/.test(label)
    || (/\bopus\s*4\.6\b/.test(label) && /\b1m\b|1m context/.test(label));
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
