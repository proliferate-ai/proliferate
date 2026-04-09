import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type WorkspaceCollections,
  upsertLocalWorkspaceCollections,
} from "@/lib/domain/workspaces/collections";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { updateCloudWorkspaceDisplayName } from "@/lib/integrations/cloud/workspaces";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { workspaceCollectionsScopeKey } from "./query-keys";

interface UpdateWorkspaceDisplayNameInput {
  /** Local AnyHarness workspace ID OR cloud synthetic ID (`cloud:<uuid>`). */
  workspaceId: string;
  displayName: string | null;
}

export function useWorkspaceDisplayNameActions() {
  const queryClient = useQueryClient();

  const updateMutation = useMutation<void, Error, UpdateWorkspaceDisplayNameInput>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async ({ workspaceId, displayName }) => {
      const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
      if (cloudWorkspaceId) {
        // Cloud entries: PATCH the cloud control plane. The collection
        // refetch below picks up the new display name from the next list
        // call. We don't optimistically prime because the cloud collection
        // is a separate slice with its own shape.
        await updateCloudWorkspaceDisplayName(cloudWorkspaceId, displayName);
        return;
      }

      // Local AnyHarness workspaces: PATCH the runtime, then prime the
      // local-workspace cache so the sidebar updates without a roundtrip.
      const runtimeUrl = useHarnessStore.getState().runtimeUrl;
      const workspace = await getAnyHarnessClient({ runtimeUrl }).workspaces.updateDisplayName(
        workspaceId,
        { displayName },
      );
      queryClient.setQueriesData<WorkspaceCollections | undefined>(
        { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
        (collections) => upsertLocalWorkspaceCollections(collections, workspace),
      );
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
