import { useCallback } from "react";
import {
  useInstallAgentMutation,
  useReconcileAgentsMutation,
  useRuntimeHealthQuery,
} from "@anyharness/sdk-react";
import type {
  InstallAgentRequest,
  ReconcileAgentsRequest,
} from "@anyharness/sdk";
import { useAgentResourcesCache } from "@/hooks/agents/cache/use-agent-resources-cache";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

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
  // Owns manual agent install/reconcile actions. Agent query-cache shape stays
  // behind the agents cache hook.
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const { invalidateAgentSetupResources } = useAgentResourcesCache();
  const installMutation = useInstallAgentMutation();
  const reconcileMutation = useReconcileAgentsMutation();

  const isHealthy =
    connectionState === "healthy" && runtimeUrl.trim().length > 0;
  const { data: runtimeHealth } = useRuntimeHealthQuery({ enabled: isHealthy });
  const isAgentSeedHydrating = runtimeHealth?.agentSeed?.status === "hydrating";

  const refreshAgentResources = useCallback(async () => {
    await invalidateAgentSetupResources(runtimeUrl);
  }, [invalidateAgentSetupResources, runtimeUrl]);

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
