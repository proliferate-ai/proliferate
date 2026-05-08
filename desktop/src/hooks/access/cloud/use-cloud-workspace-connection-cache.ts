import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { cloudWorkspaceConnectionKey } from "@/hooks/access/cloud/query-keys";
import { clearCachedCloudConnections } from "@/hooks/access/cloud/cloud-connection-cache";
import { getCloudWorkspaceConnection } from "@/lib/access/cloud/workspaces";

export function useCloudWorkspaceConnectionCache() {
  const queryClient = useQueryClient();

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
    const connection = await getCloudWorkspaceConnection(workspaceId);
    queryClient.setQueryData(queryKey, connection);
    return connection;
  }, [queryClient]);

  return {
    clearCachedCloudWorkspaceConnections,
    invalidateCloudWorkspaceConnection,
    refreshCloudWorkspaceConnection,
  };
}
