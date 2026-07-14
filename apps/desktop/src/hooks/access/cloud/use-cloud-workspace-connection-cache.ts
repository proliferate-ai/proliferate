import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { cloudWorkspaceConnectionAuthorityKey } from "@/hooks/access/cloud/query-keys";
import { clearCachedCloudConnections } from "@/hooks/access/cloud/cloud-connection-cache";
import { useCloudConnectionAuthority } from "@/hooks/access/cloud/use-cloud-connection-authority";
import {
  getCloudWorkspaceConnectionWithRetry,
} from "@/lib/access/cloud/workspace-connection-retry";

export function useCloudWorkspaceConnectionCache() {
  const queryClient = useQueryClient();
  const { client: cloudClient, scopeKey } = useCloudConnectionAuthority();

  const clearCachedCloudWorkspaceConnections = useCallback(async (workspaceId?: string) => {
    await clearCachedCloudConnections(queryClient, workspaceId);
  }, [queryClient]);

  const invalidateCloudWorkspaceConnection = useCallback(async (workspaceId: string) => {
    await queryClient.invalidateQueries({
      queryKey: cloudWorkspaceConnectionAuthorityKey(workspaceId, scopeKey),
      exact: true,
    });
  }, [queryClient, scopeKey]);

  const refreshCloudWorkspaceConnection = useCallback(async (workspaceId: string) => {
    if (!cloudClient) {
      throw new Error("Cloud workspace access is unavailable for this host.");
    }
    const queryKey = cloudWorkspaceConnectionAuthorityKey(workspaceId, scopeKey);
    await queryClient.invalidateQueries({
      queryKey,
      exact: true,
      refetchType: "none",
    });
    const connection = await getCloudWorkspaceConnectionWithRetry(workspaceId, cloudClient);
    queryClient.setQueryData(queryKey, connection);
    return connection;
  }, [cloudClient, queryClient, scopeKey]);

  return {
    clearCachedCloudWorkspaceConnections,
    invalidateCloudWorkspaceConnection,
    refreshCloudWorkspaceConnection,
  };
}
