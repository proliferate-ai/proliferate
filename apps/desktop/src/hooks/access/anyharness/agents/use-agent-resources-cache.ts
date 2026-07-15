import {
  anyHarnessAgentLaunchOptionsPrefixKey,
  anyHarnessAgentReconcileStatusKey,
  anyHarnessAgentsKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export function useAgentResourcesCache() {
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  const invalidateAgentListResources = useCallback(async (runtimeUrl: string) => {
    const normalizedRuntimeUrl = runtimeUrl.trim();
    if (!normalizedRuntimeUrl) {
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: anyHarnessAgentsKey(normalizedRuntimeUrl, cacheScopeKey),
      }),
    ]);
  }, [cacheScopeKey, queryClient]);

  const invalidateAgentSetupResources = useCallback(async (runtimeUrl: string) => {
    const normalizedRuntimeUrl = runtimeUrl.trim();
    if (!normalizedRuntimeUrl) {
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: anyHarnessAgentsKey(normalizedRuntimeUrl, cacheScopeKey),
      }),
      queryClient.invalidateQueries({
        queryKey: anyHarnessAgentReconcileStatusKey(normalizedRuntimeUrl, cacheScopeKey),
      }),
    ]);
  }, [cacheScopeKey, queryClient]);

  const invalidateAgentLaunchReadinessResources = useCallback(async (
    runtimeUrl: string,
  ) => {
    const normalizedRuntimeUrl = runtimeUrl.trim();
    if (!normalizedRuntimeUrl) {
      return;
    }

    await Promise.all([
      invalidateAgentSetupResources(normalizedRuntimeUrl),
      queryClient.invalidateQueries({
        queryKey: anyHarnessAgentLaunchOptionsPrefixKey(
          normalizedRuntimeUrl,
          cacheScopeKey,
        ),
      }),
    ]);
  }, [cacheScopeKey, invalidateAgentSetupResources, queryClient]);

  return {
    invalidateAgentLaunchReadinessResources,
    invalidateAgentListResources,
    invalidateAgentSetupResources,
  };
}
