import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "#product/lib/domain/agents/cloud-launch-catalog";

export interface ResolveUnattendedModeIdInput {
  agent: DesktopAgentLaunchAgent | null | undefined;
  modelId?: string | null;
  explicitModeId?: string | null;
}

/** Resolve an unattended create-time mode from the selected target catalog. */
export function resolveUnattendedModeId({
  agent,
  modelId,
  explicitModeId,
}: ResolveUnattendedModeIdInput): string | undefined {
  const explicit = explicitModeId?.trim() || undefined;
  if (explicit) {
    return explicit;
  }

  const unattended = agent?.unattendedModeId?.trim() || undefined;
  if (!agent || !unattended) {
    return undefined;
  }

  const selectedModelId = modelId?.trim() || agent.defaultModelId?.trim() || undefined;
  const selectedModel = selectedModelId
    ? findModel(agent.models, selectedModelId)
    : null;
  if (selectedModelId && !selectedModel) {
    return undefined;
  }
  if (selectedModel?.modeValues && !selectedModel.modeValues.includes(unattended)) {
    return undefined;
  }

  return unattended;
}

function findModel(
  models: readonly DesktopAgentLaunchModel[],
  modelId: string,
): DesktopAgentLaunchModel | null {
  return models.find((model) => (
    model.id === modelId || model.aliases.includes(modelId)
  )) ?? null;
}
