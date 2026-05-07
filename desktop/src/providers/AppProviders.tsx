import {
  AnyHarnessRuntime,
  AnyHarnessWorkspace,
  anyHarnessCoworkStatusKey,
} from "@anyharness/sdk-react";
import type { CoworkStatus } from "@anyharness/sdk";
import type { CloudMobilityWorkspaceSummary } from "@/lib/access/cloud/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, type ReactNode } from "react";
import { appQueryClient } from "@/lib/infra/query/query-client";
import { resolveWorkspaceConnection } from "@/lib/access/anyharness/resolve-workspace-connection";
import {
  buildLogicalWorkspaces,
  findLogicalWorkspace,
  logicalWorkspaceCloudMaterializationId,
  resolveLogicalWorkspaceMaterializationId,
} from "@/lib/domain/workspaces/logical-workspaces";
import { buildStandardRepoProjection } from "@/lib/domain/workspaces/standard-projection";
import { cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import { cloudWorkspaceConnectionQueryOptions } from "@/hooks/cloud/use-cloud-workspace-connection";
import { getWorkspaceCollectionsFromCache } from "@/hooks/workspaces/query-keys";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { TelemetryProvider } from "./TelemetryProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={appQueryClient}>
      <WorkspaceProviders>
        <TelemetryProvider>{children}</TelemetryProvider>
      </WorkspaceProviders>
    </QueryClientProvider>
  );
}

function WorkspaceProviders({ children }: { children: ReactNode }) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const resolveConnection = useCallback(
    (workspaceId: string) => {
      const workspaceCollections = getWorkspaceCollectionsFromCache(appQueryClient, runtimeUrl);
      const cloudMobilityWorkspaces = appQueryClient.getQueryData<CloudMobilityWorkspaceSummary[]>(
        cloudMobilityWorkspacesKey(),
      );
      const coworkStatus = appQueryClient.getQueryData<CoworkStatus>(
        anyHarnessCoworkStatusKey(runtimeUrl),
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
