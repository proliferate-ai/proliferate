import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { workspaceCollectionsKey } from "@/hooks/workspaces/query-keys";

export function useWorkspaceCollectionsCache(args: {
  runtimeUrl: string;
  cloudActive: boolean;
}) {
  const { cloudActive, runtimeUrl } = args;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => workspaceCollectionsKey(runtimeUrl, cloudActive),
    [cloudActive, runtimeUrl],
  );

  const getWorkspaceCollectionsCacheState = useCallback(() => {
    return queryClient.getQueryState(queryKey);
  }, [queryClient, queryKey]);

  return {
    getWorkspaceCollectionsCacheState,
    queryKey,
  };
}
