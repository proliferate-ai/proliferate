import { useQueryClient } from "@tanstack/react-query";
import {
  anyHarnessWorkspaceFileSearchScopeKey,
  anyHarnessWorkspaceFilesScopeKey,
} from "@anyharness/sdk-react";
import { useCallback } from "react";

export function useWorkspaceFilesCache() {
  const queryClient = useQueryClient();

  const invalidateWorkspaceFiles = useCallback(async ({
    runtimeUrl,
    workspaceId,
  }: {
    runtimeUrl: string;
    workspaceId: string;
  }) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceFilesScopeKey(runtimeUrl, workspaceId),
      }),
      queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceFileSearchScopeKey(runtimeUrl, workspaceId),
      }),
    ]);
  }, [queryClient]);

  return {
    invalidateWorkspaceFiles,
  };
}
