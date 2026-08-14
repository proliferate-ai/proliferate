import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { archivedWorkspacesKey } from "#product/hooks/workspaces/cache/query-keys";

// Owns invalidation for the archived-workspaces list cache, the disjoint
// counterpart to `useWorkspaceCollectionsInvalidation`. Kept as its own hook
// (rather than a bare `useQueryClient()` at each workflow call site) so the
// query-cache boundary stays in `hooks/**/cache/`, per
// `scripts/check_frontend_boundaries.py`'s QUERY_CLIENT_OUTSIDE_CACHE_OWNER rule.
export function useArchivedWorkspacesInvalidation(runtimeUrl: string) {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: archivedWorkspacesKey(runtimeUrl) });
  }, [queryClient, runtimeUrl]);
}
