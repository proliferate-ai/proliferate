import { useMemo } from "react";
import type {
  SessionSubagentsResponse,
  SubagentParentRoster,
  WorkspaceSubagentsResponse,
} from "@anyharness/sdk";
import {
  buildAgentsPaneModel,
  type AgentsPaneModel,
} from "#product/lib/domain/delegated-work/agents-pane-model";

function withoutSuppressedChildren(
  roster: SubagentParentRoster,
  suppressedChildIds: ReadonlySet<string>,
): SubagentParentRoster | null {
  const children = roster.children.filter(
    (entry) => !suppressedChildIds.has(entry.agent.identity.sessionId),
  );
  return children.length > 0 ? { ...roster, children } : null;
}

export function filterAgentsPaneRosters(
  response: WorkspaceSubagentsResponse | null | undefined,
  suppressedChildIds: ReadonlySet<string>,
): readonly SubagentParentRoster[] {
  return (response?.parents ?? []).flatMap((roster) => {
    const filtered = withoutSuppressedChildren(roster, suppressedChildIds);
    return filtered ? [filtered] : [];
  });
}

export function focusedAgentsPaneRoster(
  response: SessionSubagentsResponse | null | undefined,
  fallback: SubagentParentRoster | null,
  suppressedChildIds: ReadonlySet<string>,
): SubagentParentRoster | null {
  const roster = response
    ? { parent: response.parent, children: response.children }
    : fallback;
  return roster ? withoutSuppressedChildren(roster, suppressedChildIds) : null;
}

export function useAgentsPaneModel(
  rosters: readonly SubagentParentRoster[] | null,
): AgentsPaneModel | null {
  return useMemo(
    () => rosters ? buildAgentsPaneModel(rosters) : null,
    [rosters],
  );
}
