import { AnyHarnessRuntime, AnyHarnessWorkspace } from "@anyharness/sdk-react";
import type { ReactNode } from "react";

import { useCloudWorkspaceMaterializationCacheBoundary } from "@/hooks/workspaces/cache/use-cloud-workspace-materialization-cache-boundary";
import { useProductWorkspaceProvider } from "@/hooks/workspaces/cache/use-product-workspace-provider";

import { TelemetryProvider } from "./TelemetryProvider";

export function ProductProviderRoot({ children }: { children: ReactNode }) {
  const workspace = useProductWorkspaceProvider();

  return (
    <AnyHarnessRuntime
      runtimeUrl={workspace.runtimeUrl || null}
      cacheScopeKey={workspace.cacheScopeKey}
    >
      <CloudWorkspaceMaterializationCacheBoundary>
        <AnyHarnessWorkspace
          workspaceId={workspace.providerWorkspaceId}
          resolveConnection={workspace.resolveConnection}
        >
          <TelemetryProvider>{children}</TelemetryProvider>
        </AnyHarnessWorkspace>
      </CloudWorkspaceMaterializationCacheBoundary>
    </AnyHarnessRuntime>
  );
}

function CloudWorkspaceMaterializationCacheBoundary({ children }: { children: ReactNode }) {
  useCloudWorkspaceMaterializationCacheBoundary();
  return children;
}
