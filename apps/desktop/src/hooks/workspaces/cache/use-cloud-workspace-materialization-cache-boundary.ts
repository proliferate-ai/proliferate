import { useAnyHarnessCacheScopeKey } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { CloudConnectionInfo } from "@/lib/access/cloud/client";
import { isCloudWorkspaceConnectionQueryKey } from "@/hooks/access/cloud/query-keys";
import { createCloudWorkspaceMaterializationCacheTracker } from "@/hooks/workspaces/cache/cloud-workspace-materialization-cache";

function cloudWorkspaceIdFromConnectionQueryKey(
  queryKey: readonly unknown[],
): string | null {
  if (!isCloudWorkspaceConnectionQueryKey(queryKey)) {
    return null;
  }

  return typeof queryKey[2] === "string" && queryKey[2].trim()
    ? queryKey[2]
    : null;
}

function isCloudConnectionInfo(value: unknown): value is CloudConnectionInfo {
  return !!value
    && typeof value === "object"
    && typeof (value as { runtimeUrl?: unknown }).runtimeUrl === "string"
    && typeof (value as { anyharnessWorkspaceId?: unknown }).anyharnessWorkspaceId === "string"
    && typeof (value as { runtimeGeneration?: unknown }).runtimeGeneration === "number";
}

// Observes each Cloud connection update, including background refetches, so
// a stable product workspace cannot reuse data from a replaced materialization.
export function useCloudWorkspaceMaterializationCacheBoundary() {
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  useEffect(() => {
    const tracker = createCloudWorkspaceMaterializationCacheTracker({
      queryClient,
      cacheScopeKey,
    });

    const observeConnectionQuery = (query: {
      queryKey: readonly unknown[];
      state: { data: unknown };
    }) => {
      const cloudWorkspaceId = cloudWorkspaceIdFromConnectionQueryKey(query.queryKey);
      if (!cloudWorkspaceId || !isCloudConnectionInfo(query.state.data)) {
        return;
      }

      void tracker.observe({
        cloudWorkspaceId,
        connection: query.state.data,
      });
    };

    for (const query of queryClient.getQueryCache().getAll()) {
      observeConnectionQuery(query);
    }

    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") {
        return;
      }

      observeConnectionQuery(event.query);
    });
  }, [cacheScopeKey, queryClient]);
}
