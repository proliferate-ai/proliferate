import type { DesktopAgentLaunchAgent } from "#product/lib/domain/agents/cloud-launch-catalog";

interface TargetAgentReadiness {
  readiness: string;
}

/**
 * Local-target launch agents: an agent counts as launchable when the readiness
 * read says ready, OR when the runtime's launch options list it
 * (`launchReadyKinds`).
 *
 * Both reads are route-aware — `GET /v1/agents` resolves the enrolled
 * gateway/api_key route exactly as launch does — so the second clause is
 * usually redundant. It is kept because the two still differ in env scope:
 * `/v1/agents` resolves credentials against the HOST env while launch options
 * resolve against the workspace's composed env, so a workspace-scoped
 * credential can make launch options list an agent the readiness read does not.
 * Launch options never list an uninstalled agent, so this cannot resurrect an
 * install-required agent.
 */
export function filterTargetReadyLaunchAgents(
  agents: readonly DesktopAgentLaunchAgent[],
  agentsByKind: ReadonlyMap<string, TargetAgentReadiness>,
  launchReadyKinds: ReadonlySet<string> | null = null,
): DesktopAgentLaunchAgent[] {
  return agents.filter((agent) =>
    agent.models.length > 0
    && (
      agentsByKind.get(agent.kind)?.readiness === "ready"
      || (launchReadyKinds?.has(agent.kind) ?? false)
    )
  );
}
