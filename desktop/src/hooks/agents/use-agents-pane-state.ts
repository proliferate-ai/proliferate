import {
  useRuntimeHealthQuery,
} from "@anyharness/sdk-react";
import { useCallback, useMemo, useState } from "react";
import type {
  AgentSummary,
  ReconcileAgentResult,
} from "@anyharness/sdk";
import { useShallow } from "zustand/react/shallow";
import { AGENTS_PAGE_COPY } from "@/config/agents";
import {
  classifyAgent,
  type AgentGroup,
} from "@/lib/domain/agents/groups";
import {
  getAgentDetailText,
  getAgentStatusDisplay,
  isReadyAgent,
  type AgentReconcileState,
  type AgentStatusDisplay,
} from "@/lib/domain/agents/status";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useAgentCatalog } from "./use-agent-catalog";
import { useAgentInstallationActions } from "./use-agent-installation-actions";

export interface AgentsPaneRowState {
  agent: AgentSummary;
  status: AgentStatusDisplay;
  group: AgentGroup;
  detailText: string;
  actionLabel: string;
  actionDisabled: boolean;
  reconcileResult?: ReconcileAgentResult;
}

export interface AgentsPaneRuntimeStatus {
  label: string;
  description: string;
  tone: "neutral" | "destructive";
}

interface AgentsPaneState {
  connectionState: "connecting" | "healthy" | "failed";
  runtimeStatus: AgentsPaneRuntimeStatus;
  runtimeHome: string | null;
  anyHarnessLogPath: string | null;
  agentsLoading: boolean;
  agentError: string | null;
  reconcileError: string | null;
  needsSetupRows: AgentsPaneRowState[];
  configuredRows: AgentsPaneRowState[];
  unavailableRows: AgentsPaneRowState[];
  selectedAgent: AgentSummary | null;
  selectedAgentReconcileResult?: ReconcileAgentResult;
  reconcileState: AgentReconcileState;
  isReconciling: boolean;
  isAgentSeedHydrating: boolean;
  isEmpty: boolean;
  openAgent: (agent: AgentSummary) => void;
  closeAgent: () => void;
  handleReconcile: () => Promise<void>;
}

export function useAgentsPaneState(): AgentsPaneState {
  const { connectionState, runtimeError } = useHarnessStore(useShallow((state) => ({
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
    reconcileAgents,
  } = useAgentInstallationActions();

  const [selectedAgentKind, setSelectedAgentKind] = useState<string | null>(null);

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

  const runtimeStatus: AgentsPaneRuntimeStatus = connectionState === "healthy"
    ? {
        label: AGENTS_PAGE_COPY.runtimeConnectedLabel,
        description: health?.version
          ? `${AGENTS_PAGE_COPY.runtimeVersionPrefix}${health.version}`
          : AGENTS_PAGE_COPY.runtimeConnectedDescription,
        tone: "neutral",
      }
    : connectionState === "connecting"
      ? {
          label: AGENTS_PAGE_COPY.runtimeConnectingLabel,
          description: AGENTS_PAGE_COPY.reconnectLoadingSubtext,
          tone: "neutral",
        }
      : {
          label: AGENTS_PAGE_COPY.runtimeUnavailableLabel,
          description: runtimeError ?? AGENTS_PAGE_COPY.reconnectTitle,
          tone: "destructive",
        };

  const groupedRows = useMemo(() => {
    const needsSetupRows: AgentsPaneRowState[] = [];
    const configuredRows: AgentsPaneRowState[] = [];
    const unavailableRows: AgentsPaneRowState[] = [];
    const rowsByKind = new Map<string, AgentsPaneRowState>();

    for (const agent of agents) {
      const isReconcilingInstall = agent.installState === "installing";
      const reconcileResult = reconcileResultsByKind.get(agent.kind);
      const group = classifyAgent(agent, reconcileResult);
      const row: AgentsPaneRowState = {
        agent,
        status: getAgentStatusDisplay(agent, {
          reconcileResult,
          isReconciling: isReconcilingInstall,
        }),
        group,
        detailText: getAgentDetailText(agent, reconcileResult),
        actionLabel: getAgentRowActionLabel(agent, isReconcilingInstall),
        actionDisabled: isReconcilingInstall,
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
  }, [agents, reconcileResultsByKind]);

  const agentError =
    agentsError instanceof Error ? agentsError.message : null;

  const handleReconcile = useCallback(async () => {
    try {
      await reconcileAgents({ reinstall: true });
    } catch {
      // Shared mutation state exposes the latest error to all consumers.
    }
  }, [reconcileAgents]);

  const openAgent = useCallback((agent: AgentSummary) => {
    setSelectedAgentKind(agent.kind);
  }, []);

  const closeAgent = useCallback(() => {
    setSelectedAgentKind(null);
  }, []);

  return {
    connectionState,
    runtimeStatus,
    runtimeHome: health?.runtimeHome ?? null,
    anyHarnessLogPath: health?.runtimeHome
      ? `${health.runtimeHome}/logs/anyharness.log`
      : null,
    agentsLoading,
    agentError,
    reconcileError,
    needsSetupRows: groupedRows.needsSetupRows,
    configuredRows: groupedRows.configuredRows,
    unavailableRows: groupedRows.unavailableRows,
    selectedAgent,
    selectedAgentReconcileResult: selectedAgentKind
      ? groupedRows.rowsByKind.get(selectedAgentKind)?.reconcileResult
      : undefined,
    reconcileState,
    isReconciling: reconcileState === "reconciling",
    isAgentSeedHydrating,
    isEmpty:
      groupedRows.needsSetupRows.length === 0
      && groupedRows.configuredRows.length === 0
      && groupedRows.unavailableRows.length === 0,
    openAgent,
    closeAgent,
    handleReconcile,
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
