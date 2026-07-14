import { useChatPromptRecoveryStore } from "#product/stores/chat/chat-prompt-recovery-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { resolveWorkspaceUiKey } from "#product/lib/domain/workspaces/selection/workspace-ui-key";

const EMPTY_RECOVERIES = [] as const;

export function useChatPromptRecoveries() {
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const selectedWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedWorkspaceId,
  );
  const workspaceUiKey = resolveWorkspaceUiKey(
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  );
  const recoveries = useChatPromptRecoveryStore((state) => (
    workspaceUiKey
      ? state.recoveriesByWorkspaceUiKey[workspaceUiKey] ?? EMPTY_RECOVERIES
      : EMPTY_RECOVERIES
  ));
  return { recoveries, workspaceUiKey };
}
