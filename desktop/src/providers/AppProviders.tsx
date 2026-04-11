import { AnyHarnessRuntime, AnyHarnessWorkspace } from "@anyharness/sdk-react";
import type { CloudMobilityWorkspaceSummary } from "@/lib/integrations/cloud/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, type ReactNode } from "react";
import { appQueryClient } from "@/lib/infra/query-client";
import { resolveWorkspaceConnection } from "@/lib/integrations/anyharness/resolve-workspace-connection";
import {
  buildLogicalWorkspaces,
  findLogicalWorkspace,
  logicalWorkspaceCloudMaterializationId,
  resolveLogicalWorkspaceMaterializationId,
} from "@/lib/domain/workspaces/logical-workspaces";
import { cloudMobilityWorkspacesKey } from "@/hooks/cloud/query-keys";
import { cloudWorkspaceConnectionQueryOptions } from "@/hooks/cloud/use-cloud-workspace-connection";
import { getWorkspaceCollectionsFromCache } from "@/hooks/workspaces/query-keys";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
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
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore((state) => state.selectedLogicalWorkspaceId);
  const resolveConnection = useCallback(
    (workspaceId: string) => {
      const workspaceCollections = getWorkspaceCollectionsFromCache(appQueryClient, runtimeUrl);
      const cloudMobilityWorkspaces = appQueryClient.getQueryData<CloudMobilityWorkspaceSummary[]>(
        cloudMobilityWorkspacesKey(),
      );
      const logicalWorkspaces = workspaceCollections
        ? buildLogicalWorkspaces({
          localWorkspaces: workspaceCollections.localWorkspaces,
          repoRoots: workspaceCollections.repoRoots,
          cloudWorkspaces: workspaceCollections.cloudWorkspaces,
          cloudMobilityWorkspaces,
          currentSelectionId: selectedWorkspaceId,
        })
        : [];
      const logicalWorkspace = findLogicalWorkspace(logicalWorkspaces, workspaceId);
      if (logicalWorkspace) {
        const explicitCloudMaterializationId = logicalWorkspaceCloudMaterializationId(logicalWorkspace);
        const explicitLocalMaterializationId = logicalWorkspace.localWorkspace?.id ?? null;
        const materializationId = (
          workspaceId === explicitCloudMaterializationId
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
          explicitCloudMaterializationId
          && materializationId === explicitCloudMaterializationId
        ) {
          return appQueryClient.fetchQuery(
            cloudWorkspaceConnectionQueryOptions(
              logicalWorkspace.cloudWorkspace?.id
                ?? logicalWorkspace.mobilityWorkspace?.cloudWorkspaceId
                ?? "",
            ),
          ).then((connectionInfo) => ({
            runtimeUrl: connectionInfo.runtimeUrl,
            authToken: connectionInfo.accessToken,
            anyharnessWorkspaceId: connectionInfo.anyharnessWorkspaceId ?? "",
          }));
        }

        if (
          logicalWorkspace.localWorkspace
          && materializationId === logicalWorkspace.localWorkspace.id
        ) {
          return resolveWorkspaceConnection(runtimeUrl, logicalWorkspace.localWorkspace.id);
        }
      }

      return resolveWorkspaceConnection(runtimeUrl, workspaceId);
    },
    [runtimeUrl, selectedWorkspaceId],
  );

  return (
    <AnyHarnessRuntime runtimeUrl={runtimeUrl}>
      <AnyHarnessWorkspace
        workspaceId={selectedLogicalWorkspaceId ?? selectedWorkspaceId}
        resolveConnection={resolveConnection}
      >
        {children}
      </AnyHarnessWorkspace>
    </AnyHarnessRuntime>
  );
}
