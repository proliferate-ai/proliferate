import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export function isWorkspaceSelectionCurrent(
  workspaceId: string,
  selectionNonce: number,
): boolean {
  const state = useSessionSelectionStore.getState();
  return state.selectedWorkspaceId === workspaceId
    && state.workspaceSelectionNonce === selectionNonce;
}

/**
 * The abort signal owned by the live workspace selection (UX Latency ADR §4.6,
 * Rung 9 / Q11). A selection captures this the instant it takes ownership; a
 * newer selection aborts it, cancelling this selection's in-flight requests on
 * the wire. Read at selection start, after the nonce-bumping activation call.
 */
export function currentWorkspaceSelectionSignal(): AbortSignal {
  return useSessionSelectionStore.getState().workspaceSelectionAbort.signal;
}
