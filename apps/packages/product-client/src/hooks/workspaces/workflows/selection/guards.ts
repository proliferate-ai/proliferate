import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export function isWorkspaceSelectionCurrent(
  workspaceId: string,
  selectionNonce: number,
): boolean {
  const state = useSessionSelectionStore.getState();
  return state.selectedWorkspaceId === workspaceId
    && state.workspaceSelectionNonce === selectionNonce;
}
