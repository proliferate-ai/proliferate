import type { AgentAuthAgentKind } from "@proliferate/cloud-sdk";
import { isSettingsAdminRole } from "@/lib/domain/settings/admin-roles";

export const AGENT_AUTH_AGENT_ORDER: AgentAuthAgentKind[] = [
  "claude",
  "codex",
  "opencode",
  "gemini",
];

export function isAgentAuthAdminRole(role: string | null | undefined): boolean {
  return isSettingsAdminRole(role);
}

export function agentAuthAgentLabel(agentKind: string): string {
  if (agentKind === "claude") {
    return "Claude";
  }
  if (agentKind === "codex") {
    return "Codex";
  }
  if (agentKind === "opencode") {
    return "OpenCode";
  }
  if (agentKind === "gemini") {
    return "Gemini";
  }
  return agentKind;
}

export function agentAuthHarnessDescription(agentKind: string): string {
  if (agentKind === "claude") {
    return "Anthropic models - Claude Code harness";
  }
  if (agentKind === "codex") {
    return "OpenAI models - Codex CLI harness";
  }
  if (agentKind === "opencode") {
    return "Anthropic or OpenAI models - OpenCode harness";
  }
  if (agentKind === "gemini") {
    return "Google or cross-provider models - Gemini CLI harness";
  }
  return "Agent harness";
}
