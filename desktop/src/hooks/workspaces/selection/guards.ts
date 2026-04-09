import { useHarnessStore } from "@/stores/sessions/harness-store";

export function isWorkspaceSelectionCurrent(
  workspaceId: string,
  selectionNonce: number,
): boolean {
  const state = useHarnessStore.getState();
  return state.selectedWorkspaceId === workspaceId
    && state.workspaceSelectionNonce === selectionNonce;
}
