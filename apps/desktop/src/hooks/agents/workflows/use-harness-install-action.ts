import { useCallback, useMemo } from "react";
import type { AgentSummary } from "@anyharness/sdk";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useAgentInstallationActions } from "@/hooks/agents/workflows/use-agent-installation-actions";
import { useToastStore } from "@/stores/toast/toast-store";

export type HarnessInstallAction =
  | {
      kind: "action";
      label: string;
      loading: boolean;
      disabled: boolean;
      onInstall: () => void;
    }
  | {
      kind: "progress";
      label: string;
      detail: string;
    };

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
    if (!agent) {
      return null;
    }

    if (agent.installState === "installing") {
      return {
        kind: "progress",
        label: HARNESS_PANE_COPY.automaticUpdateTitle(agent.displayName),
        detail: HARNESS_PANE_COPY.automaticUpdateDetail(agent.displayName),
      };
    }

    if (isAgentSeedHydrating && canInstall) {
      return {
        kind: "progress",
        label: HARNESS_PANE_COPY.seedSetupTitle,
        detail: HARNESS_PANE_COPY.seedSetupDetail,
      };
    }

    if (!canInstall) {
      return null;
    }

    return {
      kind: "action",
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
