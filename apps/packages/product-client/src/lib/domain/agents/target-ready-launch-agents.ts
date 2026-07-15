import type { DesktopAgentLaunchAgent } from "#product/lib/domain/agents/cloud-launch-catalog";

interface TargetAgentReadiness {
  readiness: string;
}

/**
 * Local-target launch agents: an agent counts as launchable when its NATIVE
 * readiness (`GET /v1/agents`: vendor CLI installed and logged in) is ready, OR
 * when the runtime's launch options list it (`launchReadyKinds`) — launch
 * options use AnyHarness's launch-time readiness, where an enrolled
 * gateway/api_key route supplies the credential injected at spawn. Without the
 * second clause a gateway-only actor (no vendor-CLI login) sees no agents even
 * though every launch would succeed. Launch options never list an uninstalled
 * agent, so this cannot resurrect an install-required agent.
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
