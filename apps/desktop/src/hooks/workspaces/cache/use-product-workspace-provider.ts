import type { CoworkStatus, TerminalWebSocketAuthTransport } from "@anyharness/sdk";
import { anyHarnessCoworkStatusKey } from "@anyharness/sdk-react";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";

import { resolveWorkspaceConnection } from "@/lib/access/anyharness/resolve-workspace-connection";
import { withFreshCloudSandboxGatewayAccessToken } from "@/lib/access/cloud/cloud-sandbox-gateway";
import type { CloudMobilityWorkspaceSummary } from "@/lib/access/cloud/client";
import { buildAnyHarnessCacheScopeKey } from "@/lib/domain/auth/anyharness-cache-scope";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { findLogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import {
  logicalWorkspaceCloudRuntimeMaterializationId,
  logicalWorkspaceTargetMaterializationId,
  resolveLogicalWorkspaceMaterializationId,
} from "@/lib/domain/workspaces/cloud/logical-workspace-materialization";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/cloud/logical-workspaces";
import { buildStandardRepoProjection } from "@/lib/domain/workspaces/cloud/standard-projection";
import { resolveRouteScopedWorkspaceProviderId } from "@/lib/domain/workspaces/selection/workspace-provider-scope";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

import { useCloudConnectionAuthority } from "@/hooks/access/cloud/use-cloud-connection-authority";
import { cloudWorkspaceConnectionQueryOptions } from "@/hooks/access/cloud/use-cloud-workspace-connection";
import { cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import { getWorkspaceCollectionsFromCache } from "./query-keys";

async function resolveWorkspaceConnectionWithCache(
  runtimeUrl: string,
  workspaceId: string,
  ssh: DesktopSshBridge | null,
  cloudClient: ProliferateCloudClient | null,
  cloudAuthorityScopeKey: string,
  queryClient: QueryClient,
) {
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
  if (!cloudWorkspaceId) {
    return resolveWorkspaceConnection(runtimeUrl, workspaceId, ssh, cloudClient);
  }

  if (!cloudClient) {
    throw new Error("Cloud workspace access is unavailable for this host.");
  }

  const cachedConnection = await queryClient.fetchQuery(
    cloudWorkspaceConnectionQueryOptions(
      cloudWorkspaceId,
      cloudClient,
      cloudAuthorityScopeKey,
    ),
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

/** Owns the composed Query-cache read model used by the AnyHarness provider. */
export function useProductWorkspaceProvider() {
  const queryClient = useQueryClient();
  const host = useProductHost();
  const ssh = host.desktop?.ssh ?? null;
  const { client: cloudClient, scopeKey: cloudAuthorityScopeKey } =
    useCloudConnectionAuthority();
  const location = useLocation();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const authStatus = host.auth.state.status === "loading"
    ? "bootstrapping"
    : host.auth.state.status;
  const authUserId = host.auth.state.status === "authenticated"
    ? host.auth.state.user?.id ?? null
    : null;
  const cacheScopeKey = useMemo(
    () => buildAnyHarnessCacheScopeKey({
      apiBaseUrl: host.deployment.apiBaseUrl,
      authStatus,
      authUserId,
    }),
    [authStatus, authUserId, host.deployment.apiBaseUrl],
  );
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const providerWorkspaceId = resolveRouteScopedWorkspaceProviderId({
    pathname: location.pathname,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  });

  const resolveConnection = useCallback(
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
        const explicitTargetMaterializationId =
          logicalWorkspaceTargetMaterializationId(logicalWorkspace);
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
            runtimeUrl,
            explicitCloudRuntimeMaterializationId,
            ssh,
            cloudClient,
            cloudAuthorityScopeKey,
            queryClient,
          );
        }

        if (
          explicitTargetMaterializationId
          && materializationId === explicitTargetMaterializationId
        ) {
          return resolveWorkspaceConnectionWithCache(
            runtimeUrl,
            explicitTargetMaterializationId,
            ssh,
            cloudClient,
            cloudAuthorityScopeKey,
            queryClient,
          );
        }

        if (
          logicalWorkspace.localWorkspace
          && materializationId === logicalWorkspace.localWorkspace.id
        ) {
          return resolveWorkspaceConnectionWithCache(
            runtimeUrl,
            logicalWorkspace.localWorkspace.id,
            ssh,
            cloudClient,
            cloudAuthorityScopeKey,
            queryClient,
          );
        }
      }

      return resolveWorkspaceConnectionWithCache(
        runtimeUrl,
        workspaceId,
        ssh,
        cloudClient,
        cloudAuthorityScopeKey,
        queryClient,
      );
    },
    [
      authStatus,
      authUserId,
      cacheScopeKey,
      cloudAuthorityScopeKey,
      cloudClient,
      queryClient,
      runtimeUrl,
      selectedWorkspaceId,
      ssh,
    ],
  );

  return {
    cacheScopeKey,
    providerWorkspaceId,
    resolveConnection,
    runtimeUrl,
  };
}
