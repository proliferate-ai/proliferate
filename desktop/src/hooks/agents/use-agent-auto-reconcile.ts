import { useEffect, useRef } from "react";
import {
  anyHarnessAgentsKey,
  anyHarnessProviderConfigsKey,
  useRuntimeHealthQuery,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useAgentCatalog } from "./use-agent-catalog";
import { useAgentInstallationActions } from "./use-agent-installation-actions";

/**
 * Auto-triggers agent reconciliation on startup when agents need installation,
 * and polls the agent list during reconciliation so the UI reflects progress
 * as each agent installs sequentially.
 */
export function useAgentAutoReconcile() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const queryClient = useQueryClient();
  const {
    agentsNeedingSetup,
    isReconciling,
    isLoading: agentsLoading,
    hasAgents,
    reconcileDataUpdatedAt,
    reconcileStatus,
  } = useAgentCatalog();
  const {
    reconcileAgents,
  } = useAgentInstallationActions();
  const hasTriggered = useRef(false);
  const previousReconcileStatus = useRef<string>("idle");
  const isHealthy = connectionState === "healthy" && runtimeUrl.trim().length > 0;
  const {
    data: runtimeHealth,
    isLoading: runtimeHealthLoading,
  } = useRuntimeHealthQuery({
    enabled: isHealthy,
    pollWhileAgentSeedHydrating: true,
  });
  const agentSeedStatus = runtimeHealth?.agentSeed?.status;
  // `partial` can mean the seed preserved a user-owned Claude/Codex install.
  // Normal reconcile is still safe because non-reinstall installs short-circuit
  // when managed launchers already exist.
  const seedAllowsReconcile =
    !agentSeedStatus
    || agentSeedStatus === "ready"
    || agentSeedStatus === "partial"
    || agentSeedStatus === "failed"
    || agentSeedStatus === "not_configured_dev";

  // Auto-trigger reconcile when agents need installation
  useEffect(() => {
    if (
      !isHealthy
      || runtimeHealthLoading
      || agentSeedStatus === "hydrating"
      || !seedAllowsReconcile
      || agentsLoading
      || !hasAgents
      || hasTriggered.current
      || reconcileStatus !== "idle"
    ) {
      return;
    }

    const needsInstall = agentsNeedingSetup.some(
      (a) => a.readiness === "install_required",
    );
    if (!needsInstall) return;

    hasTriggered.current = true;
    void reconcileAgents();
  }, [
    isHealthy,
    runtimeHealthLoading,
    agentSeedStatus,
    seedAllowsReconcile,
    agentsLoading,
    hasAgents,
    agentsNeedingSetup,
    reconcileStatus,
    reconcileAgents,
  ]);

  // Keep the authoritative agent list in sync with the polled reconcile job state.
  useEffect(() => {
    if (!runtimeUrl.trim() || reconcileDataUpdatedAt === 0) {
      previousReconcileStatus.current = reconcileStatus;
      return;
    }

    const wasActive =
      previousReconcileStatus.current === "queued"
      || previousReconcileStatus.current === "running";
    const isActive = reconcileStatus === "queued" || reconcileStatus === "running";
    const becameTerminal = wasActive && (reconcileStatus === "completed" || reconcileStatus === "failed");

    previousReconcileStatus.current = reconcileStatus;

    if (!isActive && !becameTerminal) {
      return;
    }

    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: anyHarnessAgentsKey(runtimeUrl),
      }),
      queryClient.invalidateQueries({
        queryKey: anyHarnessProviderConfigsKey(runtimeUrl),
      }),
    ]);
  }, [queryClient, reconcileDataUpdatedAt, reconcileStatus, runtimeUrl]);

  return { isReconciling };
}
