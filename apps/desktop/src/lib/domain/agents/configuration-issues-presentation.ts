import type { AgentSummary, ReconcileAgentResult } from "@anyharness/sdk";
import type { BadgeTone } from "@proliferate/ui/primitives/Badge";
import type { AgentStatusTone } from "@/lib/domain/agents/status-presentation";

export function badgeToneForAgentStatus(tone: AgentStatusTone): BadgeTone {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "destructive") return "destructive";
  return "neutral";
}

export function configurationDetailForAgent(
  agent: AgentSummary,
  reconcileResult?: ReconcileAgentResult,
): string {
  if (reconcileResult?.outcome === "failed" && reconcileResult.message?.trim()) {
    return reconcileResult.message;
  }
  if (agent.readiness === "credentials_required") {
    return "Add or select credentials in Agent Authentication before using this harness as a default.";
  }
  if (agent.readiness === "login_required") {
    return `Sign in with ${agent.displayName} in Proliferate.`;
  }
  if (agent.message?.trim()) {
    return agent.message;
  }
  if (agent.readiness === "install_required") {
    return "The managed harness install has not completed yet.";
  }
  if (agent.readiness === "error") {
    return "Review setup details, then refresh the runtime once the issue is fixed.";
  }
  return "This harness is not ready to use as a launch default.";
}
