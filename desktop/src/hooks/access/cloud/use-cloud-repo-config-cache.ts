import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  cloudRepoConfigKey,
  cloudRepoConfigsKey,
  isCloudWorkspaceRepoConfigStatusQueryKey,
} from "@/hooks/access/cloud/query-keys";

export function useCloudRepoConfigCache() {
  const queryClient = useQueryClient();

  const invalidateCloudRepoConfigs = useCallback(async (input?: {
    gitOwner?: string | null;
    gitRepoName?: string | null;
  }) => {
    const gitOwner = input?.gitOwner?.trim() ?? "";
    const gitRepoName = input?.gitRepoName?.trim() ?? "";
    const invalidations: Promise<unknown>[] = [
      queryClient.invalidateQueries({ queryKey: cloudRepoConfigsKey() }),
      queryClient.invalidateQueries({
        predicate: (query) => isCloudWorkspaceRepoConfigStatusQueryKey(query.queryKey),
      }),
    ];

    if (gitOwner && gitRepoName) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: cloudRepoConfigKey(gitOwner, gitRepoName) }),
      );
    }

    await Promise.all(invalidations);
  }, [queryClient]);

  return {
    invalidateCloudRepoConfigs,
  };
}
