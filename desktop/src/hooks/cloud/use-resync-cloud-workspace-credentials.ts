import {
  anyHarnessAgentsKey,
  anyHarnessProviderConfigsKey,
  anyHarnessWorkspaceSessionLaunchKey,
} from "@anyharness/sdk-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import { resyncCloudWorkspaceCredentials } from "@/lib/access/cloud/workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { isCloudWorkspaceConnectionQueryKey } from "@/hooks/access/cloud/query-keys";

export function useResyncCloudWorkspaceCredentials(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);

  return useMutation<CloudWorkspaceDetail, Error, void>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async () => {
      if (!workspaceId) {
        throw new Error("A cloud workspace is required.");
      }
      return await resyncCloudWorkspaceCredentials(workspaceId);
    },
    onSuccess: async (workspace) => {
      const invalidations = [
        queryClient.invalidateQueries({
          predicate: (query) => isCloudWorkspaceConnectionQueryKey(query.queryKey),
        }),
      ];
      if (parseCloudWorkspaceSyntheticId(selectedWorkspaceId) === workspace.id) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: anyHarnessAgentsKey(runtimeUrl),
          }),
          queryClient.invalidateQueries({
            queryKey: anyHarnessProviderConfigsKey(runtimeUrl),
          }),
          queryClient.invalidateQueries({
            queryKey: anyHarnessWorkspaceSessionLaunchKey(runtimeUrl, selectedWorkspaceId),
          }),
        );
      }
      await Promise.all(invalidations);
      trackProductEvent("cloud_workspace_credentials_resynced", undefined);
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "resync_cloud_workspace_credentials",
          domain: "cloud_workspace",
        },
      });
    },
  });
}
