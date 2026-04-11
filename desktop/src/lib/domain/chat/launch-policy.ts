import type { ModelSelectorSelection } from "@/lib/domain/chat/model-selection";

export type ChatLaunchAction =
  | "noop"
  | "mutate-current-session"
  | "replace-cowork-session"
  | "open-code-session";

interface ResolveChatLaunchActionArgs {
  isCoworkWorkspaceSelected: boolean;
  activeSessionId: string | null;
  currentLaunchIdentity: { kind: string; modelId: string } | null;
  currentModelConfigId: string | null;
  selection: ModelSelectorSelection;
}

export function resolveChatLaunchAction(
  args: ResolveChatLaunchActionArgs,
): ChatLaunchAction {
  if (
    args.currentLaunchIdentity?.kind === args.selection.kind
    && args.currentLaunchIdentity.modelId === args.selection.modelId
  ) {
    return "noop";
  }

  if (
    args.activeSessionId
    && args.currentLaunchIdentity?.kind === args.selection.kind
    && args.currentModelConfigId
  ) {
    return "mutate-current-session";
  }

  if (args.isCoworkWorkspaceSelected) {
    return "replace-cowork-session";
  }

  return "open-code-session";
}
