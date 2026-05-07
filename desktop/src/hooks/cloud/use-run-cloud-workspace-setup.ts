import { anyHarnessWorkspaceSetupStatusKey } from "@anyharness/sdk-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RunCloudWorkspaceSetupResponse } from "@/lib/access/cloud/client";
import { runCloudWorkspaceSetup } from "@/lib/access/cloud/repo-configs";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { cloudWorkspaceRepoConfigStatusKey } from "@/hooks/access/cloud/query-keys";

export function useRunCloudWorkspaceSetup(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);

  return useMutation<RunCloudWorkspaceSetupResponse, Error, void>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async () => {
      if (!workspaceId) {
        throw new Error("A cloud workspace is required.");
      }
      return await runCloudWorkspaceSetup(workspaceId);
    },
    onSuccess: async (response: RunCloudWorkspaceSetupResponse) => {
      const invalidations = [
        queryClient.invalidateQueries({
          queryKey: cloudWorkspaceRepoConfigStatusKey(response.workspaceId),
        }),
      ];
      if (parseCloudWorkspaceSyntheticId(selectedWorkspaceId) === response.workspaceId) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: anyHarnessWorkspaceSetupStatusKey(runtimeUrl, selectedWorkspaceId),
          }),
        );
      }
      await Promise.all(invalidations);
      trackProductEvent("cloud_workspace_setup_started", {
        has_saved_script: response.command.trim().length > 0,
      });
    },
    onError: (error: Error) => {
      captureTelemetryException(error, {
        tags: {
          action: "run_cloud_workspace_setup",
          domain: "cloud_repo_config",
        },
      });
    },
  });
}
