import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ResyncCloudWorkspaceFilesResponse } from "@/lib/access/cloud/client";
import { resyncCloudWorkspaceFiles } from "@/lib/access/cloud/repo-configs";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { cloudWorkspaceRepoConfigStatusKey } from "@/hooks/access/cloud/query-keys";

export function useResyncCloudWorkspaceFiles(workspaceId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<ResyncCloudWorkspaceFilesResponse, Error, void>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async () => {
      if (!workspaceId) {
        throw new Error("A cloud workspace is required.");
      }
      return await resyncCloudWorkspaceFiles(workspaceId);
    },
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({
        queryKey: cloudWorkspaceRepoConfigStatusKey(response.workspaceId),
      });
      trackProductEvent("cloud_workspace_repo_files_resynced", {
        files_out_of_sync: response.filesOutOfSync,
        tracked_file_count: response.trackedFiles.length,
      });
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "resync_cloud_workspace_files",
          domain: "cloud_repo_config",
        },
      });
    },
  });
}
