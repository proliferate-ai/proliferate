import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  saveOrganizationCloudRepoConfig,
} from "@proliferate/cloud-sdk/client/repo-configs";
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
