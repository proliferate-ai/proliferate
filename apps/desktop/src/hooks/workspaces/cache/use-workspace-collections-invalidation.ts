import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import {
  workspaceCollectionsRootKey,
  workspaceCollectionsScopeKey,
} from "@/hooks/workspaces/cache/query-keys";

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

// Trailing debounce so bursts of invalidation requests (e.g. several agents
// finishing at once) coalesce into a single collections refetch.
const WORKSPACE_COLLECTIONS_INVALIDATION_DEBOUNCE_MS = 250;

export function useDebouncedWorkspaceCollectionsInvalidation() {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
  }, []);

  return useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: workspaceCollectionsRootKey(),
      });
    }, WORKSPACE_COLLECTIONS_INVALIDATION_DEBOUNCE_MS);
  }, [queryClient]);
}
