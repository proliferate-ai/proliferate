import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import type { ModelSelectorSelection } from "#product/lib/domain/chat/models/model-selector-types";

export type ModelSelectionMatchKind = "none" | "direct" | "equivalent";

export function modelSelectionMatchesModel(
  selection: ModelSelectorSelection | null | undefined,
  _agent: DesktopAgentLaunchAgent,
  agentKind: string,
  modelId: string,
): boolean {
  return resolveModelSelectionMatchKind(selection, _agent, agentKind, modelId) === "direct";
}

export function resolveModelSelectionMatchKind(
  selection: ModelSelectorSelection | null | undefined,
  _agent: DesktopAgentLaunchAgent,
  agentKind: string,
  modelId: string,
): ModelSelectionMatchKind {
  return selection?.kind === agentKind && selection.modelId === modelId
    ? "direct"
    : "none";
}

export function findLaunchModelById(
  agent: DesktopAgentLaunchAgent,
  modelId: string,
): DesktopAgentLaunchModel | null {
  return agent.models.find((model) => model.id === modelId) ?? null;
}

export function selectedModelIdForVisibility(
  _agentKind: string,
  modelId: string,
): string {
  return modelId.trim();
}

export function normalizeLaunchModelId(_agentKind: string, modelId: string): string {
  return modelId.trim();
}

export function modelIdLookupCandidates(_agentKind: string, modelId: string): string[] {
  const exactId = modelId.trim();
  return exactId ? [exactId] : [];
}
