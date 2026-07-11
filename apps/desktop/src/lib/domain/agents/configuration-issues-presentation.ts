import type { AgentSummary, ReconcileAgentResult } from "@anyharness/sdk";
import type { AgentStatusTone } from "@/lib/domain/agents/status-presentation";

export type AgentConfigurationBadgeTone =
  | "success"
  | "warning"
  | "destructive"
  | "neutral";

export function badgeToneForAgentStatus(tone: AgentStatusTone): AgentConfigurationBadgeTone {
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
  if (agent.readiness === "install_required") {
    return "Install this managed harness to use it in this profile.";
  }
  if (agent.message?.trim()) {
    return agent.message;
  }
  if (agent.readiness === "error") {
    return "Review setup details, then refresh the runtime once the issue is fixed.";
  }
  return "This harness is not ready to use as a launch default.";
}
