import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { cloudWorkspaceConnectionKey } from "@/hooks/access/cloud/query-keys";
import { clearCachedCloudConnections } from "@/hooks/access/cloud/cloud-connection-cache";

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

  return {
    clearCachedCloudWorkspaceConnections,
    invalidateCloudWorkspaceConnection,
  };
}
