import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";

interface TargetAgentReadiness {
  readiness: string;
}

export function filterTargetReadyLaunchAgents(
  agents: readonly DesktopAgentLaunchAgent[],
  agentsByKind: ReadonlyMap<string, TargetAgentReadiness>,
): DesktopAgentLaunchAgent[] {
  return agents.filter((agent) =>
    agent.models.length > 0
    && agentsByKind.get(agent.kind)?.readiness === "ready"
  );
}
