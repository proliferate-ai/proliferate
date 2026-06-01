import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateCloudWorkspaceLists } from "@proliferate/cloud-sdk-react";

export function useMobileCloudWorkspaceCache() {
  const queryClient = useQueryClient();

  const invalidateWorkspaceLists = useCallback(() => {
    invalidateCloudWorkspaceLists(queryClient);
  }, [queryClient]);

  return { invalidateWorkspaceLists };
}
