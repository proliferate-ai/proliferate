import { useMutation } from "@tanstack/react-query";
import { resyncCloudRepoFileFromLocal } from "@/lib/access/cloud/repo-configs";
import { readRepoTrackedTextFile } from "@/lib/access/anyharness/workspace-file-transport";
import type { CloudRepoConfig } from "@/lib/domain/cloud/repo-configs";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useCloudRepoConfigCache } from "@/hooks/access/cloud/use-cloud-repo-config-cache";
import { emitRuntimeInputSyncEvent } from "../lifecycle/runtime-input-sync-events";

export function useResyncCloudRepoFile(repository: SettingsRepositoryEntry | null) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { invalidateCloudRepoConfigs } = useCloudRepoConfigCache();

  return useMutation<CloudRepoConfig, Error, { relativePath: string }>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async ({ relativePath }) => {
      if (!repository?.gitOwner || !repository.gitRepoName) {
        throw new Error("A GitHub-backed repository is required.");
      }
      if (!repository.localWorkspaceId && !repository.repoRootId) {
        throw new Error("A local workspace or repo root is required to resync files from disk.");
      }
      if (!runtimeUrl.trim()) {
        throw new Error("Local runtime is not connected.");
      }

      const file = await readRepoTrackedTextFile(
        runtimeUrl,
        {
          localWorkspaceId: repository.localWorkspaceId,
          repoRootId: repository.repoRootId,
        },
        relativePath,
      );
      return await resyncCloudRepoFileFromLocal(repository.gitOwner, repository.gitRepoName, {
        relativePath,
        content: file.content,
      });
    },
    onSuccess: async (response, variables) => {
      if (!repository?.gitOwner || !repository.gitRepoName) {
        return;
      }

      await invalidateCloudRepoConfigs(repository);

      trackProductEvent("cloud_repo_file_resynced", {
        tracked_file_count: response.trackedFiles.length,
        tracked_file_source: repository.localWorkspaceId ? "workspace" : "repo_root",
      });
      if (repository.localWorkspaceId || repository.repoRootId) {
        emitRuntimeInputSyncEvent({
          trigger: "repo_config_mutation",
          descriptors: [{
            kind: "repo_tracked_file",
            gitOwner: repository.gitOwner,
            gitRepoName: repository.gitRepoName,
            localWorkspaceId: repository.localWorkspaceId,
            repoRootId: repository.repoRootId,
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
