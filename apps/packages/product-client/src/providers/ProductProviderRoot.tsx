import {
  AnyHarnessRuntime,
  AnyHarnessWorkspace,
} from "@anyharness/sdk-react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useCallback, useMemo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { resolveRouteScopedWorkspaceProviderId } from "#product/lib/domain/workspaces/selection/workspace-provider-scope";
import { useResolveWorkspaceConnection } from "#product/hooks/workspaces/cache/use-resolve-workspace-connection";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import type { AuthClientStatus } from "#product/lib/domain/auth/auth-state-mapping";
import { buildAnyHarnessCacheScopeKey } from "#product/lib/domain/auth/anyharness-cache-scope";
import { useCloudWorkspaceMaterializationCacheBoundary } from "#product/hooks/workspaces/cache/use-cloud-workspace-materialization-cache-boundary";
import { TelemetryProvider } from "#product/providers/TelemetryProvider";
import {
  ProductWorkspaceConnectionProvider,
} from "#product/providers/ProductWorkspaceConnectionProvider";
import { WorkspacePathProvider } from "#product/providers/WorkspacePathProvider";

/**
 * Product-owned provider root. Wraps the AnyHarness/workspace product scope and
 * the product telemetry lifecycle composition. It reads the single ProductHost,
 * Query cache, and Cloud client mounted by `DesktopHostProviders` above it; it
 * constructs none of them. This is the tree that moves into ProductClient later.
 */
export function ProductProviderRoot({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProviders>
      <TelemetryProvider>{children}</TelemetryProvider>
    </WorkspaceProviders>
  );
}

function WorkspaceProviders({ children }: { children: ReactNode }) {
  const host = useProductHost();
  const cloudClient = host.cloud.client;
  const apiBaseUrl = host.deployment.apiBaseUrl;
  const authState = host.auth.state;
  const authStatus = authState.status;
  const authUserId =
    authState.status === "authenticated" ? (authState.user?.id ?? null) : null;
  // The AnyHarness cache-scope key embeds the auth status string verbatim, so
  // the shared `loading` maps back to the Desktop `bootstrapping` spelling to
  // keep the exact cache namespace unchanged.
  const cacheAuthStatus: AuthClientStatus =
    authStatus === "loading" ? "bootstrapping" : authStatus;
  const location = useLocation();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const runtimeConnectionState = useHarnessConnectionStore((state) => state.connectionState);
  const readyRuntimeUrl = runtimeConnectionState === "healthy" ? runtimeUrl : "";
  const cacheScopeKey = useMemo(() => buildAnyHarnessCacheScopeKey({
    apiBaseUrl,
    authStatus: cacheAuthStatus,
    authUserId,
  }), [apiBaseUrl, cacheAuthStatus, authUserId]);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const providerWorkspaceId = resolveRouteScopedWorkspaceProviderId({
    pathname: location.pathname,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  });
  const resolveProductConnection = useResolveWorkspaceConnection({
    cloudClient,
    runtimeUrl,
    authStatus,
    authUserId,
    cacheScopeKey,
    selectedWorkspaceId,
  });
  const resolveAnyHarnessConnection = useCallback(async (workspaceId: string) => (
    await resolveProductConnection(workspaceId)
  ).connection, [resolveProductConnection]);

  return (
    <AnyHarnessRuntime runtimeUrl={readyRuntimeUrl || null} cacheScopeKey={cacheScopeKey}>
      <CloudWorkspaceMaterializationCacheBoundary>
        <ProductWorkspaceConnectionProvider
          resolveConnection={resolveProductConnection}
        >
          <AnyHarnessWorkspace
            workspaceId={providerWorkspaceId}
            resolveConnection={resolveAnyHarnessConnection}
          >
            <WorkspacePathProvider>{children}</WorkspacePathProvider>
          </AnyHarnessWorkspace>
        </ProductWorkspaceConnectionProvider>
      </CloudWorkspaceMaterializationCacheBoundary>
    </AnyHarnessRuntime>
  );
}

function CloudWorkspaceMaterializationCacheBoundary({ children }: { children: ReactNode }) {
  useCloudWorkspaceMaterializationCacheBoundary();
  return children;
}
