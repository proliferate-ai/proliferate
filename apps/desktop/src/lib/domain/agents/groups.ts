import type {
  AgentSummary,
  ReconcileAgentResult,
} from "@anyharness/sdk";

export type AgentGroup =
  | "needs_setup"
  | "configured"
  | "unavailable";

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
