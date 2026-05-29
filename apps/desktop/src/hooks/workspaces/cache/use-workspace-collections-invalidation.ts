import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/cache/query-keys";

// Owns invalidation for the product-composed workspace collection cache.
export function useWorkspaceCollectionsInvalidation(runtimeUrl: string) {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: workspaceCollectionsScopeKey(runtimeUrl),
    });
  }, [queryClient, runtimeUrl]);
}

export function useWorkspaceCollectionsInvalidationActions() {
  const queryClient = useQueryClient();

  const invalidateWorkspaceCollectionsForRuntime = useCallback(async (runtimeUrl: string) => {
    await queryClient.invalidateQueries({
      queryKey: workspaceCollectionsScopeKey(runtimeUrl),
    });
  }, [queryClient]);

  return {
    invalidateWorkspaceCollectionsForRuntime,
  };
}
