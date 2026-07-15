import { anyHarnessCoworkStatusKey } from "@anyharness/sdk-react";
import type { CoworkStatus, TerminalWebSocketAuthTransport } from "@anyharness/sdk";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { CloudMobilityWorkspaceSummary } from "@/lib/access/cloud/client";
import { cloudWorkspaceConnectionQueryOptions } from "@/hooks/access/cloud/use-cloud-workspace-connection";
import { resolveWorkspaceConnection } from "@/lib/access/anyharness/resolve-workspace-connection";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/cloud/logical-workspaces";
import { findLogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import {
  logicalWorkspaceCloudRuntimeMaterializationId,
  logicalWorkspaceTargetMaterializationId,
  resolveLogicalWorkspaceMaterializationId,
} from "@/lib/domain/workspaces/cloud/logical-workspace-materialization";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { buildStandardRepoProjection } from "@/lib/domain/workspaces/cloud/standard-projection";
import { cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import { getWorkspaceCollectionsFromCache } from "@/hooks/workspaces/cache/query-keys";
import { withFreshCloudSandboxGatewayAccessToken } from "@/lib/access/cloud/cloud-sandbox-gateway";

/**
 * Owns the AnyHarness workspace-connection resolver, including its React Query
 * cache reads. It lives under `hooks/**​/cache/` — a sanctioned cache-owner path
 * — so it reads the one QueryClient through `useQueryClient()` rather than a
 * module-singleton import. `ProductProviderRoot` (a non-cache-owner path)
 * consumes the returned callback, keeping the query cache shape owned here.
 *
 * Behavior is identical to the previous inline `resolveConnection`: same cache
 * keys, same materialization resolution, same synthetic-cloud handling.
 */
export interface ResolveWorkspaceConnectionInput {
  ssh: DesktopSshBridge | null;
  cloudClient: ProliferateCloudClient | null;
  runtimeUrl: string;
  authStatus: string;
  authUserId: string | null;
  cacheScopeKey: string;
  selectedWorkspaceId: string | null;
}

async function resolveWorkspaceConnectionWithCache(
  queryClient: QueryClient,
  runtimeUrl: string,
  workspaceId: string,
  ssh: DesktopSshBridge | null,
  cloudClient: ProliferateCloudClient | null,
) {
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
  if (!cloudWorkspaceId) {
    return resolveWorkspaceConnection(runtimeUrl, workspaceId, ssh, cloudClient);
  }

  const cachedConnection = await queryClient.fetchQuery(
    cloudWorkspaceConnectionQueryOptions(cloudWorkspaceId, cloudClient),
  );
  const connection = await withFreshCloudSandboxGatewayAccessToken(cachedConnection);
  const webSocketAuthTransport = (
    connection as { webSocketAuthTransport?: TerminalWebSocketAuthTransport }
  ).webSocketAuthTransport;
  return {
    runtimeUrl: connection.runtimeUrl,
    authToken: connection.accessToken ?? undefined,
    anyharnessWorkspaceId: connection.anyharnessWorkspaceId ?? "",
    webSocketAuthTransport,
  };
}

export function useResolveWorkspaceConnection({
  ssh,
  cloudClient,
  runtimeUrl,
  authStatus,
  authUserId,
  cacheScopeKey,
  selectedWorkspaceId,
}: ResolveWorkspaceConnectionInput): (workspaceId: string) => Promise<
  Awaited<ReturnType<typeof resolveWorkspaceConnectionWithCache>>
> {
  const queryClient = useQueryClient();
  return useCallback(
    (workspaceId: string) => {
      const workspaceCollections = getWorkspaceCollectionsFromCache(
        queryClient,
        runtimeUrl,
        authStatus === "authenticated" ? authUserId : null,
      );
      const cloudMobilityWorkspaces = queryClient.getQueryData<CloudMobilityWorkspaceSummary[]>(
        cloudMobilityWorkspacesKey(),
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
          cloudMobilityWorkspaces,
          currentSelectionId: selectedWorkspaceId,
        })
        : [];
      const logicalWorkspace = findLogicalWorkspace(logicalWorkspaces, workspaceId);
      if (logicalWorkspace) {
        const explicitCloudRuntimeMaterializationId =
          logicalWorkspaceCloudRuntimeMaterializationId(logicalWorkspace);
        const explicitTargetMaterializationId = logicalWorkspaceTargetMaterializationId(logicalWorkspace);
        const explicitLocalMaterializationId = logicalWorkspace.localWorkspace?.id ?? null;
        const materializationId = (
          (
            workspaceId === explicitCloudRuntimeMaterializationId
            && !explicitTargetMaterializationId
          )
          || workspaceId === explicitTargetMaterializationId
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
          explicitCloudRuntimeMaterializationId
          && materializationId === explicitCloudRuntimeMaterializationId
        ) {
          return resolveWorkspaceConnectionWithCache(
            queryClient,
            runtimeUrl,
            explicitCloudRuntimeMaterializationId,
            ssh,
            cloudClient,
          );
        }

        if (
          explicitTargetMaterializationId
          && materializationId === explicitTargetMaterializationId
        ) {
          return resolveWorkspaceConnectionWithCache(queryClient, runtimeUrl, explicitTargetMaterializationId, ssh, cloudClient);
        }

        if (
          logicalWorkspace.localWorkspace
          && materializationId === logicalWorkspace.localWorkspace.id
        ) {
          return resolveWorkspaceConnectionWithCache(queryClient, runtimeUrl, logicalWorkspace.localWorkspace.id, ssh, cloudClient);
        }
      }

      return resolveWorkspaceConnectionWithCache(queryClient, runtimeUrl, workspaceId, ssh, cloudClient);
    },
    [authStatus, authUserId, cacheScopeKey, cloudClient, queryClient, runtimeUrl, selectedWorkspaceId, ssh],
  );
}
