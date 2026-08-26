import { useMutation } from "@tanstack/react-query";
import {
  updateWorkspaceDisplayName as updateAnyHarnessWorkspaceDisplayName,
} from "#product/lib/access/anyharness/workspaces";
import { useWorkspaceCollectionsInvalidation } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaceCollectionsMutationCache } from "#product/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { findLogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";
import { useLogicalWorkspaces } from "#product/hooks/workspaces/derived/use-logical-workspaces";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import {
  finishMeasurementOperation,
  recordMeasurementMetric,
  startMeasurementOperation,
} from "#product/lib/infra/measurement/measurement-port";
import { getMeasurementRequestOptions } from "#product/lib/infra/measurement/measurement-port";

interface UpdateWorkspaceDisplayNameInput {
  /** Logical workspace id. */
  workspaceId: string;
  displayName: string | null;
}

export function useWorkspaceDisplayNameActions() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { upsertLocalWorkspace } = useWorkspaceCollectionsMutationCache(runtimeUrl);
  const invalidateWorkspaceCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const telemetry = useProductTelemetry();

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

      // Cloud-only entries used to PATCH the cloud control plane; that stack
      // is deleted, so they fall into the unavailable case below.
      if (!logicalWorkspace.localWorkspace) {
        throw new Error("Workspace rename is not available for this materialization.");
      }

      // Local AnyHarness workspaces: PATCH the runtime, then prime the
      // local-workspace cache so the sidebar updates without a roundtrip.
      const workspace = await updateAnyHarnessWorkspaceDisplayName(
        { runtimeUrl },
        logicalWorkspace.localWorkspace.id,
        { displayName },
        getMeasurementRequestOptions({
          operationId,
          category: "workspace.display_name.update",
        }),
      );
      const storeStartedAt = performance.now();
      upsertLocalWorkspace(workspace);
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
      void invalidateWorkspaceCollections();
    },
    onError: (error) => {
      telemetry.captureException(error, {
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
