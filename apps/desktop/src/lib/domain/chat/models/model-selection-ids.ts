import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type { ModelSelectorSelection } from "@/lib/domain/chat/models/model-selector-types";
import {
  normalizeDefaultChatModelId,
} from "@/lib/domain/preferences/user/session-defaults";

export type ModelSelectionMatchKind = "none" | "direct" | "equivalent";

export function modelSelectionMatchesModel(
  selection: ModelSelectorSelection | null | undefined,
  agent: DesktopAgentLaunchAgent,
  agentKind: string,
  modelId: string,
): boolean {
  return resolveModelSelectionMatchKind(
    selection,
    agent,
    agentKind,
    modelId,
  ) !== "none";
}

export function resolveModelSelectionMatchKind(
  selection: ModelSelectorSelection | null | undefined,
  agent: DesktopAgentLaunchAgent,
  agentKind: string,
  modelId: string,
): ModelSelectionMatchKind {
  if (!selection || selection.kind !== agentKind) {
    return "none";
  }
  if (
    selection.modelId === modelId
    && !selectionIsLegacyClaudeOpusCatalogRow(agentKind, modelId)
  ) {
    return "direct";
  }

  const model = findLaunchModelByIdOrAlias(agent, modelId);
  if (!model) {
    return "none";
  }

  const selectionMatchesModel = modelIdLookupCandidates(
    agentKind,
    selection.modelId,
  ).some((candidate) =>
    model.id === candidate || model.aliases.includes(candidate)
  );
  if (
    !selectionIsLegacyClaudeOpusCatalogRow(agentKind, model.id)
    && selectionMatchesModel
  ) {
    return "direct";
  }

  const selectionEquivalenceKey = resolveModelSelectionEquivalenceKey(
    agentKind,
    selection.modelId,
  );
  if (!selectionEquivalenceKey) {
    return "none";
  }

  return [model.id, ...model.aliases].some(
    (candidate) => resolveModelCandidateEquivalenceKey(agentKind, candidate)
      === selectionEquivalenceKey,
  )
    ? "equivalent"
    : "none";
}

export function findLaunchModelByIdOrAlias(
  agent: DesktopAgentLaunchAgent,
  modelId: string,
): DesktopAgentLaunchModel | null {
  const candidates = modelIdLookupCandidates(agent.kind, modelId);
  return agent.models.find((model) =>
    candidates.some((candidate) =>
      model.id === candidate || model.aliases.includes(candidate)
    )
  ) ?? null;
}

export function selectedModelIdForVisibility(
  agentKind: string,
  modelId: string,
): string {
  if (agentKind === "claude") {
    if (
      modelId === "opus[1m]"
      || isClaudeOpus48LongContextAlias(modelId)
    ) {
      return "us.anthropic.claude-opus-4-8[1m]";
    }

    if (modelId === "claude-opus-4-8" || modelId === "us.anthropic.claude-opus-4-8") {
      return "us.anthropic.claude-opus-4-8";
    }
  }

  const normalizedModelId = normalizeLaunchModelId(agentKind, modelId);
  if (agentKind === "claude" && normalizedModelId === "opus[1m]") {
    return "us.anthropic.claude-opus-4-8[1m]";
  }
  return normalizedModelId;
}

export function normalizeLaunchModelId(agentKind: string, modelId: string): string {
  return normalizeDefaultChatModelId(agentKind, modelId);
}

export function modelIdLookupCandidates(agentKind: string, modelId: string): string[] {
  const normalizedModelId = normalizeLaunchModelId(agentKind, modelId);
  return normalizedModelId === modelId ? [modelId] : [modelId, normalizedModelId];
}

function resolveModelSelectionEquivalenceKey(
  agentKind: string,
  modelId: string,
): string | null {
  if (agentKind !== "claude") {
    return null;
  }

  if (modelId === "opus[1m]" || isClaudeOpus48LongContextAlias(modelId)) {
    return "claude:opus-4-8-1m";
  }

  if (modelId === "opus" || isClaudeOpus48ModelId(modelId)) {
    return "claude:opus-4-8";
  }

  return null;
}

function resolveModelCandidateEquivalenceKey(
  agentKind: string,
  modelId: string,
): string | null {
  if (agentKind !== "claude") {
    return null;
  }

  if (isClaudeOpus48LongContextAlias(modelId)) {
    return "claude:opus-4-8-1m";
  }

  return isClaudeOpus48ModelId(modelId) ? "claude:opus-4-8" : null;
}

function selectionIsLegacyClaudeOpusCatalogRow(
  agentKind: string,
  modelId: string,
): boolean {
  return agentKind === "claude" && modelId === "opus";
}

function isClaudeOpus48ModelId(modelId: string): boolean {
  return /^us\.anthropic\.claude-opus-4-8(?:$|[-:])/.test(modelId)
    || /^claude-opus-4-8(?:$|[-:])/.test(modelId);
}

function isClaudeOpus48LongContextAlias(modelId: string): boolean {
  return modelId === "us.anthropic.claude-opus-4-8[1m]"
    || modelId === "claude-opus-4-8-1m";
}
