import { useMemo } from "react";
import {
  projectAgentsPaneRosters,
  type AgentsPaneRosterProjection,
  type AgentsPaneRosterProjectionInput,
} from "#product/lib/domain/delegated-work/agents-pane-roster-projection";

export function useAgentsPaneRosterProjection(
  input: AgentsPaneRosterProjectionInput,
): AgentsPaneRosterProjection {
  return useMemo(() => projectAgentsPaneRosters(input), [
    input.hiddenChildIds,
    input.parent,
    input.parentSessionId,
    input.presentationTruthByTarget,
    input.selectedChildSessionId,
    input.workspace,
  ]);
}
