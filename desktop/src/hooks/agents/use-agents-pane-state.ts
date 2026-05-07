import {
  useRuntimeHealthQuery,
} from "@anyharness/sdk-react";
import { useCallback, useMemo, useState } from "react";
import type {
  AgentSummary,
  ReconcileAgentResult,
} from "@anyharness/sdk";
import { useShallow } from "zustand/react/shallow";
import { AGENTS_PAGE_COPY } from "@/copy/agents/agents-copy";
import {
  classifyAgent,
  type AgentGroup,
} from "@/lib/domain/agents/groups";
import { isReadyAgent } from "@/lib/domain/agents/status";
import {
  getAgentDetailText,
  getAgentStatusDisplay,
  type AgentReconcileState,
  type AgentStatusDisplay,
} from "@/lib/domain/agents/status-presentation";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useAgentCatalog } from "./use-agent-catalog";
import { useAgentInstallationActions } from "./use-agent-installation-actions";

export interface AgentsPaneRowState {
  agent: AgentSummary;
  status: AgentStatusDisplay;
  group: AgentGroup;
  detailText: string;
  actionLabel: string;
  actionDisabled: boolean;
  installActionLabel: string;
  installActionDisabled: boolean;
  installActionLoading: boolean;
  reconcileResult?: ReconcileAgentResult;
}

interface AgentsPaneState {
  connectionState: "connecting" | "healthy" | "failed";
  connectionDescription: string;
  runtimeHome: string | null;
  anyHarnessLogPath: string | null;
  agentsLoading: boolean;
  agentError: string | null;
  reconcileError: string | null;
  installError: string | null;
  needsSetupRows: AgentsPaneRowState[];
  configuredRows: AgentsPaneRowState[];
  unavailableRows: AgentsPaneRowState[];
  selectedAgent: AgentSummary | null;
  selectedAgentReconcileResult?: ReconcileAgentResult;
  reconcileState: AgentReconcileState;
  isReconciling: boolean;
  isAgentOperationActive: boolean;
  isAgentSeedHydrating: boolean;
  isEmpty: boolean;
  openAgent: (agent: AgentSummary) => void;
  closeAgent: () => void;
  handleReconcile: () => Promise<void>;
  handleInstallAgent: (agent: AgentSummary) => Promise<void>;
}

export function useAgentsPaneState(): AgentsPaneState {
  const { connectionState, runtimeError } = useHarnessConnectionStore(useShallow((state) => ({
    connectionState: state.connectionState,
    runtimeError: state.error,
  })));
  const { data: health } = useRuntimeHealthQuery();
  const isAgentSeedHydrating = health?.agentSeed?.status === "hydrating";
  const {
    agents,
    agentsByKind,
    reconcileResultsByKind,
    reconcileSnapshot,
    reconcileStatus,
    isLoading: agentsLoading,
    error: agentsError,
  } = useAgentCatalog();
  const {
    installAgent,
    refreshAgentResources,
    reconcileAgents,
  } = useAgentInstallationActions();

  const [selectedAgentKind, setSelectedAgentKind] = useState<string | null>(null);
  const [installingAgentKind, setInstallingAgentKind] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const selectedAgent = useMemo(
    () => (selectedAgentKind ? agentsByKind.get(selectedAgentKind) ?? null : null),
    [agentsByKind, selectedAgentKind],
  );

  const reconcileState: AgentReconcileState =
    reconcileStatus === "queued" || reconcileStatus === "running"
      ? "reconciling"
      : reconcileStatus === "failed"
        ? "error"
        : reconcileStatus === "completed"
          ? "done"
          : "idle";
  const reconcileError = reconcileStatus === "failed"
    ? reconcileSnapshot?.message ?? AGENTS_PAGE_COPY.reconcileError
    : null;
  const isAgentOperationActive = reconcileState === "reconciling" || installingAgentKind !== null;

  const connectionDescription = connectionState === "failed"
    ? runtimeError ?? AGENTS_PAGE_COPY.reconnectTitle
    : AGENTS_PAGE_COPY.reconnectLoadingSubtext;

  const groupedRows = useMemo(() => {
    const needsSetupRows: AgentsPaneRowState[] = [];
    const configuredRows: AgentsPaneRowState[] = [];
    const unavailableRows: AgentsPaneRowState[] = [];
    const rowsByKind = new Map<string, AgentsPaneRowState>();

    for (const agent of agents) {
      const isReconcilingInstall = agent.installState === "installing";
      const isInstallingThisAgent = installingAgentKind === agent.kind;
      const reconcileResult = reconcileResultsByKind.get(agent.kind);
      const group = classifyAgent(agent, reconcileResult);
      const row: AgentsPaneRowState = {
        agent,
        status: getAgentStatusDisplay(agent, {
          reconcileResult,
          isReconciling: isReconcilingInstall || isInstallingThisAgent,
        }),
        group,
        detailText: getAgentDetailText(agent, reconcileResult),
        actionLabel: getAgentRowActionLabel(
          agent,
          isReconcilingInstall || isInstallingThisAgent,
        ),
        actionDisabled: isReconcilingInstall || isInstallingThisAgent,
        installActionLabel: getAgentInstallActionLabel(
          agent,
          isReconcilingInstall || isInstallingThisAgent,
        ),
        installActionDisabled:
          connectionState !== "healthy"
          || isAgentSeedHydrating
          || reconcileState === "reconciling"
          || installingAgentKind !== null
          || isReconcilingInstall
          || agent.readiness === "unsupported",
        installActionLoading: isInstallingThisAgent,
        reconcileResult,
      };

      rowsByKind.set(agent.kind, row);

      if (group === "needs_setup") {
        needsSetupRows.push(row);
      } else if (group === "configured") {
        configuredRows.push(row);
      } else {
        unavailableRows.push(row);
      }
    }

    return {
      needsSetupRows,
      configuredRows,
      unavailableRows,
      rowsByKind,
    };
  }, [
    agents,
    connectionState,
    installingAgentKind,
    isAgentSeedHydrating,
    reconcileResultsByKind,
    reconcileState,
  ]);

  const agentError =
    agentsError instanceof Error ? agentsError.message : null;

  const handleReconcile = useCallback(async () => {
    try {
      setInstallError(null);
      await reconcileAgents({ reinstall: true });
    } catch {
      // Shared mutation state exposes the latest error to all consumers.
    }
  }, [reconcileAgents]);

  const handleInstallAgent = useCallback(async (agent: AgentSummary) => {
    setInstallError(null);
    setInstallingAgentKind(agent.kind);

    try {
      await installAgent(agent.kind, {
        reinstall: agent.installState !== "install_required",
      });
      await refreshAgentResources();
    } catch {
      setInstallError(`Could not install ${agent.displayName}.`);
    } finally {
      setInstallingAgentKind(null);
    }
  }, [installAgent, refreshAgentResources]);

  const openAgent = useCallback((agent: AgentSummary) => {
    setSelectedAgentKind(agent.kind);
  }, []);

  const closeAgent = useCallback(() => {
    setSelectedAgentKind(null);
  }, []);

  return {
    connectionState,
    connectionDescription,
    runtimeHome: health?.runtimeHome ?? null,
    anyHarnessLogPath: health?.runtimeHome
      ? `${health.runtimeHome}/logs/anyharness.log`
      : null,
    agentsLoading,
    agentError,
    reconcileError,
    installError,
    needsSetupRows: groupedRows.needsSetupRows,
    configuredRows: groupedRows.configuredRows,
    unavailableRows: groupedRows.unavailableRows,
    selectedAgent,
    selectedAgentReconcileResult: selectedAgentKind
      ? groupedRows.rowsByKind.get(selectedAgentKind)?.reconcileResult
      : undefined,
    reconcileState,
    isReconciling: reconcileState === "reconciling",
    isAgentOperationActive,
    isAgentSeedHydrating,
    isEmpty:
      groupedRows.needsSetupRows.length === 0
      && groupedRows.configuredRows.length === 0
      && groupedRows.unavailableRows.length === 0,
    openAgent,
    closeAgent,
    handleReconcile,
    handleInstallAgent,
  };
}

function getAgentRowActionLabel(
  agent: AgentSummary,
  isReconcilingInstall: boolean,
): string {
  if (isReconcilingInstall) {
    return AGENTS_PAGE_COPY.reconcileLoadingAction;
  }
  if (isReadyAgent(agent)) {
    return AGENTS_PAGE_COPY.manageAction;
  }
  if (agent.readiness === "error" || agent.readiness === "unsupported") {
    return AGENTS_PAGE_COPY.detailsAction;
  }
  return AGENTS_PAGE_COPY.setupAction;
}

function getAgentInstallActionLabel(
  agent: AgentSummary,
  isInstalling: boolean,
): string {
  if (isInstalling) {
    return AGENTS_PAGE_COPY.installLoadingAction;
  }
  if (agent.installState === "install_required") {
    return AGENTS_PAGE_COPY.installAction;
  }
  if (agent.installState === "failed") {
    return AGENTS_PAGE_COPY.retryInstallAction;
  }
  return AGENTS_PAGE_COPY.reinstallAction;
}
