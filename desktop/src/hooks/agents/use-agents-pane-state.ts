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
  detailText: string;
  actionLabel: string;
  actionVariant: "outline" | "primary";
  actionDisabled: boolean;
  reconcileResult?: ReconcileAgentResult;
}

interface AgentsPaneState {
  connectionState: "connecting" | "healthy" | "failed";
  runtimeError: string | null;
  runtimeHome: string | null;
  anyHarnessLogPath: string | null;
  runtimeVersion: string | null;
  agentsLoading: boolean;
  agentError: string | null;
  reconcileError: string | null;
  rows: AgentsPaneRowState[];
  selectedAgent: AgentSummary | null;
  reconcileState: AgentReconcileState;
  isReconciling: boolean;
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

  const rows = useMemo(() => {
    return agents.map((agent): AgentsPaneRowState => {
      const isReconcilingInstall = agent.installState === "installing";
      const reconcileResult = reconcileResultsByKind.get(agent.kind);

      return {
        agent,
        status: getAgentStatusDisplay(agent, {
          reconcileResult,
          isReconciling: isReconcilingInstall,
        }),
        detailText: getAgentDetailText(agent, reconcileResult),
        actionLabel: isReconcilingInstall
          ? AGENTS_PAGE_COPY.reconcileLoadingAction
          : isReadyAgent(agent)
            ? "Manage"
            : "Setup",
        actionVariant: isReadyAgent(agent) ? "outline" : "primary",
        actionDisabled: isReconcilingInstall,
        reconcileResult,
      };
    });
  }, [agents, reconcileResultsByKind, reconcileState]);

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
    runtimeError,
    runtimeHome: health?.runtimeHome ?? null,
    anyHarnessLogPath: health?.runtimeHome
      ? `${health.runtimeHome}/logs/anyharness.log`
      : null,
    runtimeVersion: health?.version ?? null,
    agentsLoading,
    agentError,
    reconcileError,
    rows,
    selectedAgent,
    reconcileState,
    isReconciling: reconcileState === "reconciling",
    isEmpty: rows.length === 0,
    openAgent,
    closeAgent,
    handleReconcile,
  };
}
