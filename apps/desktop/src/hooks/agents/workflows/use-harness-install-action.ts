import { useCallback, useMemo } from "react";
import type { AgentSummary } from "@anyharness/sdk";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useAgentInstallationActions } from "@/hooks/agents/workflows/use-agent-installation-actions";
import { useToastStore } from "@/stores/toast/toast-store";

export interface HarnessInstallAction {
  label: string;
  loading: boolean;
  disabled: boolean;
  onInstall: () => void;
}

export function useHarnessInstallAction(
  agent: AgentSummary | null,
): HarnessInstallAction | null {
  const showToast = useToastStore((state) => state.show);
  const {
    installAgent,
    isAgentSeedHydrating,
    isInstallingAgent,
    refreshAgentResources,
  } = useAgentInstallationActions();

  const canInstall = agent?.installState === "install_required"
    || agent?.installState === "failed";
  const handleInstall = useCallback(async () => {
    if (!agent || !canInstall) {
      return;
    }

    try {
      await installAgent(agent.kind, { reinstall: true });
      await refreshAgentResources();
      showToast(HARNESS_PANE_COPY.readyToast(agent.displayName));
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : HARNESS_PANE_COPY.installError(agent.displayName);
      showToast(message);
    }
  }, [agent, canInstall, installAgent, refreshAgentResources, showToast]);

  return useMemo(() => {
    if (!agent || !canInstall) {
      return null;
    }
    return {
      label: isInstallingAgent
        ? HARNESS_PANE_COPY.installingAction
        : agent.installState === "failed"
          ? HARNESS_PANE_COPY.retryInstallAction
          : HARNESS_PANE_COPY.installAction,
      loading: isInstallingAgent,
      disabled: isInstallingAgent || isAgentSeedHydrating,
      onInstall: () => {
        void handleInstall();
      },
    };
  }, [agent, canInstall, handleInstall, isAgentSeedHydrating, isInstallingAgent]);
}
