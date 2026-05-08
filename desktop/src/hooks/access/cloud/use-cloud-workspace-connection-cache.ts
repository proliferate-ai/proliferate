import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { cloudWorkspaceConnectionKey } from "@/hooks/access/cloud/query-keys";

export function useCloudWorkspaceConnectionCache() {
  const queryClient = useQueryClient();

  const invalidateCloudWorkspaceConnection = useCallback(async (workspaceId: string) => {
    await queryClient.invalidateQueries({
      queryKey: cloudWorkspaceConnectionKey(workspaceId),
      exact: true,
    });
  }, [queryClient]);

  return {
    invalidateCloudWorkspaceConnection,
  };
}
