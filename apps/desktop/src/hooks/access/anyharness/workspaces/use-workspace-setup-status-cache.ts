import type { GetSetupStatusResponse } from "@anyharness/sdk";
import {
  anyHarnessWorkspaceSetupStatusKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export type CachedWorkspaceSetupStatus = GetSetupStatusResponse["status"] | null;

// Owns cached AnyHarness workspace setup-status reads for product workflows.
export function useWorkspaceSetupStatusCache() {
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  const getCachedWorkspaceSetupStatus = useCallback((
    workspaceId: string,
  ): CachedWorkspaceSetupStatus => {
    return queryClient.getQueryData<GetSetupStatusResponse>(
      anyHarnessWorkspaceSetupStatusKey(cacheScopeKey, workspaceId),
    )?.status ?? null;
  }, [cacheScopeKey, queryClient]);

  return {
    getCachedWorkspaceSetupStatus,
  };
}
