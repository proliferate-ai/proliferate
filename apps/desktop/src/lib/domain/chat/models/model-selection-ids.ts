import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type { ModelSelectorSelection } from "@/lib/domain/chat/models/model-selector-types";

export function modelSelectionMatchesModel(
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

export function findLaunchModelByIdOrAlias(
  agent: DesktopAgentLaunchAgent,
  modelId: string,
): DesktopAgentLaunchModel | null {
  return agent.models.find((model) =>
    model.id === modelId || model.aliases.includes(modelId)
  ) ?? null;
}
