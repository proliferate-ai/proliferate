import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  getAnyWorkspaceCollectionsFromCache,
  getWorkspaceCollectionsFromCache,
  workspaceCollectionsKey,
} from "#product/hooks/workspaces/cache/query-keys";

// Read-only getter over the freshest cached collections for a runtime,
// regardless of which auth-user/cloud key variant produced them. For
// callers outside the cache layer that only need a post-refetch snapshot.
export function useLatestWorkspaceCollectionsRead(runtimeUrl: string) {
  const queryClient = useQueryClient();
  return useCallback(
    () => getAnyWorkspaceCollectionsFromCache(queryClient, runtimeUrl),
    [queryClient, runtimeUrl],
  );
}

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
