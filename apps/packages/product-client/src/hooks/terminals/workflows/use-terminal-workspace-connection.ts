import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useCloudWorkspaceConnectionCache } from "#product/hooks/access/cloud/use-cloud-workspace-connection-cache";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import {
  resolveWorkspaceConnection,
  type ProductAnyHarnessResolvedConnection,
} from "#product/lib/access/anyharness/resolve-workspace-connection";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { withFreshCloudSandboxGatewayAccessToken } from "#product/lib/access/cloud/cloud-sandbox-gateway";

export interface TerminalWorkspaceConnectionController {
  getWorkspaceRuntimeBlockReason(workspaceId: string): string | null;
  resolveTerminalWorkspaceConnection(
    workspaceId: string,
  ): Promise<ProductAnyHarnessResolvedConnection>;
  triggerSelectedCloudReconnect(workspaceId: string): void;
}

// Owns terminal workspace runtime resolution, including the selected cloud runtime fast path.
export function useTerminalWorkspaceConnection(): TerminalWorkspaceConnectionController {
  const host = useProductHost();
  const cloudClient = host.cloud.client;
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { invalidateCloudWorkspaceConnection } = useCloudWorkspaceConnectionCache();
  const { selectedCloudRuntime, getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();

  const resolveTerminalWorkspaceConnection = useCallback(async (
    workspaceId: string,
  ): Promise<ProductAnyHarnessResolvedConnection> => {
    if (
      selectedCloudRuntime.workspaceId === workspaceId
      && selectedCloudRuntime.state?.phase === "ready"
      && selectedCloudRuntime.connectionInfo
    ) {
      const connectionInfo = await withFreshCloudSandboxGatewayAccessToken(
        selectedCloudRuntime.connectionInfo,
      );
      return {
        runtimeUrl: connectionInfo.runtimeUrl,
        authToken: connectionInfo.accessToken,
        webSocketAuthTransport: connectionInfo.webSocketAuthTransport,
        anyharnessWorkspaceId: connectionInfo.anyharnessWorkspaceId ?? "",
        runtimeGeneration: connectionInfo.runtimeGeneration ?? 0,
        runtimeAccessKind: "proliferate-gateway",
      };
    }

    return (await resolveWorkspaceConnection(runtimeUrl, workspaceId, cloudClient)).connection;
  }, [
    runtimeUrl,
    cloudClient,
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
