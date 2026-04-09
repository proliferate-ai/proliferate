import { useEffect, useRef } from "react";
import {
  anyHarnessAgentsKey,
  anyHarnessProviderConfigsKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useAgentCatalog } from "./use-agent-catalog";
import { useAgentInstallationActions } from "./use-agent-installation-actions";

/**
 * Auto-triggers agent reconciliation on startup when agents need installation,
 * and polls the agent list during reconciliation so the UI reflects progress
 * as each agent installs sequentially.
 */
export function useAgentAutoReconcile() {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const connectionState = useHarnessStore((state) => state.connectionState);
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

  // Auto-trigger reconcile when agents need installation
  useEffect(() => {
    if (
      !isHealthy
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
