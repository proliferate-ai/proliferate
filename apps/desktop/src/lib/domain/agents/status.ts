import type { AgentSummary } from "@anyharness/sdk";

export function isReadyAgent(agent: AgentSummary): boolean {
  return agent.readiness === "ready";
}

export function getReadyAgents(agents: AgentSummary[]): AgentSummary[] {
  return agents.filter(isReadyAgent);
}

export function getAgentsNeedingSetup(
  agents: AgentSummary[],
): AgentSummary[] {
  return agents.filter(
    (agent) =>
      agent.readiness !== "ready" && agent.readiness !== "unsupported",
  );
}

export function getNotReadyAgents(agents: AgentSummary[]): AgentSummary[] {
  return agents.filter((agent) => agent.readiness !== "ready");
}

export function getReadyAgentKinds(agents: AgentSummary[]): Set<string> {
  return new Set(getReadyAgents(agents).map((agent) => agent.kind));
}

export function agentNeedsInstall(agent: AgentSummary): boolean {
  return agent.readiness === "install_required";
}

export function agentSupportsCredentials(agent: AgentSummary): boolean {
  return (
    isReadyAgent(agent)
    || agent.readiness === "credentials_required"
    || agent.readiness === "login_required"
  );
}
