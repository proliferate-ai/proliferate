import { useCallback } from "react";
import {
  anyHarnessAgentReconcileStatusKey,
  anyHarnessAgentsKey,
  anyHarnessProviderConfigsKey,
  useInstallAgentMutation,
  useReconcileAgentsMutation,
  useRuntimeHealthQuery,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  InstallAgentRequest,
  ReconcileAgentsRequest,
} from "@anyharness/sdk";
import { useHarnessStore } from "@/stores/sessions/harness-store";

function assertHealthyRuntime(runtimeUrl: string, isHealthy: boolean): void {
  if (!isHealthy || runtimeUrl.trim().length === 0) {
    throw new Error("AnyHarness runtime is not available.");
  }
}

function assertAgentSeedReady(isAgentSeedHydrating: boolean): void {
  if (isAgentSeedHydrating) {
    throw new Error("Agent setup is still finishing. Try again in a moment.");
  }
}

export function useAgentInstallationActions() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const connectionState = useHarnessStore((state) => state.connectionState);
  const installMutation = useInstallAgentMutation();
  const reconcileMutation = useReconcileAgentsMutation();

  const isHealthy =
    connectionState === "healthy" && runtimeUrl.trim().length > 0;
  const { data: runtimeHealth } = useRuntimeHealthQuery({ enabled: isHealthy });
  const isAgentSeedHydrating = runtimeHealth?.agentSeed?.status === "hydrating";

  const refreshAgentResources = useCallback(async () => {
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
  }, [queryClient, runtimeUrl]);

  const installAgent = useCallback(
    async (kind: string, request?: InstallAgentRequest) => {
      assertHealthyRuntime(runtimeUrl, isHealthy);
      assertAgentSeedReady(isAgentSeedHydrating);
      return installMutation.mutateAsync({ kind, request });
    },
    [installMutation, isAgentSeedHydrating, isHealthy, runtimeUrl],
  );

  const reconcileAgents = useCallback(
    async (options?: ReconcileAgentsRequest) => {
      assertHealthyRuntime(runtimeUrl, isHealthy);
      assertAgentSeedReady(isAgentSeedHydrating);
      return reconcileMutation.mutateAsync(options ?? {});
    },
    [isAgentSeedHydrating, isHealthy, reconcileMutation, runtimeUrl],
  );

  return {
    installAgent,
    isAgentSeedHydrating,
    isInstallingAgent: installMutation.isPending,
    reconcileAgents,
    refreshAgentResources,
  };
}
