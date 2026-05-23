import {
  useAgentReconcileStatusQuery,
  useAgentsQuery,
  useRuntimeHealthQuery,
} from "@anyharness/sdk-react";
import { useMemo } from "react";
import type { AgentSummary } from "@anyharness/sdk";
import {
  getAgentsNeedingSetup,
  getNotReadyAgents,
  getReadyAgentKinds,
  getReadyAgents,
} from "@/lib/domain/agents/status";

const EMPTY_AGENTS: AgentSummary[] = [];
const EMPTY_RECONCILE_RESULTS: NonNullable<
  ReturnType<typeof useAgentReconcileStatusQuery>["data"]
>["results"] = [];

export function useAgentCatalog() {
  const runtimeHealthQuery = useRuntimeHealthQuery({
    pollWhileAgentSeedHydrating: true,
  });
  const isAgentSeedHydrating =
    runtimeHealthQuery.data?.agentSeed?.status === "hydrating";
  const agentsQuery = useAgentsQuery({
    refetchInterval: isAgentSeedHydrating ? 1_000 : false,
  });
  const reconcileQuery = useAgentReconcileStatusQuery();
  const agents = agentsQuery.data ?? EMPTY_AGENTS;
  const reconcileResults = reconcileQuery.data?.results ?? EMPTY_RECONCILE_RESULTS;

  const derived = useMemo(() => ({
    readyAgents: getReadyAgents(agents),
    agentsNeedingSetup: getAgentsNeedingSetup(agents),
    notReadyAgents: getNotReadyAgents(agents),
    readyAgentKinds: getReadyAgentKinds(agents),
    installingAgents: agents.filter((agent) => agent.installState === "installing"),
    agentsByKind: new Map(agents.map((agent) => [agent.kind, agent])),
    reconcileResultsByKind: new Map(
      reconcileResults.map((result) => [result.kind, result] as const),
    ),
    reconcileSnapshot: reconcileQuery.data ?? null,
    reconcileStatus: reconcileQuery.data?.status ?? "idle",
    reconcileDataUpdatedAt: reconcileQuery.dataUpdatedAt,
    isReconciling: reconcileQuery.data?.status === "queued"
      || reconcileQuery.data?.status === "running",
    hasAgents: agents.length > 0,
  }), [agents, reconcileQuery.data, reconcileQuery.dataUpdatedAt, reconcileResults]);

  return {
    ...agentsQuery,
    agents,
    isError: agentsQuery.isError,
    error: agentsQuery.error,
    ...derived,
  };
}
