import {
  anyHarnessAgentReconcileStatusKey,
  anyHarnessAgentsKey,
  anyHarnessProviderConfigsKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export function useAgentResourcesCache() {
  const queryClient = useQueryClient();

  const invalidateAgentListResources = useCallback(async (runtimeUrl: string) => {
    const normalizedRuntimeUrl = runtimeUrl.trim();
    if (!normalizedRuntimeUrl) {
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: anyHarnessAgentsKey(normalizedRuntimeUrl),
      }),
      queryClient.invalidateQueries({
        queryKey: anyHarnessProviderConfigsKey(normalizedRuntimeUrl),
      }),
    ]);
  }, [queryClient]);

  const invalidateAgentSetupResources = useCallback(async (runtimeUrl: string) => {
    const normalizedRuntimeUrl = runtimeUrl.trim();
    if (!normalizedRuntimeUrl) {
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: anyHarnessAgentsKey(normalizedRuntimeUrl),
      }),
      queryClient.invalidateQueries({
        queryKey: anyHarnessProviderConfigsKey(normalizedRuntimeUrl),
      }),
      queryClient.invalidateQueries({
        queryKey: anyHarnessAgentReconcileStatusKey(normalizedRuntimeUrl),
      }),
    ]);
  }, [queryClient]);

  return {
    invalidateAgentListResources,
    invalidateAgentSetupResources,
  };
}
