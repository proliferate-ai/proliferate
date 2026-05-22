import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  saveOrganizationCloudRepoConfig,
} from "@proliferate/cloud-sdk/client/repo-configs";
import type { SaveCloudRepoConfigRequest } from "@proliferate/cloud-sdk/types";
import type { CloudRepoConfig } from "@/lib/domain/cloud/repo-configs";
import {
  organizationCloudRepoConfigKey,
  organizationCloudRepoConfigsKey,
} from "./query-keys";

interface SaveOrganizationCloudRepoConfigInput {
  organizationId: string;
  gitOwner: string;
  gitRepoName: string;
  configured?: boolean;
  defaultBranch: string | null;
  envVars: Record<string, string>;
  setupScript: string;
  runCommand: string;
  files?: SaveCloudRepoConfigRequest["files"];
}

export function useSaveOrganizationCloudRepoConfig() {
  const queryClient = useQueryClient();

  return useMutation<CloudRepoConfig, Error, SaveOrganizationCloudRepoConfigInput>({
    mutationFn: async ({
      organizationId,
      gitOwner,
      gitRepoName,
      configured = true,
      defaultBranch,
      envVars,
      setupScript,
      runCommand,
      files,
    }) => await saveOrganizationCloudRepoConfig(
      organizationId,
      gitOwner,
      gitRepoName,
      {
        configured,
        defaultBranch,
        envVars,
        setupScript,
        runCommand,
        ...(files ? { files } : {}),
      },
    ),
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({
        queryKey: organizationCloudRepoConfigsKey(variables.organizationId),
      });
      await queryClient.invalidateQueries({
        queryKey: organizationCloudRepoConfigKey(
          variables.organizationId,
          variables.gitOwner,
          variables.gitRepoName,
        ),
      });
    },
  });
}
