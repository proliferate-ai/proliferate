import type { UserPreferences } from "@/lib/domain/preferences/user/model";
import {
  DEFAULT_OPEN_IN_TARGET_ID,
  FALLBACK_OPEN_IN_TARGET_ID,
} from "@/config/open-target-defaults";
import {
  buildAgentModelGroups,
  defaultAgentModelForGroup,
  findAgentModelSelection,
  preferredAgentModelForGroup,
  resolveEffectiveAgentModelSelection,
  type AgentCatalogSummary,
  type AgentModelGroup,
  type AgentModelRegistry,
  type AgentModelOption,
} from "@/lib/domain/agents/model-options";
import {
  resolveConfiguredLaunchAgentSelection,
} from "@/lib/domain/chat/models/launch-selection-defaults";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";

export interface ChatDefaultPreferences {
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
}

export interface EffectiveChatDefaults {
  agentKind: string;
  modelId: string;
  modelDisplayName: string;
  degraded: boolean;
  degradedReason: string | null;
}

interface ExplicitSelection {
  kind: string;
  modelId: string;
}

export interface ConfiguredLaunchSelection {
  kind: string;
  modelId: string;
}

export interface ConfiguredLaunchResolution {
  selection: ConfiguredLaunchSelection | null;
  displayName: string | null;
  reason: string | null;
  status: "missing" | "ready" | "unavailable";
}

function findModelById<T extends { id: string }>(
  models: readonly T[],
  modelId: string,
): T | null {
  return models.find((model) => model.id === modelId) ?? null;
}

export function resolveEffectiveChatDefaults(
  modelRegistries: AgentModelRegistry[],
  agents: AgentCatalogSummary[],
  prefs: ChatDefaultPreferences,
  explicit?: ExplicitSelection | null,
): EffectiveChatDefaults {
  const groups = buildAgentModelGroups({
    agents,
    modelRegistries,
    selected: null,
  });

  const explicitSelection = findAgentModelSelection(groups, explicit);
  if (explicitSelection) {
    return buildResult(explicitSelection.group, explicitSelection.model, false, null);
  }

  const selection = resolveEffectiveAgentModelSelection(groups, null, {
    defaultAgentKind: prefs.defaultChatAgentKind,
    defaultModelIdByAgentKind: prefs.defaultChatModelIdByAgentKind,
  });
  if (selection) {
    const group = groups.find((candidate) => candidate.kind === selection.kind) ?? null;
    const model = group?.models.find((candidate) => candidate.modelId === selection.modelId) ?? null;
    if (!group || !model) {
      return emptyChatDefaults(prefs, "No ready agents found");
    }

    const degraded = resolveChatDefaultsDegradedState(groups, prefs, group, model);
    return buildResult(
      group,
      model,
      degraded.degraded,
      degraded.reason,
    );
  }

  return emptyChatDefaults(prefs, "No ready agents found");
}

export function resolveConfiguredLaunchSelection(
  launchAgents: DesktopAgentLaunchAgent[],
  prefs: ChatDefaultPreferences,
): ConfiguredLaunchResolution {
  if (!prefs.defaultChatAgentKind) {
    return {
      selection: null,
      displayName: null,
      reason: "Choose a default agent and model before starting a chat.",
      status: "missing",
    };
  }

  const preferredModelId = prefs.defaultChatModelIdByAgentKind[prefs.defaultChatAgentKind] ?? "";
  const launchAgent = launchAgents.find(
    (agent) => agent.kind === prefs.defaultChatAgentKind,
  ) ?? null;
  const launchSelection = resolveConfiguredLaunchAgentSelection(launchAgents, prefs);
  const launchModel = launchAgent && launchSelection
    ? findModelById(launchAgent.models, launchSelection.modelId)
    : null;
  const displayName = launchModel?.displayName
    ?? (preferredModelId || null);

  if (launchAgent && launchSelection && launchModel) {
    return {
      selection: {
        kind: launchAgent.kind,
        modelId: launchModel?.id ?? launchSelection.modelId,
      },
      displayName,
      reason: null,
      status: "ready",
    };
  }

  if (launchAgent) {
    return {
      selection: null,
      displayName: null,
      reason: `No launchable model is available for ${launchAgent.displayName}.`,
      status: "unavailable",
    };
  }

  return {
    selection: null,
    displayName,
    reason: `${prefs.defaultChatAgentKind} is not ready yet.`,
    status: "unavailable",
  };
}

function buildResult(
  group: AgentModelGroup,
  model: AgentModelOption,
  degraded: boolean,
  degradedReason: string | null,
): EffectiveChatDefaults {
  return {
    agentKind: group.kind,
    modelId: model.modelId,
    modelDisplayName: model.displayName,
    degraded,
    degradedReason,
  };
}

function resolveChatDefaultsDegradedState(
  groups: AgentModelGroup[],
  prefs: ChatDefaultPreferences,
  selectedGroup: AgentModelGroup,
  selectedModel: AgentModelOption,
): { degraded: boolean; reason: string | null } {
  if (!prefs.defaultChatAgentKind) {
    return { degraded: false, reason: null };
  }

  if (selectedGroup.kind !== prefs.defaultChatAgentKind) {
    return {
      degraded: true,
      reason: `${prefs.defaultChatAgentKind} is not ready; using ${selectedGroup.kind} as fallback`,
    };
  }

  const preferredModelId = prefs.defaultChatModelIdByAgentKind[selectedGroup.kind];
  if (
    preferredModelId
    && preferredModelId !== selectedModel.modelId
    && !preferredAgentModelForGroup(selectedGroup, prefs.defaultChatModelIdByAgentKind)
  ) {
    return {
      degraded: true,
      reason: `Stored default model is no longer available for ${selectedGroup.kind}; using ${selectedModel.displayName}`,
    };
  }

  const preferredGroup = groups.find((group) => group.kind === prefs.defaultChatAgentKind) ?? null;
  if (preferredGroup && !defaultAgentModelForGroup(preferredGroup)) {
    return {
      degraded: true,
      reason: `No launchable model is available for ${preferredGroup.providerDisplayName}.`,
    };
  }

  return { degraded: false, reason: null };
}

function emptyChatDefaults(
  prefs: ChatDefaultPreferences,
  degradedReason: string,
): EffectiveChatDefaults {
  const agentKind = prefs.defaultChatAgentKind || "";
  return {
    agentKind,
    modelId: agentKind ? prefs.defaultChatModelIdByAgentKind[agentKind] ?? "" : "",
    modelDisplayName: "No agents available",
    degraded: true,
    degradedReason,
  };
}

export function resolvePreferredOpenTarget<T extends { id: string; kind?: string }>(
  targets: T[],
  prefs: Pick<UserPreferences, "defaultOpenInTargetId">,
): T | null {
  const preferredId = prefs.defaultOpenInTargetId.trim();
  const preferred = preferredId
    ? targets.find((target) => target.id === preferredId)
    : undefined;
  if (preferred) return preferred;
  return targets.find((target) => target.id === DEFAULT_OPEN_IN_TARGET_ID)
    ?? targets.find((target) => target.kind === "editor")
    ?? targets.find((target) => target.id === FALLBACK_OPEN_IN_TARGET_ID)
    ?? targets[0]
    ?? null;
}
