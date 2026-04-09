import { AnyHarnessRuntime, AnyHarnessWorkspace } from "@anyharness/sdk-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, type ReactNode } from "react";
import { appQueryClient } from "@/lib/infra/query-client";
import { resolveWorkspaceConnection } from "@/lib/integrations/anyharness/resolve-workspace-connection";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { cloudWorkspaceConnectionQueryOptions } from "@/hooks/cloud/use-cloud-workspace-connection";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { TelemetryProvider } from "./TelemetryProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={appQueryClient}>
      <TelemetryProvider>
        <WorkspaceProviders>{children}</WorkspaceProviders>
      </TelemetryProvider>
    </QueryClientProvider>
  );
}

function WorkspaceProviders({ children }: { children: ReactNode }) {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const resolveConnection = useCallback(
    (workspaceId: string) => {
      if (workspaceId === selectedWorkspaceId) {
        const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
        if (cloudWorkspaceId) {
          return appQueryClient.fetchQuery(
            cloudWorkspaceConnectionQueryOptions(cloudWorkspaceId),
          ).then((connectionInfo) => ({
              runtimeUrl: connectionInfo.runtimeUrl,
              authToken: connectionInfo.accessToken,
              anyharnessWorkspaceId: connectionInfo.anyharnessWorkspaceId ?? "",
            }));
        }
      }
      return resolveWorkspaceConnection(runtimeUrl, workspaceId);
    },
    [runtimeUrl, selectedWorkspaceId],
  );

  return (
    <AnyHarnessRuntime runtimeUrl={runtimeUrl}>
      <AnyHarnessWorkspace
        workspaceId={selectedWorkspaceId}
        resolveConnection={resolveConnection}
      >
        {children}
      </AnyHarnessWorkspace>
    </AnyHarnessRuntime>
  );
}
