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
  const reconcileQuery = useWorkspaceAgentReconcileStatusQuery(options);
  const agents = agentsQuery.data ?? EMPTY_AGENTS;
  const reconcileStatus = reconcileQuery.data?.status ?? "idle";
  const previousReconcileStatus = useRef(reconcileStatus);

  useEffect(() => {
    const previous = previousReconcileStatus.current;
    previousReconcileStatus.current = reconcileStatus;
    const wasActive = previous === "queued" || previous === "running";
    const isTerminal = reconcileStatus === "completed" || reconcileStatus === "failed";
    if (wasActive && isTerminal) {
      void agentsQuery.refetch();
    }
  }, [agentsQuery.refetch, reconcileStatus]);

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
