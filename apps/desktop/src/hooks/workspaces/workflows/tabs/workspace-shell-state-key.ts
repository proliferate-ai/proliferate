import { resolveWorkspaceShellStateKey } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export function resolveCurrentShellStateKey(
  workspaceId: string,
  shellWorkspaceId: string | null | undefined,
): string {
  return resolveWorkspaceShellStateKey({
    workspaceId,
    shellWorkspaceId,
    selectedWorkspaceId: useSessionSelectionStore.getState().selectedWorkspaceId,
    selectedLogicalWorkspaceId: useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
  }) ?? workspaceId;
}
