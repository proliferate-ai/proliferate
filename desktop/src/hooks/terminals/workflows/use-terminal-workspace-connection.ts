import { useCallback } from "react";
import { useCloudWorkspaceConnectionCache } from "@/hooks/access/cloud/use-cloud-workspace-connection-cache";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import {
  resolveWorkspaceConnection,
  type AnyHarnessDesktopResolvedConnection,
} from "@/lib/access/anyharness/resolve-workspace-connection";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export interface TerminalWorkspaceConnectionController {
  getWorkspaceRuntimeBlockReason(workspaceId: string): string | null;
  resolveTerminalWorkspaceConnection(
    workspaceId: string,
  ): Promise<AnyHarnessDesktopResolvedConnection>;
  triggerSelectedCloudReconnect(workspaceId: string): void;
}

// Owns terminal workspace runtime resolution, including the selected cloud runtime fast path.
export function useTerminalWorkspaceConnection(): TerminalWorkspaceConnectionController {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { invalidateCloudWorkspaceConnection } = useCloudWorkspaceConnectionCache();
  const { selectedCloudRuntime, getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();

  const resolveTerminalWorkspaceConnection = useCallback(async (
    workspaceId: string,
  ): Promise<AnyHarnessDesktopResolvedConnection> => {
    if (
      selectedCloudRuntime.workspaceId === workspaceId
      && selectedCloudRuntime.state?.phase === "ready"
      && selectedCloudRuntime.connectionInfo
    ) {
      return {
        runtimeUrl: selectedCloudRuntime.connectionInfo.runtimeUrl,
        authToken: selectedCloudRuntime.connectionInfo.accessToken,
        anyharnessWorkspaceId: selectedCloudRuntime.connectionInfo.anyharnessWorkspaceId ?? "",
        runtimeGeneration: selectedCloudRuntime.connectionInfo.runtimeGeneration,
      };
    }

    return resolveWorkspaceConnection(runtimeUrl, workspaceId);
  }, [
    runtimeUrl,
    selectedCloudRuntime.connectionInfo,
    selectedCloudRuntime.state?.phase,
    selectedCloudRuntime.workspaceId,
  ]);

  const triggerSelectedCloudReconnect = useCallback((workspaceId: string) => {
    if (
      selectedCloudRuntime.workspaceId !== workspaceId
      || selectedCloudRuntime.state?.phase !== "ready"
    ) {
      return;
    }

    const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
    if (!cloudWorkspaceId) {
      return;
    }

    void invalidateCloudWorkspaceConnection(cloudWorkspaceId);
  }, [
    invalidateCloudWorkspaceConnection,
    selectedCloudRuntime.state?.phase,
    selectedCloudRuntime.workspaceId,
  ]);

  return {
    getWorkspaceRuntimeBlockReason,
    resolveTerminalWorkspaceConnection,
    triggerSelectedCloudReconnect,
  };
}
