import { useCallback } from "react";
import {
  anyHarnessAgentReconcileStatusKey,
  anyHarnessAgentsKey,
  anyHarnessProviderConfigsKey,
  useInstallAgentMutation,
  useReconcileAgentsMutation,
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

export function useAgentInstallationActions() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const connectionState = useHarnessStore((state) => state.connectionState);
  const installMutation = useInstallAgentMutation();
  const reconcileMutation = useReconcileAgentsMutation();

  const isHealthy =
    connectionState === "healthy" && runtimeUrl.trim().length > 0;

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
      return installMutation.mutateAsync({ kind, request });
    },
    [installMutation, isHealthy, runtimeUrl],
  );

  const reconcileAgents = useCallback(
    async (options?: ReconcileAgentsRequest) => {
      assertHealthyRuntime(runtimeUrl, isHealthy);
      return reconcileMutation.mutateAsync(options ?? {});
    },
    [isHealthy, reconcileMutation, runtimeUrl],
  );

  return {
    installAgent,
    isInstallingAgent: installMutation.isPending,
    reconcileAgents,
    refreshAgentResources,
  };
}
