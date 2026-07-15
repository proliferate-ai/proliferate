import type { CoworkStatus } from "@anyharness/sdk";
import {
  anyHarnessCoworkArtifactScopeKey,
  anyHarnessCoworkManifestKey,
  anyHarnessCoworkStatusKey,
  anyHarnessWorkspaceQueryKeyRoots,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { CloudMobilityWorkspaceSummary } from "@proliferate/cloud-sdk/types";
import { cloudBillingKey, cloudMobilityWorkspacesKey } from "#product/hooks/access/cloud/query-keys";
import { useProductAuthUserId } from "#product/hooks/auth/facade/use-product-auth";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import type { WorkspaceCollections } from "#product/lib/domain/workspaces/cloud/collections";
import {
  getWorkspaceCollectionsFromCache,
  workspaceCollectionsScopeKey,
} from "#product/hooks/workspaces/cache/query-keys";

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
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const authUserId = useProductAuthUserId();
  const { cloudActive } = useCloudAvailabilityState();

  const getWorkspaceSelectionSnapshot = useCallback((
    runtimeUrl: string,
  ): WorkspaceSelectionCacheSnapshot => ({
    // Must mirror the collections query's user scope (use-workspaces.ts /
    // use-workspace-collections-cache.ts): `cloudActive ? authUserId : null`.
    // Reading under a bare auth check diverges when a session is authenticated
    // but cloud is inactive (e.g. dev auth bypass) — the snapshot then misses
    // the populated cache entry and every selection fails "Workspace not
    // found."
    workspaceCollections: getWorkspaceCollectionsFromCache(
      queryClient,
      runtimeUrl,
      cloudActive ? authUserId : null,
    ),
    cloudMobilityWorkspaces: queryClient.getQueryData<CloudMobilityWorkspaceSummary[]>(
      cloudMobilityWorkspacesKey(),
    ),
    coworkStatus: queryClient.getQueryData<CoworkStatus>(
      anyHarnessCoworkStatusKey(runtimeUrl, cacheScopeKey),
    ),
  }), [authUserId, cacheScopeKey, cloudActive, queryClient]);

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
      const workspaceRoots = [
        ...anyHarnessWorkspaceQueryKeyRoots(cacheScopeKey, workspaceId),
        anyHarnessCoworkManifestKey(input.runtimeUrl, workspaceId, cacheScopeKey),
        anyHarnessCoworkArtifactScopeKey(input.runtimeUrl, workspaceId, cacheScopeKey),
      ];
      for (const root of workspaceRoots) {
        roots.add(JSON.stringify(root));
      }
    }

    for (const serializedRoot of roots) {
      const queryKey = JSON.parse(serializedRoot) as readonly unknown[];
      void queryClient.cancelQueries({ queryKey, exact: false });
    }
  }, [cacheScopeKey, queryClient]);

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
