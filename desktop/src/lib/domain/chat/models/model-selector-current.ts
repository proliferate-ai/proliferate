import { resolveModelDisplayName } from "@/lib/domain/chat/models/model-display";

export interface ModelSelectorCurrentDisplayNameInput {
  activeLaunchIdentity: { kind: string; modelId: string } | null;
  defaultLaunchSelection: { kind: string; modelId: string } | null;
  launchAgents: Array<{
    kind: string;
    models: Array<{ id: string; displayName: string }>;
  }>;
  liveConfigLabel: string | null;
}

export function resolveCurrentModelDisplayName(
  input: ModelSelectorCurrentDisplayNameInput,
): string | null {
  const selection = input.activeLaunchIdentity ?? input.defaultLaunchSelection;
  if (!selection) {
    return null;
  }

  const agent = input.launchAgents.find((candidate) => candidate.kind === selection.kind);
  const model = agent?.models.find((candidate) => candidate.id === selection.modelId);
  return resolveModelDisplayName({
    agentKind: selection.kind,
    modelId: selection.modelId,
    sourceLabels: [
      input.liveConfigLabel,
      model?.displayName,
    ],
    preferKnownAlias: true,
  });
}
