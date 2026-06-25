import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  getWorkspaceCollectionsFromCache,
  workspaceCollectionsKey,
} from "@/hooks/workspaces/cache/query-keys";

export function useWorkspaceCollectionsCache(args: {
  runtimeUrl: string;
  cloudActive: boolean;
  authUserId: string | null;
}) {
  const { authUserId, cloudActive, runtimeUrl } = args;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => workspaceCollectionsKey(runtimeUrl, cloudActive, cloudActive ? authUserId : null),
    [authUserId, cloudActive, runtimeUrl],
  );

  const getWorkspaceCollectionsCacheState = useCallback(() => {
    return queryClient.getQueryState(queryKey);
  }, [queryClient, queryKey]);

  const getWorkspaceCollections = useCallback(() => {
    return getWorkspaceCollectionsFromCache(
      queryClient,
      runtimeUrl,
      cloudActive ? authUserId : null,
    );
  }, [authUserId, cloudActive, queryClient, runtimeUrl]);

  return {
    getWorkspaceCollections,
    getWorkspaceCollectionsCacheState,
    queryKey,
  };
}
