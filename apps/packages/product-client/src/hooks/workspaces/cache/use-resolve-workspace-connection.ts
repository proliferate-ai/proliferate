import { anyHarnessCoworkStatusKey } from "@anyharness/sdk-react";
import type { CoworkStatus } from "@anyharness/sdk";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  resolveWorkspaceConnection,
  type ProductResolvedWorkspaceConnection,
} from "#product/lib/access/anyharness/resolve-workspace-connection";
import { buildLogicalWorkspaces } from "#product/lib/domain/workspaces/cloud/logical-workspaces";
import { findLogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";
import {
  logicalWorkspaceCloudRuntimeMaterializationId,
  resolveLogicalWorkspaceMaterializationId,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-materialization";
import { buildStandardRepoProjection } from "#product/lib/domain/workspaces/cloud/standard-projection";
import { getWorkspaceCollectionsFromCache } from "#product/hooks/workspaces/cache/query-keys";

/**
 * Owns the AnyHarness workspace-connection resolver, including its React Query
 * cache reads. It lives under `hooks/**​/cache/` — a sanctioned cache-owner path
 * — so it reads the one QueryClient through `useQueryClient()` rather than a
 * module-singleton import. `ProductProviderRoot` (a non-cache-owner path)
 * consumes the returned callback, keeping the query cache shape owned here.
 *
 * Every connection resolves against the local AnyHarness runtime: the cloud
 * sandbox gateway (and with it the synthetic-cloud connection cache) is
 * deleted, so no workspace id can reach a remote runtime any more.
 */
export interface ResolveWorkspaceConnectionInput {
  cloudClient: ProliferateCloudClient | null;
  runtimeUrl: string;
  authStatus: string;
  authUserId: string | null;
  cacheScopeKey: string;
  selectedWorkspaceId: string | null;
}

export function useResolveWorkspaceConnection({
  cloudClient,
  runtimeUrl,
  authStatus,
  authUserId,
  cacheScopeKey,
  selectedWorkspaceId,
}: ResolveWorkspaceConnectionInput): (workspaceId: string) => Promise<
  ProductResolvedWorkspaceConnection
> {
  const queryClient = useQueryClient();
  return useCallback(
    (workspaceId: string) => {
      const workspaceCollections = getWorkspaceCollectionsFromCache(
        queryClient,
        runtimeUrl,
        authStatus === "authenticated" ? authUserId : null,
      );
      const coworkStatus = queryClient.getQueryData<CoworkStatus>(
        anyHarnessCoworkStatusKey(runtimeUrl, cacheScopeKey),
      );
      const standardProjection = workspaceCollections
        ? buildStandardRepoProjection({
          repoRoots: workspaceCollections.repoRoots,
          localWorkspaces: workspaceCollections.localWorkspaces,
          cloudWorkspaces: workspaceCollections.cloudWorkspaces,
          coworkRootRepoRootId: coworkStatus?.root?.repoRootId ?? null,
        })
        : null;
      const logicalWorkspaces = workspaceCollections
        ? buildLogicalWorkspaces({
          localWorkspaces: standardProjection?.localWorkspaces ?? [],
          repoRoots: standardProjection?.repoRoots ?? [],
          cloudWorkspaces: standardProjection?.cloudWorkspaces ?? [],
          currentSelectionId: selectedWorkspaceId,
        })
        : [];
      const logicalWorkspace = findLogicalWorkspace(logicalWorkspaces, workspaceId);
      if (logicalWorkspace) {
        const explicitCloudRuntimeMaterializationId =
          logicalWorkspaceCloudRuntimeMaterializationId(logicalWorkspace);
        const explicitLocalMaterializationId = logicalWorkspace.localWorkspace?.id ?? null;
        const materializationId = (
          workspaceId === explicitCloudRuntimeMaterializationId
          || workspaceId === explicitLocalMaterializationId
        )
          ? workspaceId
          : resolveLogicalWorkspaceMaterializationId(
            logicalWorkspace,
            selectedWorkspaceId,
          );

        if (!materializationId) {
          throw new Error("Workspace is not materialized yet.");
        }

        if (
          logicalWorkspace.localWorkspace
          && materializationId === logicalWorkspace.localWorkspace.id
        ) {
          return resolveWorkspaceConnection(runtimeUrl, logicalWorkspace.localWorkspace.id, cloudClient);
        }
      }

      return resolveWorkspaceConnection(runtimeUrl, workspaceId, cloudClient);
    },
    [authStatus, authUserId, cacheScopeKey, cloudClient, queryClient, runtimeUrl, selectedWorkspaceId],
  );
}
