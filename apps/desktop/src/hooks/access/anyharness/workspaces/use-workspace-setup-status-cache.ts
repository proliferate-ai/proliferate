import type { GetSetupStatusResponse } from "@anyharness/sdk";
import { anyHarnessWorkspaceSetupStatusKey } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export type CachedWorkspaceSetupStatus = GetSetupStatusResponse["status"] | null;

// Owns cached AnyHarness workspace setup-status reads for product workflows.
export function useWorkspaceSetupStatusCache() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  const getCachedWorkspaceSetupStatus = useCallback((
    workspaceId: string,
  ): CachedWorkspaceSetupStatus => {
    return queryClient.getQueryData<GetSetupStatusResponse>(
      anyHarnessWorkspaceSetupStatusKey(runtimeUrl, workspaceId),
    )?.status ?? null;
  }, [queryClient, runtimeUrl]);

  return {
    getCachedWorkspaceSetupStatus,
  };
}
