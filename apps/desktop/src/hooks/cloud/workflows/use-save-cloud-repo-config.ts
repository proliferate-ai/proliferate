import { useMutation } from "@tanstack/react-query";
import { saveCloudRepoConfig } from "@proliferate/cloud-sdk/client/repo-configs";
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

interface SaveCloudRepoConfigInput {
  configured?: boolean;
  defaultBranch: string | null;
  envVars?: Record<string, string>;
  trackedFilePaths?: string[];
  setupScript: string;
  runCommand: string;
}

export async function buildTrackedFilesPayload(
  runtimeUrl: string,
  repository: SettingsRepositoryEntry,
  trackedFilePaths: string[],
) {
  if (trackedFilePaths.length === 0) {
    return [];
  }

  return await Promise.all(
    trackedFilePaths.map(async (relativePath) => {
      const file = await readRepoTrackedTextFile(
        runtimeUrl,
        {
          localWorkspaceId: repository.localWorkspaceId,
          repoRootId: repository.repoRootId,
        },
        relativePath,
      );
      return {
        relativePath,
        content: file.content,
      };
    }),
  );
}

export function useSaveCloudRepoConfig(repository: SettingsRepositoryEntry | null) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { invalidateCloudRepoConfigs } = useCloudRepoConfigCache();

  return useMutation<CloudRepoConfig, Error, SaveCloudRepoConfigInput>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async ({
      configured = true,
      defaultBranch,
      envVars,
      trackedFilePaths = [],
      setupScript,
      runCommand,
    }) => {
      if (!repository?.gitOwner || !repository.gitRepoName) {
        throw new Error("A GitHub-backed repository is required.");
      }
      const canReadTrackedFiles =
        repository.availability !== "cloud" && trackedFilePaths.length > 0;
      if (canReadTrackedFiles && !runtimeUrl.trim()) {
        throw new Error("Local runtime is not connected.");
      }

      const files = canReadTrackedFiles
        ? await buildTrackedFilesPayload(runtimeUrl, repository, trackedFilePaths)
        : undefined;
      return await saveCloudRepoConfig(repository.gitOwner, repository.gitRepoName, {
        configured,
        defaultBranch,
        ...(envVars ? { envVars } : {}),
        setupScript,
        runCommand,
        ...(files ? { files } : {}),
      });
    },
    onSuccess: async (response, variables) => {
      if (!repository?.gitOwner || !repository.gitRepoName) {
        return;
      }

      await invalidateCloudRepoConfigs(repository);

      trackProductEvent("cloud_repo_config_saved", {
        env_var_count: variables.envVars ? Object.keys(variables.envVars).length : 0,
        tracked_file_count: variables.trackedFilePaths?.length ?? 0,
        has_setup_script: response.setupScript.trim().length > 0,
        has_run_command: response.runCommand.trim().length > 0,
      });
      if ((repository.localWorkspaceId || repository.repoRootId) && repository.gitOwner && repository.gitRepoName) {
        const { gitOwner, gitRepoName, localWorkspaceId, repoRootId } = repository;
        emitRuntimeInputSyncEvent({
          trigger: "repo_config_mutation",
          descriptors: response.trackedFiles.map((file) => ({
            kind: "repo_tracked_file",
            gitOwner,
            gitRepoName,
            localWorkspaceId,
            repoRootId,
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
          envVarCount: variables.envVars ? Object.keys(variables.envVars).length : 0,
          trackedFileCount: variables.trackedFilePaths?.length ?? 0,
          hasSetupScript: variables.setupScript.trim().length > 0,
          hasRunCommand: variables.runCommand.trim().length > 0,
        },
      });
    },
  });
}
