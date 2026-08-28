import {
  anyHarnessAgentLaunchOptionsPrefixKey,
  anyHarnessAgentReconcileStatusKey,
  anyHarnessAgentsKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { nativeBridgeKey } from "#product/hooks/access/anyharness/agents/use-native-bridge";

export function useAgentResourcesCache() {
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  const invalidateAgentListResources = useCallback(async (
    runtimeUrl: string,
    options?: { throwOnError?: boolean },
  ) => {
    const normalizedRuntimeUrl = runtimeUrl.trim();
    if (!normalizedRuntimeUrl) {
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries(
        {
          queryKey: anyHarnessAgentsKey(normalizedRuntimeUrl, cacheScopeKey),
        },
        { throwOnError: options?.throwOnError ?? false },
      ),
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
      // The native-migration bridge: an applied auth document clears the
      // flags of every harness it names (runtime-side), so the one-time
      // prompt must re-read — otherwise the banner keeps saying "X is using
      // your own login" after the user just configured X.
      queryClient.invalidateQueries({
        queryKey: nativeBridgeKey(normalizedRuntimeUrl, cacheScopeKey),
      }),
    ]);
  }, [cacheScopeKey, invalidateAgentSetupResources, queryClient]);

  return {
    invalidateAgentLaunchReadinessResources,
    invalidateAgentListResources,
    invalidateAgentSetupResources,
  };
}
