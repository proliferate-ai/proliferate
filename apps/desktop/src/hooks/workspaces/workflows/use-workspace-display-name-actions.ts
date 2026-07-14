import { useMutation } from "@tanstack/react-query";
import {
  updateWorkspaceDisplayName as updateAnyHarnessWorkspaceDisplayName,
} from "@/lib/access/anyharness/workspaces";
import { useWorkspaceCollectionsInvalidation } from "@/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaceCollectionsMutationCache } from "@/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { findLogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import {
  updateCloudWorkspaceDisplayName,
} from "@proliferate/cloud-sdk/client/workspaces";
import { getCloudWorkspaceConnectionWithRetry } from "@/lib/access/cloud/workspace-connection-retry";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import {
  clearCloudDisplayNameBackfillSuppression,
  suppressCloudDisplayNameBackfill,
} from "@/hooks/workspaces/lifecycle/cloud-display-name-backfill-suppression";
import {
  finishMeasurementOperation,
  recordMeasurementMetric,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { getMeasurementRequestOptions } from "@/lib/infra/measurement/debug-measurement-request-options";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import {
  type CloudSandboxGatewayUrlSource,
  withFreshCloudSandboxGatewayAccessToken,
} from "@/lib/access/cloud/cloud-sandbox-gateway";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

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
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const cloudClient = useProductHost().cloud.client;

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
        const cloudWorkspaceId = logicalWorkspace.cloudWorkspace.id;
        const clearsDisplayName = displayName === null;
        if (clearsDisplayName) {
          await clearCloudRuntimeWorkspaceDisplayName({
            cloudWorkspaceId,
            operationId,
            selectedCloudRuntime,
            cloudClient,
          });
        }

        // Cloud entries: PATCH the cloud control plane. The collection
        // refetch below picks up the new display name from the next list
        // call. We don't optimistically prime because the cloud collection
        // is a separate slice with its own shape.
        await updateCloudWorkspaceDisplayName(
          cloudWorkspaceId,
          displayName,
          operationId ? { measurementOperationId: operationId } : undefined,
        );
        if (clearsDisplayName) {
          suppressCloudDisplayNameBackfill(cloudWorkspaceId);
        } else {
          clearCloudDisplayNameBackfillSuppression(cloudWorkspaceId);
        }
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

async function clearCloudRuntimeWorkspaceDisplayName(input: {
  cloudWorkspaceId: string;
  operationId: MeasurementOperationId | null;
  selectedCloudRuntime: ReturnType<typeof useSelectedCloudRuntimeState>;
  cloudClient: CloudSandboxGatewayUrlSource | null;
}): Promise<void> {
  try {
    const connectionInfo =
      input.selectedCloudRuntime.cloudWorkspaceId === input.cloudWorkspaceId
        && input.selectedCloudRuntime.connectionInfo
        ? input.selectedCloudRuntime.connectionInfo
        : await getCloudWorkspaceConnectionWithRetry(input.cloudWorkspaceId, input.cloudClient);
    if (!connectionInfo?.anyharnessWorkspaceId) {
      return;
    }
    const freshConnectionInfo = await withFreshCloudSandboxGatewayAccessToken(connectionInfo);

    await updateAnyHarnessWorkspaceDisplayName(
      {
        runtimeUrl: freshConnectionInfo.runtimeUrl,
        authToken: freshConnectionInfo.accessToken,
      },
      connectionInfo.anyharnessWorkspaceId,
      { displayName: null },
      getMeasurementRequestOptions({
        operationId: input.operationId,
        category: "workspace.display_name.update",
      }),
    );
  } catch {
    // A cloud workspace may be stopped or temporarily unreachable. The durable
    // backfill suppression marker below still prevents local stale-name restore.
  }
}
