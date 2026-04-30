import type { AgentSummary, ModelRegistry } from "@anyharness/sdk";
import {
  AUTOMATION_AGENT_KIND_LABELS,
  AUTOMATION_SUPPORTED_AGENT_KINDS,
  type AutomationSupportedAgentKind,
} from "@/config/automations";
import {
  buildAgentModelGroups,
  defaultAgentModelForGroup,
  findAgentModelSelection,
  resolveEffectiveAgentModelSelection,
  type AgentModelGroup,
  type AgentModelOption,
  type AgentModelSelection,
} from "@/lib/domain/agents/model-options";

export type AutomationModelSelection = AgentModelSelection;

export interface AutomationModelOverride {
  kind: string;
  modelId: string | null;
}

export interface AutomationModelPreferences {
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
}

export interface AutomationSavedModelValue {
  agentKind: string | null;
  modelId: string | null;
}

export type AutomationModelOption = AgentModelOption;
export type AutomationModelGroup = AgentModelGroup;

export type AutomationModelUnavailableReason =
  | "missingAgent"
  | "unsupportedAgent"
  | "modelUnavailable";

interface AutomationModelSubmission {
  agentKind: string | null;
  modelId: string | null;
  canSubmit: boolean;
}

export type AutomationModelResolution =
  | {
    state: "selected";
    source: "saved" | "override";
    selection: AutomationModelSelection;
    group: AutomationModelGroup;
    model: AutomationModelOption;
    submission: AutomationModelSubmission & { agentKind: string; modelId: string };
  }
  | {
    state: "default";
    source: "create" | "savedNull" | "overrideNull";
    selection: AutomationModelSelection | null;
    group: AutomationModelGroup | null;
    model: AutomationModelOption | null;
    submission: AutomationModelSubmission & { agentKind: string; modelId: string | null };
  }
  | {
    state: "savedUnavailable";
    reason: AutomationModelUnavailableReason;
    savedAgentKind: string | null;
    savedModelId: string | null;
    submission: AutomationModelSubmission;
  }
  | {
    state: "none";
    submission: AutomationModelSubmission & { agentKind: null; modelId: null; canSubmit: false };
  };

const SUPPORTED_AGENT_KIND_SET = new Set<string>(AUTOMATION_SUPPORTED_AGENT_KINDS);

export function isAutomationSupportedAgentKind(
  kind: string | null | undefined,
): kind is AutomationSupportedAgentKind {
  return !!kind && SUPPORTED_AGENT_KIND_SET.has(kind);
}

export function automationAgentDisplayName(kind: string | null | undefined): string {
  if (isAutomationSupportedAgentKind(kind)) {
    return AUTOMATION_AGENT_KIND_LABELS[kind];
  }
  return kind || "Unknown agent";
}

export function buildAutomationModelGroups(
  agents: AgentSummary[],
  modelRegistries: ModelRegistry[],
  selected: AutomationModelSelection | null,
): AutomationModelGroup[] {
  return buildAgentModelGroups({
    agents,
    modelRegistries,
    selected,
    isAgentKindAllowed: isAutomationSupportedAgentKind,
    fallbackDisplayName: (kind) => automationAgentDisplayName(kind),
  });
}

export function resolveAutomationModelSelection({
  groups,
  saved,
  override,
  preferences,
  isEditing,
}: {
  groups: AutomationModelGroup[];
  saved: AutomationSavedModelValue;
  override: AutomationModelOverride | null;
  preferences: AutomationModelPreferences;
  isEditing: boolean;
}): AutomationModelResolution {
  if (override && !override.modelId) {
    return resolveNullModelOverride(groups, override);
  }

  const overrideMatch = resolveConcreteSelection(groups, override);
  if (overrideMatch) {
    return selectedResolution("override", overrideMatch.group, overrideMatch.model);
  }

  if (isEditing) {
    return resolveSavedModel(groups, saved);
  }

  const preferredSelection = resolveEffectiveAgentModelSelection(groups, null, {
    defaultAgentKind: preferences.defaultChatAgentKind,
    defaultModelIdByAgentKind: preferences.defaultChatModelIdByAgentKind,
  });
  const preferredMatch = resolveConcreteSelection(groups, preferredSelection);
  if (preferredMatch) {
    return defaultResolution("create", preferredMatch.group, preferredMatch.model);
  }

  for (const group of groups) {
    const model = defaultModelForGroup(group);
    if (model) {
      return defaultResolution("create", group, model);
    }
  }

  return {
    state: "none",
    submission: {
      agentKind: null,
      modelId: null,
      canSubmit: false,
    },
  };
}

function resolveNullModelOverride(
  groups: AutomationModelGroup[],
  override: AutomationModelOverride,
): AutomationModelResolution {
  if (!isAutomationSupportedAgentKind(override.kind)) {
    return savedUnavailableResolution(
      "unsupportedAgent",
      { agentKind: override.kind, modelId: null },
      false,
    );
  }

  const group = groups.find((candidate) => candidate.kind === override.kind) ?? null;
  return {
    state: "default",
    source: "overrideNull",
    selection: null,
    group,
    model: group ? defaultModelForGroup(group) : null,
    submission: {
      agentKind: override.kind,
      modelId: null,
      canSubmit: true,
    },
  };
}

function resolveSavedModel(
  groups: AutomationModelGroup[],
  saved: AutomationSavedModelValue,
): AutomationModelResolution {
  if (!saved.agentKind) {
    return savedUnavailableResolution("missingAgent", saved, false);
  }

  if (!isAutomationSupportedAgentKind(saved.agentKind)) {
    return savedUnavailableResolution("unsupportedAgent", saved, false);
  }

  const group = groups.find((candidate) => candidate.kind === saved.agentKind) ?? null;

  if (!saved.modelId) {
    return {
      state: "default",
      source: "savedNull",
      selection: null,
      group,
      model: group ? defaultModelForGroup(group) : null,
      submission: {
        agentKind: saved.agentKind,
        modelId: null,
        canSubmit: true,
      },
    };
  }

  const model = group?.models.find((candidate) => candidate.modelId === saved.modelId) ?? null;
  if (group && model) {
    return selectedResolution("saved", group, model);
  }

  return savedUnavailableResolution("modelUnavailable", saved, true);
}

function resolveConcreteSelection(
  groups: AutomationModelGroup[],
  selection: AutomationModelOverride | null | undefined,
): { group: AutomationModelGroup; model: AutomationModelOption } | null {
  if (!selection?.modelId) {
    return null;
  }

  return findAgentModelSelection(groups, {
    kind: selection.kind,
    modelId: selection.modelId,
  });
}

function defaultModelForGroup(group: AutomationModelGroup): AutomationModelOption | null {
  return defaultAgentModelForGroup(group);
}

function selectedResolution(
  source: "saved" | "override",
  group: AutomationModelGroup,
  model: AutomationModelOption,
): Extract<AutomationModelResolution, { state: "selected" }> {
  return {
    state: "selected",
    source,
    selection: { kind: group.kind, modelId: model.modelId },
    group,
    model,
    submission: {
      agentKind: group.kind,
      modelId: model.modelId,
      canSubmit: true,
    },
  };
}

function defaultResolution(
  source: "create",
  group: AutomationModelGroup,
  model: AutomationModelOption,
): Extract<AutomationModelResolution, { state: "default" }> {
  return {
    state: "default",
    source,
    selection: { kind: group.kind, modelId: model.modelId },
    group,
    model,
    submission: {
      agentKind: group.kind,
      modelId: model.modelId,
      canSubmit: true,
    },
  };
}

function savedUnavailableResolution(
  reason: AutomationModelUnavailableReason,
  saved: AutomationSavedModelValue,
  canSubmit: boolean,
): Extract<AutomationModelResolution, { state: "savedUnavailable" }> {
  return {
    state: "savedUnavailable",
    reason,
    savedAgentKind: saved.agentKind,
    savedModelId: saved.modelId,
    submission: {
      agentKind: saved.agentKind,
      modelId: saved.modelId,
      canSubmit,
    },
  };
}
