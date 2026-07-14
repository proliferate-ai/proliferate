import type { AgentGroup } from "#product/lib/domain/agents/groups";
import type { AgentStatusTone } from "#product/lib/domain/agents/status-presentation";

export type AgentGroupBadgeTone =
  | "neutral"
  | "destructive";

export function getAgentGroupBadgeTone(
  group: AgentGroup,
  statusTone: AgentStatusTone,
): AgentGroupBadgeTone {
  return group === "unavailable" || statusTone === "destructive"
    ? "destructive"
    : "neutral";
}
