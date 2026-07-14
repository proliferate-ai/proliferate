import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { cloudWorkspaceConnectionKey } from "@/hooks/access/cloud/query-keys";
import { clearCachedCloudConnections } from "@/hooks/access/cloud/cloud-connection-cache";
import {
  getCloudWorkspaceConnectionWithRetry,
} from "@/lib/access/cloud/workspace-connection-retry";

export function useCloudWorkspaceConnectionCache() {
  const queryClient = useQueryClient();
  const cloudClient = useProductHost().cloud.client;

  const clearCachedCloudWorkspaceConnections = useCallback(async (workspaceId?: string) => {
    await clearCachedCloudConnections(queryClient, workspaceId);
  }, [queryClient]);

  const invalidateCloudWorkspaceConnection = useCallback(async (workspaceId: string) => {
    await queryClient.invalidateQueries({
      queryKey: cloudWorkspaceConnectionKey(workspaceId),
      exact: true,
    });
  }, [queryClient]);

  const refreshCloudWorkspaceConnection = useCallback(async (workspaceId: string) => {
    const queryKey = cloudWorkspaceConnectionKey(workspaceId);
    await queryClient.invalidateQueries({
      queryKey,
      exact: true,
      refetchType: "none",
    });
    const connection = await getCloudWorkspaceConnectionWithRetry(workspaceId, cloudClient);
    queryClient.setQueryData(queryKey, connection);
    return connection;
  }, [queryClient, cloudClient]);

  return {
    clearCachedCloudWorkspaceConnections,
    invalidateCloudWorkspaceConnection,
    refreshCloudWorkspaceConnection,
  };
}
