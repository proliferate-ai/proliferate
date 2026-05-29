import { useEffect, useRef } from "react";
import {
  useRuntimeHealthQuery,
} from "@anyharness/sdk-react";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useAgentResourcesCache } from "@/hooks/access/anyharness/agents/use-agent-resources-cache";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useAgentInstallationActions } from "@/hooks/agents/workflows/use-agent-installation-actions";

/**
 * Auto-triggers agent reconciliation on startup when agents need installation,
 * refreshes the agent list while the bundled seed hydrates, and keeps the list
 * current during reconciliation so the UI reflects progress as each agent
 * installs sequentially.
 *
 * Owns the app-mounted agent reconcile lifecycle. Does not own manual install
 * actions or agent catalog derivation.
 */
export function useAgentAutoReconcile() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const { invalidateAgentListResources } = useAgentResourcesCache();
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
    dataUpdatedAt: runtimeHealthDataUpdatedAt,
    isLoading: runtimeHealthLoading,
  } = useRuntimeHealthQuery({
    enabled: isHealthy,
    pollWhileAgentSeedHydrating: true,
  });
  const agentSeedStatus = runtimeHealth?.agentSeed?.status;
  // `partial` can mean the seed preserved a user-owned Claude/Codex install.
  // Normal reconcile is still safe because non-reinstall installs short-circuit
  // when managed launchers already exist. `not_configured_dev` intentionally
  // stays manual so local dev profiles do not start long network installs on
  // app boot.
  const seedAllowsReconcile =
    !agentSeedStatus
    || agentSeedStatus === "ready"
    || agentSeedStatus === "partial"
    || agentSeedStatus === "failed";

  const previousAgentSeedStatus = useRef<string | null>(null);

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
