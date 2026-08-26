import type { CloudConnectionInfo } from "@proliferate/cloud-sdk/types";
import type { TerminalWebSocketAuthTransport } from "@anyharness/sdk";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import {
  type SelectedCloudRuntimeViewModel,
} from "#product/lib/domain/workspaces/cloud/cloud-runtime-state";

export interface SelectedCloudRuntimeState {
  workspaceId: string | null;
  cloudWorkspaceId: string | null;
  state: SelectedCloudRuntimeViewModel | null;
  connectionInfo: (CloudConnectionInfo & {
    webSocketAuthTransport?: TerminalWebSocketAuthTransport;
  }) | null;
  retry: (() => void) | null;
  claim: (() => void) | null;
  claimPending: boolean;
}

/**
 * Inert facade: the cloud sandbox stack is deleted, so no selected workspace
 * can have a cloud runtime any more. The contract is preserved for its many
 * consumers — `state`/`connectionInfo` are permanently null, so every cloud
 * fast path and cloud action gate stays closed.
 */
export function useSelectedCloudRuntimeState(): SelectedCloudRuntimeState {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);

  return {
    workspaceId: selectedWorkspaceId,
    cloudWorkspaceId,
    state: null,
    connectionInfo: null,
    retry: null,
    claim: null,
    claimPending: false,
  };
}
