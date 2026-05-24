import { useMutation } from "@tanstack/react-query";
import { saveCloudRepoConfig } from "@proliferate/cloud-sdk/client/repo-configs";
import type { SaveCloudRepoConfigRequest } from "@proliferate/cloud-sdk/types";
import type { CloudRepoConfig } from "@/lib/domain/cloud/repo-configs";
import { useCloudRepoConfigCache } from "./use-cloud-repo-config-cache";

interface SavePersonalCloudRepoConfigInput {
  gitOwner: string;
  gitRepoName: string;
  body: SaveCloudRepoConfigRequest;
}

export function useSavePersonalCloudRepoConfig() {
  const { invalidateCloudRepoConfigs } = useCloudRepoConfigCache();

  return useMutation<CloudRepoConfig, Error, SavePersonalCloudRepoConfigInput>({
    mutationFn: async ({ gitOwner, gitRepoName, body }) =>
      await saveCloudRepoConfig(gitOwner, gitRepoName, body),
    onSuccess: async (_response, variables) => {
      await invalidateCloudRepoConfigs(variables);
    },
  });
}
