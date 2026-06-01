import { compareChatLaunchKinds } from "@/config/chat-launch";
import {
  type DesktopAgentLaunchAgent,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { filterTargetReadyLaunchAgents } from "@/lib/domain/agents/target-ready-launch-agents";
import { buildLocalSlotLogicalWorkspaceId } from "@/lib/domain/workspaces/cloud/logical-workspace-id";

export function resolveLastViewedSessionForWorkspace(
  lastViewedSessionByWorkspace: Record<string, string>,
  logicalWorkspaceId: string,
  workspaceId: string,
): { sessionId: string | null; sourceKey: string | null } {
  for (const key of [
    logicalWorkspaceId,
    workspaceId,
    buildLocalSlotLogicalWorkspaceId(workspaceId),
  ]) {
    if (Object.prototype.hasOwnProperty.call(lastViewedSessionByWorkspace, key)) {
      return {
        sessionId: lastViewedSessionByWorkspace[key] ?? null,
        sourceKey: key,
      };
    }
  }
  return {
    sessionId: null,
    sourceKey: null,
  };
}

export function orderBootstrapLaunchAgents(
  agents: readonly DesktopAgentLaunchAgent[],
  agentsByKind: ReadonlyMap<string, { readiness: string }>,
): DesktopAgentLaunchAgent[] {
  return filterTargetReadyLaunchAgents(agents, agentsByKind)
    .sort((left, right) =>
      compareChatLaunchKinds(
        left.kind,
        right.kind,
        left.displayName,
        right.displayName,
      )
    );
}
