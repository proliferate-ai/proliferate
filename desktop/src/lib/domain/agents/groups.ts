import type {
  AgentSummary,
  ReconcileAgentResult,
} from "@anyharness/sdk";
import type { AgentStatusTone } from "@/lib/domain/agents/status";

export type AgentGroup =
  | "needs_setup"
  | "configured"
  | "unavailable";

export type AgentGroupBadgeTone =
  | "neutral"
  | "destructive";

export function classifyAgent(
  agent: AgentSummary,
  reconcileResult?: ReconcileAgentResult,
): AgentGroup {
  if (
    reconcileResult?.outcome === "failed"
    || agent.readiness === "error"
    || agent.readiness === "unsupported"
  ) {
    return "unavailable";
  }

  if (agent.readiness === "ready") {
    return "configured";
  }

  return "needs_setup";
}

export function getAgentGroupBadgeTone(
  group: AgentGroup,
  statusTone: AgentStatusTone,
): AgentGroupBadgeTone {
  return group === "unavailable" || statusTone === "destructive"
    ? "destructive"
    : "neutral";
}
