import type { AgentSummary } from "@anyharness/sdk";
import type { BadgeTone } from "@proliferate/ui/primitives/Badge";
import { AGENTS_OVERVIEW_COPY } from "@/copy/agents/agents-overview-copy";

export interface AgentOverviewStatus {
  label: string;
  tone: BadgeTone;
}

export function isInstalledAgent(agent: AgentSummary): boolean {
  return agent.installState !== "install_required";
}

export function getInstalledAgents(agents: AgentSummary[]): AgentSummary[] {
  return agents.filter(isInstalledAgent);
}

export function getAgentOverviewStatus(agent: AgentSummary): AgentOverviewStatus {
  if (agent.installState === "installing") {
    return { label: AGENTS_OVERVIEW_COPY.status.installing, tone: "info" };
  }
  if (agent.installState === "failed") {
    return { label: AGENTS_OVERVIEW_COPY.status.installFailed, tone: "destructive" };
  }
  if (agent.installState === "install_required") {
    return { label: AGENTS_OVERVIEW_COPY.status.notInstalled, tone: "neutral" };
  }
  switch (agent.credentialState) {
    case "ready":
      return { label: AGENTS_OVERVIEW_COPY.status.ready, tone: "success" };
    case "login_required":
      return { label: AGENTS_OVERVIEW_COPY.status.loginRequired, tone: "warning" };
    case "missing_env":
      return { label: AGENTS_OVERVIEW_COPY.status.credentialsRequired, tone: "warning" };
    case "unknown":
      return { label: AGENTS_OVERVIEW_COPY.status.needsAttention, tone: "neutral" };
  }
}

export function formatAgentOverviewMeta(agent: AgentSummary): string {
  const version = agent.agentProcess.version;
  if (!version) {
    return agent.kind;
  }
  const label = version.startsWith("v") ? version : `v${version}`;
  return `${agent.kind} · ${label}`;
}
