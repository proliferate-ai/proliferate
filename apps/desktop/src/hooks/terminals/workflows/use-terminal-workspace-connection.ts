import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useCloudConnectionAuthority } from "@/hooks/access/cloud/use-cloud-connection-authority";
import { useCloudWorkspaceConnectionCache } from "@/hooks/access/cloud/use-cloud-workspace-connection-cache";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import {
  resolveWorkspaceConnection,
  type AnyHarnessDesktopResolvedConnection,
} from "@/lib/access/anyharness/resolve-workspace-connection";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { withFreshCloudSandboxGatewayAccessToken } from "@/lib/access/cloud/cloud-sandbox-gateway";

export interface TerminalWorkspaceConnectionController {
  cloudAuthorityScopeKey: string;
  getWorkspaceRuntimeBlockReason(workspaceId: string): string | null;
  resolveTerminalWorkspaceConnection(
    workspaceId: string,
  ): Promise<AnyHarnessDesktopResolvedConnection>;
  triggerSelectedCloudReconnect(workspaceId: string): void;
}

// Owns terminal workspace runtime resolution, including the selected cloud runtime fast path.
export function useTerminalWorkspaceConnection(): TerminalWorkspaceConnectionController {
  const host = useProductHost();
  const ssh = host.desktop?.ssh ?? null;
  const {
    client: cloudClient,
    scopeKey: cloudAuthorityScopeKey,
  } = useCloudConnectionAuthority();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { invalidateCloudWorkspaceConnection } = useCloudWorkspaceConnectionCache();
  const { selectedCloudRuntime, getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();

  const resolveTerminalWorkspaceConnection = useCallback(async (
    workspaceId: string,
  ): Promise<AnyHarnessDesktopResolvedConnection> => {
    if (
      cloudClient
      && selectedCloudRuntime.workspaceId === workspaceId
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
        runtimeGeneration: connectionInfo.runtimeGeneration,
      };
    }

    return resolveWorkspaceConnection(runtimeUrl, workspaceId, ssh, cloudClient);
  }, [
    cloudClient,
    runtimeUrl,
    ssh,
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
    cloudAuthorityScopeKey,
    getWorkspaceRuntimeBlockReason,
    resolveTerminalWorkspaceConnection,
    triggerSelectedCloudReconnect,
  };
}
