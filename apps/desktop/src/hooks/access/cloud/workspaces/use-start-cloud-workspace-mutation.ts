import { useMutation, useQueryClient } from "@tanstack/react-query";
import { startCloudWorkspace } from "@proliferate/cloud-sdk/client/workspaces";
import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import { cloudBillingKey } from "@/hooks/access/cloud/query-keys";
import { clearCachedCloudConnections } from "@/hooks/access/cloud/cloud-connection-cache";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/cache/query-keys";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { resolveCloudWorkspaceStatus } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";

interface StartCloudWorkspaceMutationOptions {
  telemetryAction?: string;
}

export function useStartCloudWorkspaceMutation(
  options: StartCloudWorkspaceMutationOptions = {},
) {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const telemetryAction = options.telemetryAction ?? "start_cloud_workspace";

  return useMutation<CloudWorkspaceDetail, Error, string>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (workspaceId) => startCloudWorkspace(workspaceId),
    onSuccess: async (workspace) => {
      await Promise.all([
        clearCachedCloudConnections(queryClient, workspace.id),
        queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        }),
        queryClient.invalidateQueries({
          queryKey: cloudBillingKey(),
        }),
      ]);
      trackProductEvent("cloud_workspace_started", {
        workspace_kind: "cloud",
        status: resolveCloudWorkspaceStatus(workspace) ?? "unknown",
        git_provider: workspace.repo.provider,
      });
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: telemetryAction,
          domain: "cloud_workspace",
          workspace_kind: "cloud",
        },
      });
    },
  });
}
