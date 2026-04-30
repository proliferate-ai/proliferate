import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type WorkspaceCollections,
  upsertLocalWorkspaceCollections,
} from "@/lib/domain/workspaces/collections";
import { findLogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { updateCloudWorkspaceDisplayName } from "@/lib/integrations/cloud/workspaces";
import { useLogicalWorkspaces } from "@/hooks/workspaces/use-logical-workspaces";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { workspaceCollectionsScopeKey } from "./query-keys";
import {
  finishMeasurementOperation,
  getMeasurementRequestOptions,
  recordMeasurementMetric,
  startMeasurementOperation,
} from "@/lib/infra/debug-measurement";

interface UpdateWorkspaceDisplayNameInput {
  /** Logical workspace id. */
  workspaceId: string;
  displayName: string | null;
}

export function useWorkspaceDisplayNameActions() {
  const queryClient = useQueryClient();
  const { logicalWorkspaces } = useLogicalWorkspaces();

  const updateMutation = useMutation<void, Error, UpdateWorkspaceDisplayNameInput>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async ({ workspaceId, displayName }) => {
      const operationId = startMeasurementOperation({
        kind: "workspace_rename",
        surfaces: ["workspace-sidebar", "global-header", "header-tabs"],
        maxDurationMs: 10_000,
      });
      const logicalWorkspace = findLogicalWorkspace(logicalWorkspaces, workspaceId);
      if (!logicalWorkspace) {
        throw new Error("Workspace not found.");
      }

      if (logicalWorkspace.cloudWorkspace && !logicalWorkspace.localWorkspace) {
        // Cloud entries: PATCH the cloud control plane. The collection
        // refetch below picks up the new display name from the next list
        // call. We don't optimistically prime because the cloud collection
        // is a separate slice with its own shape.
        await updateCloudWorkspaceDisplayName(
          logicalWorkspace.cloudWorkspace.id,
          displayName,
          operationId ? { measurementOperationId: operationId } : undefined,
        );
        if (operationId) {
          finishMeasurementOperation(operationId, "completed");
        }
        return;
      }

      if (!logicalWorkspace.localWorkspace) {
        throw new Error("Workspace rename is not available for this materialization.");
      }

      // Local AnyHarness workspaces: PATCH the runtime, then prime the
      // local-workspace cache so the sidebar updates without a roundtrip.
      const runtimeUrl = useHarnessStore.getState().runtimeUrl;
      const workspace = await getAnyHarnessClient({ runtimeUrl }).workspaces.updateDisplayName(
        logicalWorkspace.localWorkspace.id,
        { displayName },
        getMeasurementRequestOptions({
          operationId,
          category: "workspace.display_name.update",
        }),
      );
      const storeStartedAt = performance.now();
      queryClient.setQueriesData<WorkspaceCollections | undefined>(
        { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
        (collections) => upsertLocalWorkspaceCollections(collections, workspace),
      );
      if (operationId) {
        recordMeasurementMetric({
          type: "store",
          category: "workspace.display_name.update",
          operationId,
          durationMs: performance.now() - storeStartedAt,
        });
        finishMeasurementOperation(operationId, "completed");
      }
    },
    onSuccess: () => {
      const runtimeUrl = useHarnessStore.getState().runtimeUrl;
      void queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      });
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "update_workspace_display_name",
          domain: "workspace",
        },
      });
    },
  });

  return {
    updateWorkspaceDisplayName: (input: UpdateWorkspaceDisplayNameInput) =>
      updateMutation.mutateAsync(input),
    isUpdatingWorkspaceDisplayName: updateMutation.isPending,
  };
}
