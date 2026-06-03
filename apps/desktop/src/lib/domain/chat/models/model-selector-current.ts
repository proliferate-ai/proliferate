import { resolveModelDisplayName } from "@/lib/domain/chat/models/model-display";
import {
  modelIdLookupCandidates,
} from "@/lib/domain/chat/models/model-selection-ids";

export interface ModelSelectorCurrentDisplayNameInput {
  activeLaunchIdentity: { kind: string; modelId: string } | null;
  defaultLaunchSelection: { kind: string; modelId: string } | null;
  launchAgents: Array<{
    kind: string;
    models: Array<{ id: string; displayName: string; aliases?: readonly string[] }>;
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
  const modelIdCandidates = modelIdLookupCandidates(selection.kind, selection.modelId);
  const model = agent?.models.find((candidate) =>
    modelIdCandidates.some((modelId) =>
      candidate.id === modelId || candidate.aliases?.includes(modelId)
    )
  );
  return resolveModelDisplayName({
    agentKind: selection.kind,
    modelId: model?.id ?? selection.modelId,
    sourceLabels: [
      model?.displayName,
      input.liveConfigLabel,
    ],
    preferKnownAlias: true,
  });
}
