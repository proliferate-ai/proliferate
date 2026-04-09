import {
  anyHarnessAgentsKey,
  anyHarnessProviderConfigsKey,
  anyHarnessWorkspaceSessionLaunchKey,
} from "@anyharness/sdk-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CloudWorkspaceDetail } from "@/lib/integrations/cloud/client";
import { resyncCloudWorkspaceCredentials } from "@/lib/integrations/cloud/workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { cloudWorkspaceConnectionKey } from "./query-keys";

export function useResyncCloudWorkspaceCredentials(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);

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
          queryKey: cloudWorkspaceConnectionKey(workspace.id),
          exact: true,
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
