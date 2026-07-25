import { useEffect, useRef } from "react";
import { useRuntimeHealthQuery } from "@anyharness/sdk-react";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useAgentResourcesCache } from "@/hooks/access/anyharness/agents/use-agent-resources-cache";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";

/**
 * Keeps the desktop agent list in sync with the runtime's OWN startup work.
 *
 * The runtime now owns reconciliation: at startup it hydrates the bundled seed
 * and runs an installed-only reconcile against the catalog pins (see
 * AgentRuntime::spawn_startup_pass); the reconcile snapshot is polled via
 * useAgentCatalog. This hook no longer TRIGGERS reconcile — it only refreshes
 * the agent list while the seed hydrates and as the reconcile job transitions,
 * so the UI reflects progress. Manual reconcile lives in the settings pane;
 * missing agents install on demand at session start.
 */
export function useAgentAutoReconcile() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const {
    invalidateAgentListResources,
    invalidateAgentSetupResources,
  } = useAgentResourcesCache();
  const {
    isReconciling,
    reconcileDataUpdatedAt,
    reconcileStatus,
  } = useAgentCatalog();
  const previousReconcileStatus = useRef<string>("idle");
  const isHealthy = connectionState === "healthy" && runtimeUrl.trim().length > 0;
  const {
    data: runtimeHealth,
    dataUpdatedAt: runtimeHealthDataUpdatedAt,
  } = useRuntimeHealthQuery({
    enabled: isHealthy,
    pollWhileAgentSeedHydrating: true,
  });
  const agentSeedStatus = runtimeHealth?.agentSeed?.status;
  const healthReconcileStatus = runtimeHealth?.agentReconcile?.status;
  const previousAgentSeedStatus = useRef<string | null>(null);
  const observedHealthRuntimeUrl = useRef<string | null>(null);

  // Keep agents fresh during seed hydration and force one final refresh when hydration completes.
  useEffect(() => {
    const normalizedRuntimeUrl = runtimeUrl.trim();
    if (connectionState !== "healthy") {
      observedHealthRuntimeUrl.current = null;
      previousAgentSeedStatus.current = null;
      return;
    }
    if (
      !normalizedRuntimeUrl
      || runtimeHealthDataUpdatedAt === 0
      || !agentSeedStatus
    ) {
      return;
    }

    const isFirstObservationForRuntime =
      observedHealthRuntimeUrl.current !== normalizedRuntimeUrl;
    const previousStatus = isFirstObservationForRuntime
      ? null
      : previousAgentSeedStatus.current;
    observedHealthRuntimeUrl.current = normalizedRuntimeUrl;
    previousAgentSeedStatus.current = agentSeedStatus;

    const isHydrating = agentSeedStatus === "hydrating";
    const completedHydration =
      previousStatus === "hydrating" && agentSeedStatus !== "hydrating";

    if (isHydrating) {
      void invalidateAgentListResources(normalizedRuntimeUrl);
      return;
    }

    const healthReportsActiveReconcile =
      healthReconcileStatus === "queued" || healthReconcileStatus === "running";
    if (isFirstObservationForRuntime || completedHydration || healthReportsActiveReconcile) {
      // Reconcile is queued immediately after hydration. Refresh its idle
      // snapshot as well as the agent list so the status query starts polling
      // the active job through completion. The first settled health response
      // also refreshes: fast/no-op hydration can finish before Desktop ever
      // observes the intermediate `hydrating` state.
      void invalidateAgentSetupResources(normalizedRuntimeUrl);
    }
  }, [
    agentSeedStatus,
    connectionState,
    healthReconcileStatus,
    invalidateAgentListResources,
    invalidateAgentSetupResources,
    runtimeHealthDataUpdatedAt,
    runtimeUrl,
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

    void invalidateAgentListResources(runtimeUrl);
  }, [invalidateAgentListResources, reconcileDataUpdatedAt, reconcileStatus, runtimeUrl]);

  return { isReconciling };
}
