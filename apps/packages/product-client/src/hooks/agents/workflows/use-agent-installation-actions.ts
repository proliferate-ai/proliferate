import { useCallback } from "react";
import {
  useInstallAgentMutation,
  useAgentReconcileStatusQuery,
  useReconcileAgentsMutation,
  useRuntimeHealthQuery,
  useWorkspaceAgentReconcileStatusQuery,
  useWorkspaceInstallAgentMutation,
  useWorkspaceReconcileAgentsMutation,
} from "@anyharness/sdk-react";
import type {
  InstallAgentRequest,
  ReconcileAgentsRequest,
} from "@anyharness/sdk";
import { useAgentResourcesCache } from "#product/hooks/access/anyharness/agents/use-agent-resources-cache";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

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

export type AgentInstallTarget = "runtime" | "workspace";

export function useAgentInstallationActions(
  target: AgentInstallTarget = "runtime",
) {
  // Owns manual agent install/reconcile actions. Agent query-cache shape stays
  // behind the agents cache hook.
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const { invalidateAgentSetupResources } = useAgentResourcesCache();
  const installMutation = useInstallAgentMutation();
  const workspaceInstallMutation = useWorkspaceInstallAgentMutation();
  const reconcileMutation = useReconcileAgentsMutation();
  const workspaceReconcileMutation = useWorkspaceReconcileAgentsMutation();
  const runtimeReconcileQuery = useAgentReconcileStatusQuery({
    enabled: target === "runtime",
  });
  const workspaceReconcileQuery = useWorkspaceAgentReconcileStatusQuery({
    enabled: target === "workspace",
  });
  const reconcileSnapshot = target === "runtime"
    ? runtimeReconcileQuery.data
    : workspaceReconcileQuery.data;
  const supportsScopedReconcile = reconcileSnapshot !== undefined
    && Object.prototype.hasOwnProperty.call(reconcileSnapshot, "installedOnly");

  const isHealthy =
    connectionState === "healthy" && runtimeUrl.trim().length > 0;
  const { data: runtimeHealth } = useRuntimeHealthQuery({ enabled: isHealthy });
  const isAgentSeedHydrating = target === "runtime"
    && runtimeHealth?.agentSeed?.status === "hydrating";

  const refreshAgentResources = useCallback(async () => {
    await invalidateAgentSetupResources(runtimeUrl);
  }, [invalidateAgentSetupResources, runtimeUrl]);

  const installAgent = useCallback(
    async (kind: string, request?: InstallAgentRequest) => {
      if (target === "runtime") {
        assertHealthyRuntime(runtimeUrl, isHealthy);
        assertAgentSeedReady(isAgentSeedHydrating);
        return installMutation.mutateAsync({ kind, request });
      }
      return workspaceInstallMutation.mutateAsync({ kind, request });
    },
    [
      installMutation,
      isAgentSeedHydrating,
      isHealthy,
      runtimeUrl,
      target,
      workspaceInstallMutation,
    ],
  );

  const reconcileAgents = useCallback(
    async (options?: ReconcileAgentsRequest) => {
      if (target === "runtime") {
        assertHealthyRuntime(runtimeUrl, isHealthy);
        assertAgentSeedReady(isAgentSeedHydrating);
        return reconcileMutation.mutateAsync(options ?? {});
      }
      return workspaceReconcileMutation.mutateAsync(options ?? {});
    },
    [
      isAgentSeedHydrating,
      isHealthy,
      reconcileMutation,
      runtimeUrl,
      target,
      workspaceReconcileMutation,
    ],
  );

  return {
    installAgent,
    isAgentSeedHydrating,
    isInstallingAgent: target === "runtime"
      ? installMutation.isPending
      : workspaceInstallMutation.isPending,
    isReconcilingAgents: target === "runtime"
      ? reconcileMutation.isPending
      : workspaceReconcileMutation.isPending,
    reconcileAgents,
    reconcileSnapshot,
    refreshAgentResources,
    supportsScopedReconcile,
  };
}
