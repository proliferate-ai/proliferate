import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CloudRepoConfigResponse } from "@/lib/integrations/cloud/client";
import { resyncCloudRepoFileFromLocal } from "@/lib/integrations/cloud/repo-configs";
import { readWorkspaceTextFile } from "@/lib/integrations/anyharness/files";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import {
  cloudRepoConfigKey,
  cloudRepoConfigsKey,
  isCloudWorkspaceRepoConfigStatusQueryKey,
} from "./query-keys";
import { emitRuntimeInputSyncEvent } from "./runtime-input-sync-events";

export function useResyncCloudRepoFile(repository: SettingsRepositoryEntry | null) {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const queryClient = useQueryClient();

  return useMutation<CloudRepoConfigResponse, Error, { relativePath: string }>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async ({ relativePath }) => {
      if (!repository?.gitOwner || !repository.gitRepoName) {
        throw new Error("A GitHub-backed repository is required.");
      }
      if (!repository.localWorkspaceId) {
        throw new Error("A local workspace is required to resync files from disk.");
      }
      if (!runtimeUrl.trim()) {
        throw new Error("Local runtime is not connected.");
      }

      const content = await readWorkspaceTextFile(
        runtimeUrl,
        repository.localWorkspaceId,
        relativePath,
      );
      return await resyncCloudRepoFileFromLocal(repository.gitOwner, repository.gitRepoName, {
        relativePath,
        content,
      });
    },
    onSuccess: async (response, variables) => {
      if (!repository?.gitOwner || !repository.gitRepoName) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cloudRepoConfigsKey() }),
        queryClient.invalidateQueries({
          queryKey: cloudRepoConfigKey(repository.gitOwner, repository.gitRepoName),
        }),
        queryClient.invalidateQueries({
          predicate: (query) => isCloudWorkspaceRepoConfigStatusQueryKey(query.queryKey),
        }),
      ]);

      trackProductEvent("cloud_repo_file_resynced", {
        tracked_file_count: response.trackedFiles.length,
      });
      if (repository.localWorkspaceId) {
        emitRuntimeInputSyncEvent({
          trigger: "repo_config_mutation",
          descriptors: [{
            kind: "repo_tracked_file",
            gitOwner: repository.gitOwner,
            gitRepoName: repository.gitRepoName,
            localWorkspaceId: repository.localWorkspaceId,
            relativePath: variables.relativePath,
          }],
        });
      }
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "resync_cloud_repo_file",
          domain: "cloud_repo_config",
        },
      });
    },
  });
}
