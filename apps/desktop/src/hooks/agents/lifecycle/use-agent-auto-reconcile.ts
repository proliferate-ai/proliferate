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
  const { invalidateAgentListResources } = useAgentResourcesCache();
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
  const previousAgentSeedStatus = useRef<string | null>(null);

  // Keep agents fresh during seed hydration and force one final refresh when hydration completes.
  useEffect(() => {
    const normalizedRuntimeUrl = runtimeUrl.trim();
    const previousStatus = previousAgentSeedStatus.current;
    previousAgentSeedStatus.current = agentSeedStatus ?? null;

    if (!normalizedRuntimeUrl || runtimeHealthDataUpdatedAt === 0) {
      return;
    }

    const isHydrating = agentSeedStatus === "hydrating";
    const completedHydration =
      previousStatus === "hydrating" && agentSeedStatus !== "hydrating";

    if (!isHydrating && !completedHydration) {
      return;
    }

    void invalidateAgentListResources(normalizedRuntimeUrl);
  }, [
    agentSeedStatus,
    invalidateAgentListResources,
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
