import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { invalidateCloudWorkspaceLifecycleQueries } from "@proliferate/cloud-sdk-react/hooks/workspaces";

export function useCloudWorkspaceLifecycleCache() {
  const queryClient = useQueryClient();

  const invalidateCloudWorkspaceLifecycle = useCallback((workspaceId?: string | null) => {
    invalidateCloudWorkspaceLifecycleQueries(queryClient, workspaceId);
  }, [queryClient]);

  return {
    invalidateCloudWorkspaceLifecycle,
  };
}
