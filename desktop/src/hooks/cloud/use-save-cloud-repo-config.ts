import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CloudRepoConfigResponse } from "@/lib/integrations/cloud/client";
import { saveCloudRepoConfig } from "@/lib/integrations/cloud/repo-configs";
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

interface SaveCloudRepoConfigInput {
  defaultBranch: string | null;
  envVars: Record<string, string>;
  trackedFilePaths: string[];
  setupScript: string;
}

async function buildTrackedFilesPayload(
  runtimeUrl: string,
  repository: SettingsRepositoryEntry,
  trackedFilePaths: string[],
) {
  const localWorkspaceId = repository.localWorkspaceId?.trim();
  if (!localWorkspaceId) {
    throw new Error("A local workspace is required to read tracked files.");
  }

  return await Promise.all(
    trackedFilePaths.map(async (relativePath) => ({
      relativePath,
      content: await readWorkspaceTextFile(
        runtimeUrl,
        localWorkspaceId,
        relativePath,
      ),
    })),
  );
}

export function useSaveCloudRepoConfig(repository: SettingsRepositoryEntry | null) {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const queryClient = useQueryClient();

  return useMutation<CloudRepoConfigResponse, Error, SaveCloudRepoConfigInput>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async ({ defaultBranch, envVars, trackedFilePaths, setupScript }) => {
      if (!repository?.gitOwner || !repository.gitRepoName) {
        throw new Error("A GitHub-backed repository is required.");
      }
      if (!runtimeUrl.trim()) {
        throw new Error("Local runtime is not connected.");
      }

      const files = await buildTrackedFilesPayload(runtimeUrl, repository, trackedFilePaths);
      return await saveCloudRepoConfig(repository.gitOwner, repository.gitRepoName, {
        configured: true,
        defaultBranch,
        envVars,
        setupScript,
        files,
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

      trackProductEvent("cloud_repo_config_saved", {
        env_var_count: Object.keys(variables.envVars).length,
        tracked_file_count: response.trackedFiles.length,
        has_setup_script: response.setupScript.trim().length > 0,
      });
      if (repository.localWorkspaceId && repository.gitOwner && repository.gitRepoName) {
        const { gitOwner, gitRepoName, localWorkspaceId } = repository;
        emitRuntimeInputSyncEvent({
          trigger: "repo_config_mutation",
          descriptors: response.trackedFiles.map((file) => ({
            kind: "repo_tracked_file",
            gitOwner,
            gitRepoName,
            localWorkspaceId,
            relativePath: file.relativePath,
          })),
        });
      }
    },
    onError: (error, variables) => {
      captureTelemetryException(error, {
        tags: {
          action: "save_cloud_repo_config",
          domain: "cloud_repo_config",
        },
        extras: {
          envVarCount: Object.keys(variables.envVars).length,
          trackedFileCount: variables.trackedFilePaths.length,
          hasSetupScript: variables.setupScript.trim().length > 0,
        },
      });
    },
  });
}
