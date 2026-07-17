import { useCallback, useMemo } from "react";
import type { AgentSummary } from "@anyharness/sdk";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { useAgentInstallationActions } from "#product/hooks/agents/workflows/use-agent-installation-actions";
import type { AgentInstallTarget } from "#product/hooks/agents/workflows/use-agent-installation-actions";
import { useToastStore } from "#product/stores/toast/toast-store";

export interface HarnessInstallAction {
  label: string;
  loading: boolean;
  disabled: boolean;
  onInstall: () => void;
}

export function useHarnessInstallAction(
  agent: AgentSummary | null,
  target: AgentInstallTarget = "runtime",
): HarnessInstallAction | null {
  const showToast = useToastStore((state) => state.show);
  const {
    isAgentSeedHydrating,
    isInstallingAgent,
    isReconcilingAgents,
    installAgent,
    reconcileAgents,
    reconcileSnapshot,
    supportsScopedReconcile,
  } = useAgentInstallationActions(target);

  const canInstall = agent?.installState === "install_required"
    || agent?.installState === "failed";
  const handleInstall = useCallback(async () => {
    if (!agent || !canInstall) {
      return;
    }

    try {
      if (supportsScopedReconcile) {
        await reconcileAgents({
          reinstall: true,
          agentKinds: [agent.kind],
        });
        showToast(HARNESS_PANE_COPY.updateStartedToast(
          agent.displayName,
          target === "runtime" ? "the local runtime" : "the selected runtime",
        ));
      } else {
        // Older runtimes ignore unknown reconcile fields and would turn a
        // scoped update into a full forced reinstall. Keep their established,
        // kind-scoped synchronous endpoint as the safe compatibility path.
        await installAgent(agent.kind, { reinstall: true });
        showToast(HARNESS_PANE_COPY.readyToast(agent.displayName));
      }
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : HARNESS_PANE_COPY.installError(agent.displayName);
      showToast(message);
    }
  }, [
    agent,
    canInstall,
    installAgent,
    reconcileAgents,
    showToast,
    supportsScopedReconcile,
    target,
  ]);

  const reconcileActive = Boolean(
    reconcileSnapshot?.status === "queued" || reconcileSnapshot?.status === "running",
  );
  const isBusy = supportsScopedReconcile
    ? isReconcilingAgents || reconcileActive
    : isInstallingAgent || reconcileActive;

  return useMemo(() => {
    if (!agent || !canInstall) {
      return null;
    }
    return {
      label: isBusy
        ? HARNESS_PANE_COPY.installingAction
        : agent.installState === "failed"
          ? HARNESS_PANE_COPY.retryInstallAction
          : HARNESS_PANE_COPY.installAction,
      loading: isBusy,
      disabled: isBusy || isAgentSeedHydrating,
      onInstall: () => {
        void handleInstall();
      },
    };
  }, [agent, canInstall, handleInstall, isAgentSeedHydrating, isBusy]);
}
