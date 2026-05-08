import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";

// Owns invalidation for the product-composed workspace collection cache.
export function useWorkspaceCollectionsInvalidation(runtimeUrl: string) {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: workspaceCollectionsScopeKey(runtimeUrl),
    });
  }, [queryClient, runtimeUrl]);
}
