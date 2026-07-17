import {
  useWorkspaceAgentReconcileStatusQuery,
  useWorkspaceAgentsQuery,
} from "@anyharness/sdk-react";
import type { AgentSummary } from "@anyharness/sdk";
import { useEffect, useMemo, useRef } from "react";
import { getAgentsNeedingSetup } from "#product/lib/domain/agents/status";

const EMPTY_AGENTS: AgentSummary[] = [];

export function useWorkspaceAgentCatalog(options?: { enabled?: boolean }) {
  const agentsQuery = useWorkspaceAgentsQuery(options);
  const reconcileQuery = useWorkspaceAgentReconcileStatusQuery({
    ...options,
    discoverWhileIdle: true,
  });
  const agents = agentsQuery.data ?? EMPTY_AGENTS;
  const reconcileStatus = reconcileQuery.data?.status ?? "idle";
  const reconcileJobId = reconcileQuery.data?.jobId ?? null;
  const previousReconcileStatus = useRef(reconcileStatus);
  const lastRefreshedTerminalJobId = useRef<string | null>(null);
  const terminalRefreshesInFlight = useRef(new Set<string>());
  const legacyTerminalRefreshFailed = useRef(false);

  useEffect(() => {
    const previous = previousReconcileStatus.current;
    previousReconcileStatus.current = reconcileStatus;
    const wasActive = previous === "queued" || previous === "running";
    const isTerminal = reconcileStatus === "completed" || reconcileStatus === "failed";
    const refreshKey = reconcileJobId ?? "__legacy__";
    const discoveredTerminalJob = isTerminal
      && reconcileJobId !== null
      && reconcileJobId !== lastRefreshedTerminalJobId.current
      && !terminalRefreshesInFlight.current.has(refreshKey);
    const legacyBecameTerminal = isTerminal
      && reconcileJobId === null
      && (wasActive || legacyTerminalRefreshFailed.current)
      && !terminalRefreshesInFlight.current.has(refreshKey);
    if (reconcileJobId !== null) {
      legacyTerminalRefreshFailed.current = false;
    }
    if (!discoveredTerminalJob && !legacyBecameTerminal) {
      return;
    }
    terminalRefreshesInFlight.current.add(refreshKey);

    void agentsQuery.refetch()
      .then((result) => {
        if (result?.isError) {
          throw result.error ?? new Error("Agent list refresh failed");
        }
        if (reconcileJobId) {
          lastRefreshedTerminalJobId.current = reconcileJobId;
        } else {
          legacyTerminalRefreshFailed.current = false;
        }
      })
      .catch(() => {
        if (reconcileJobId === null) {
          legacyTerminalRefreshFailed.current = true;
        }
      })
      .finally(() => {
        terminalRefreshesInFlight.current.delete(refreshKey);
      });
  }, [
    agentsQuery.refetch,
    reconcileJobId,
    reconcileQuery.dataUpdatedAt,
    reconcileStatus,
  ]);

  const derived = useMemo(() => ({
    agents,
    agentsByKind: new Map(agents.map((agent) => [agent.kind, agent])),
    agentsNeedingSetup: getAgentsNeedingSetup(agents),
    reconcileSnapshot: reconcileQuery.data ?? null,
    isReconciling: reconcileQuery.data?.status === "queued"
      || reconcileQuery.data?.status === "running",
  }), [agents, reconcileQuery.data]);

  return {
    ...agentsQuery,
    ...derived,
  };
}
