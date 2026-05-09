import type { CoworkStatus } from "@anyharness/sdk";
import {
  anyHarnessCoworkStatusKey,
  anyHarnessWorkspaceQueryKeyRoots,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { CloudMobilityWorkspaceSummary } from "@/lib/access/cloud/client";
import { cloudBillingKey, cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/cloud/collections";
import {
  getWorkspaceCollectionsFromCache,
  workspaceCollectionsScopeKey,
} from "@/hooks/workspaces/cache/query-keys";

export interface WorkspaceSelectionCacheSnapshot {
  workspaceCollections: WorkspaceCollections | undefined;
  cloudMobilityWorkspaces: CloudMobilityWorkspaceSummary[] | undefined;
  coworkStatus: CoworkStatus | undefined;
}

interface CancelPreviousWorkspaceDisplayQueriesInput {
  runtimeUrl: string;
  previousWorkspaceIds: readonly (string | null | undefined)[];
  nextWorkspaceIds: readonly (string | null | undefined)[];
}

// Owns query-cache reads and invalidation needed by workspace selection/bootstrap flows.
export function useWorkspaceSelectionCache() {
  const queryClient = useQueryClient();

  const getWorkspaceSelectionSnapshot = useCallback((
    runtimeUrl: string,
  ): WorkspaceSelectionCacheSnapshot => ({
    workspaceCollections: getWorkspaceCollectionsFromCache(queryClient, runtimeUrl),
    cloudMobilityWorkspaces: queryClient.getQueryData<CloudMobilityWorkspaceSummary[]>(
      cloudMobilityWorkspacesKey(),
    ),
    coworkStatus: queryClient.getQueryData<CoworkStatus>(
      anyHarnessCoworkStatusKey(runtimeUrl),
    ),
  }), [queryClient]);

  const cancelPreviousWorkspaceDisplayQueries = useCallback((
    input: CancelPreviousWorkspaceDisplayQueriesInput,
  ) => {
    if (typeof queryClient.cancelQueries !== "function") {
      return;
    }

    const nextIds = new Set(input.nextWorkspaceIds.filter(Boolean));
    const roots = new Set<string>();
    for (const workspaceId of input.previousWorkspaceIds) {
      if (!workspaceId || nextIds.has(workspaceId)) {
        continue;
      }
      for (const root of anyHarnessWorkspaceQueryKeyRoots(input.runtimeUrl, workspaceId)) {
        roots.add(JSON.stringify(root));
      }
    }

    for (const serializedRoot of roots) {
      const queryKey = JSON.parse(serializedRoot) as readonly unknown[];
      void queryClient.cancelQueries({ queryKey, exact: false });
    }
  }, [queryClient]);

  const invalidateCloudWorkspaceStartState = useCallback(async (runtimeUrl: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      }),
      queryClient.invalidateQueries({
        queryKey: cloudBillingKey(),
      }),
    ]);
  }, [queryClient]);

  return {
    cancelPreviousWorkspaceDisplayQueries,
    getWorkspaceSelectionSnapshot,
    invalidateCloudWorkspaceStartState,
  };
}
