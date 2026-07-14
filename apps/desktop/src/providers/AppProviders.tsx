import {
  AnyHarnessRuntime,
  AnyHarnessWorkspace,
  anyHarnessCoworkStatusKey,
} from "@anyharness/sdk-react";
import type { CoworkStatus, TerminalWebSocketAuthTransport } from "@anyharness/sdk";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { CloudMobilityWorkspaceSummary } from "@/lib/access/cloud/client";
import { getProliferateClient } from "@/lib/access/cloud/client";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { appQueryClient } from "@/lib/infra/query/query-client";
import { cloudWorkspaceConnectionQueryOptions } from "@/hooks/access/cloud/use-cloud-workspace-connection";
import { useCloudConnectionAuthority } from "@/hooks/access/cloud/use-cloud-connection-authority";
import { resolveWorkspaceConnection } from "@/lib/access/anyharness/resolve-workspace-connection";
import {
  buildLogicalWorkspaces,
} from "@/lib/domain/workspaces/cloud/logical-workspaces";
import {
  findLogicalWorkspace,
} from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import {
  logicalWorkspaceCloudRuntimeMaterializationId,
  logicalWorkspaceTargetMaterializationId,
  resolveLogicalWorkspaceMaterializationId,
} from "@/lib/domain/workspaces/cloud/logical-workspace-materialization";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { buildStandardRepoProjection } from "@/lib/domain/workspaces/cloud/standard-projection";
import { cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import { resolveRouteScopedWorkspaceProviderId } from "@/lib/domain/workspaces/selection/workspace-provider-scope";
import { getWorkspaceCollectionsFromCache } from "@/hooks/workspaces/cache/query-keys";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { buildAnyHarnessCacheScopeKey } from "@/lib/domain/auth/anyharness-cache-scope";
import { withFreshCloudSandboxGatewayAccessToken } from "@/lib/access/cloud/cloud-sandbox-gateway";
import { useCloudWorkspaceMaterializationCacheBoundary } from "@/hooks/workspaces/cache/use-cloud-workspace-materialization-cache-boundary";
import { DesktopProductHostProvider } from "./DesktopProductHostProvider";
import { TelemetryProvider } from "./TelemetryProvider";

async function resolveWorkspaceConnectionWithCache(
  runtimeUrl: string,
  workspaceId: string,
  ssh: DesktopSshBridge | null,
  cloudClient: ProliferateCloudClient | null,
  cloudAuthorityScopeKey: string,
) {
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
  if (!cloudWorkspaceId) {
    return resolveWorkspaceConnection(runtimeUrl, workspaceId, ssh, cloudClient);
  }

  if (!cloudClient) {
    throw new Error("Cloud workspace access is unavailable for this host.");
  }

  const cachedConnection = await appQueryClient.fetchQuery(
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

export function AppProviders({ children }: { children: ReactNode }) {
  const cloudClient = useMemo(() => getProliferateClient(), []);

  return (
    <QueryClientProvider client={appQueryClient}>
      <CloudClientProvider client={cloudClient}>
        <DesktopProductHostProvider cloudClient={cloudClient}>
          <WorkspaceProviders>
            <TelemetryProvider>{children}</TelemetryProvider>
          </WorkspaceProviders>
        </DesktopProductHostProvider>
      </CloudClientProvider>
    </QueryClientProvider>
  );
}

function WorkspaceProviders({ children }: { children: ReactNode }) {
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
  const cacheScopeKey = useMemo(() => buildAnyHarnessCacheScopeKey({
    apiBaseUrl: host.deployment.apiBaseUrl,
    authStatus,
    authUserId,
  }), [authStatus, authUserId, host.deployment.apiBaseUrl]);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const providerWorkspaceId = resolveRouteScopedWorkspaceProviderId({
    pathname: location.pathname,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  });
  const resolveConnection = useCallback(
    (workspaceId: string) => {
      const workspaceCollections = getWorkspaceCollectionsFromCache(
        appQueryClient,
        runtimeUrl,
        authStatus === "authenticated" ? authUserId : null,
      );
      const cloudMobilityWorkspaces = appQueryClient.getQueryData<CloudMobilityWorkspaceSummary[]>(
        cloudMobilityWorkspacesKey(),
      );
      const coworkStatus = appQueryClient.getQueryData<CoworkStatus>(
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
            runtimeUrl,
            explicitCloudRuntimeMaterializationId,
            ssh,
            cloudClient,
            cloudAuthorityScopeKey,
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
          );
        }
      }

      return resolveWorkspaceConnectionWithCache(
        runtimeUrl,
        workspaceId,
        ssh,
        cloudClient,
        cloudAuthorityScopeKey,
      );
    },
    [
      authStatus,
      authUserId,
      cacheScopeKey,
      cloudAuthorityScopeKey,
      cloudClient,
      runtimeUrl,
      selectedWorkspaceId,
      ssh,
    ],
  );

  return (
    <AnyHarnessRuntime runtimeUrl={runtimeUrl || null} cacheScopeKey={cacheScopeKey}>
      <CloudWorkspaceMaterializationCacheBoundary>
        <AnyHarnessWorkspace
          workspaceId={providerWorkspaceId}
          resolveConnection={resolveConnection}
        >
          {children}
        </AnyHarnessWorkspace>
      </CloudWorkspaceMaterializationCacheBoundary>
    </AnyHarnessRuntime>
  );
}

function CloudWorkspaceMaterializationCacheBoundary({ children }: { children: ReactNode }) {
  useCloudWorkspaceMaterializationCacheBoundary();
  return children;
}
