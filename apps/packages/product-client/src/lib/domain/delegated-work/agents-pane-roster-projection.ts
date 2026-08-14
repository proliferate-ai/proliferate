import type {
  SessionSubagentsResponse,
  SubagentParentRoster,
  SubagentRosterEntry,
  WorkspaceSubagentsResponse,
} from "@anyharness/sdk";
import {
  buildAgentsPaneModel,
  type AgentsPaneModel,
  type AgentsPaneParent,
} from "#product/lib/domain/delegated-work/agents-pane-model";

export interface AgentsPanePresentationTruth {
  parentSessionId: string;
  childSessionId: string;
  status: SubagentRosterEntry["agent"]["status"];
  workspaceRosterUpdatedAt: number;
  parentRosterUpdatedAt: number | null;
}

export interface AgentsPaneRosterQuerySnapshot<TData> {
  data: TData | undefined;
  dataUpdatedAt: number;
  isError: boolean;
  isFetching: boolean;
  isSuccess: boolean;
}

export interface AgentsPaneRosterProjectionInput {
  parentSessionId: string | null;
  selectedChildSessionId: string | null;
  hiddenChildIds: ReadonlySet<string>;
  presentationTruthByTarget: ReadonlyMap<string, AgentsPanePresentationTruth>;
  workspace: AgentsPaneRosterQuerySnapshot<WorkspaceSubagentsResponse>;
  parent: AgentsPaneRosterQuerySnapshot<SessionSubagentsResponse>;
}

export interface AgentsPaneRosterProjection {
  overviewModel: AgentsPaneModel | null;
  focusedParent: AgentsPaneParent | null;
  focusedRoster: SubagentParentRoster | null;
  selectedChild: SubagentRosterEntry | null;
  liveParentIds: ReadonlySet<string>;
  liveChildIdsByParent: ReadonlyMap<string, ReadonlySet<string>>;
  canRepairRoute: boolean;
}

export function agentsPaneLifecycleTargetKey(
  parentSessionId: string,
  childSessionId: string,
): string {
  return JSON.stringify([parentSessionId, childSessionId]);
}

export function projectAgentsPaneRosters(
  input: AgentsPaneRosterProjectionInput,
): AgentsPaneRosterProjection {
  const rosterTruth = filterAgentsPaneRosters(
    input.workspace.data,
    input.hiddenChildIds,
  );
  const rosters = rosterTruth.map((roster) => rosterWithPresentationTruth(
    roster,
    input.presentationTruthByTarget,
    {
      kind: "workspace",
      dataUpdatedAt: input.workspace.dataUpdatedAt,
      settledSuccess: input.workspace.isSuccess && !input.workspace.isFetching,
    },
  ));
  const overviewModel = input.workspace.data ? buildAgentsPaneModel(rosters) : null;
  const fallbackRoster = input.parentSessionId
    ? rosterTruth.find((roster) =>
      roster.parent.identity.sessionId === input.parentSessionId
    ) ?? null
    : null;
  const focusedRosterUsesParentQuery = Boolean(
    input.parent.data
    && (
      !input.workspace.data
      || input.parent.dataUpdatedAt >= input.workspace.dataUpdatedAt
    ),
  );
  const focusedRosterTruth = focusedAgentsPaneRoster(
    focusedRosterUsesParentQuery ? input.parent.data : undefined,
    fallbackRoster,
    input.hiddenChildIds,
  );
  const focusedRoster = focusedRosterTruth
    ? rosterWithPresentationTruth(
      focusedRosterTruth,
      input.presentationTruthByTarget,
      {
        kind: focusedRosterUsesParentQuery ? "parent" : "workspace",
        dataUpdatedAt: focusedRosterUsesParentQuery
          ? input.parent.dataUpdatedAt
          : input.workspace.dataUpdatedAt,
        settledSuccess: focusedRosterUsesParentQuery
          ? input.parent.isSuccess && !input.parent.isFetching
          : input.workspace.isSuccess && !input.workspace.isFetching,
      },
    )
    : null;
  const focusedParent = focusedRoster
    ? buildAgentsPaneModel([focusedRoster]).parents[0] ?? null
    : null;
  const selectedChild = focusedRoster && input.selectedChildSessionId
    ? childFromRoster(focusedRoster, input.selectedChildSessionId)
    : null;
  const workspaceRosterSettled = settledRoster(input.workspace);
  const parentRosterSettled = settledRoster(input.parent);
  const liveParentIds = projectLiveParentIds({
    input,
    rosters,
    workspaceRosterSettled,
    parentRosterAuthoritative: focusedRosterUsesParentQuery && parentRosterSettled,
  });
  const liveChildIdsByParent = projectLiveChildIdsByParent({
    input,
    rosters,
    workspaceRosterSettled,
    parentRosterAuthoritative: focusedRosterUsesParentQuery && parentRosterSettled,
  });

  return {
    overviewModel,
    focusedParent,
    focusedRoster,
    selectedChild,
    liveParentIds,
    liveChildIdsByParent,
    canRepairRoute: input.parentSessionId && focusedRosterUsesParentQuery
      ? parentRosterSettled
      : workspaceRosterSettled,
  };
}

function filterAgentsPaneRosters(
  response: WorkspaceSubagentsResponse | null | undefined,
  hiddenChildIds: ReadonlySet<string>,
): SubagentParentRoster[] {
  return (response?.parents ?? []).flatMap((roster) => {
    const filtered = withoutHiddenChildren(roster, hiddenChildIds);
    return filtered ? [filtered] : [];
  });
}

function focusedAgentsPaneRoster(
  response: SessionSubagentsResponse | null | undefined,
  fallback: SubagentParentRoster | null,
  hiddenChildIds: ReadonlySet<string>,
): SubagentParentRoster | null {
  const roster = response
    ? { parent: response.parent, children: response.children }
    : fallback;
  return roster ? withoutHiddenChildren(roster, hiddenChildIds) : null;
}

function withoutHiddenChildren(
  roster: SubagentParentRoster,
  hiddenChildIds: ReadonlySet<string>,
): SubagentParentRoster | null {
  const children = roster.children.filter(
    (entry) => !hiddenChildIds.has(entry.agent.identity.sessionId),
  );
  return children.length > 0 ? { ...roster, children } : null;
}

function childFromRoster(
  roster: SubagentParentRoster,
  childSessionId: string,
): SubagentRosterEntry | null {
  return roster.children.find(
    (entry) => entry.agent.identity.sessionId === childSessionId,
  ) ?? null;
}

function rosterWithPresentationTruth(
  roster: SubagentParentRoster,
  presentationTruthByTarget: ReadonlyMap<string, AgentsPanePresentationTruth>,
  source: {
    kind: "workspace" | "parent";
    dataUpdatedAt: number;
    settledSuccess: boolean;
  },
): SubagentParentRoster {
  const parentSessionId = roster.parent.identity.sessionId;
  let changed = false;
  const children = roster.children.map((entry) => {
    const truth = presentationTruthByTarget.get(agentsPaneLifecycleTargetKey(
      parentSessionId,
      entry.agent.identity.sessionId,
    ));
    const baseline = source.kind === "workspace"
      ? truth?.workspaceRosterUpdatedAt
      : truth?.parentRosterUpdatedAt;
    if (
      !truth
      || (
        source.settledSuccess
        && baseline !== null
        && baseline !== undefined
        && source.dataUpdatedAt > baseline
      )
    ) {
      return entry;
    }
    changed = true;
    return { ...entry, agent: { ...entry.agent, status: truth.status } };
  });
  return changed ? { ...roster, children } : roster;
}

function settledRoster(
  query: Pick<AgentsPaneRosterQuerySnapshot<unknown>, "data" | "isError" | "isFetching">,
): boolean {
  return Boolean(query.data && !query.isFetching && !query.isError);
}

function projectLiveParentIds(input: {
  input: AgentsPaneRosterProjectionInput;
  rosters: readonly SubagentParentRoster[];
  workspaceRosterSettled: boolean;
  parentRosterAuthoritative: boolean;
}): ReadonlySet<string> {
  const ids = new Set(
    input.workspaceRosterSettled
      ? input.rosters.map((roster) => roster.parent.identity.sessionId)
      : input.input.parentSessionId ? [input.input.parentSessionId] : [],
  );
  if (input.input.parentSessionId && input.parentRosterAuthoritative && input.input.parent.data) {
    const hasLiveChildren = input.input.parent.data.children.some(
      (entry) => !input.input.hiddenChildIds.has(entry.agent.identity.sessionId),
    );
    if (hasLiveChildren) {
      ids.add(input.input.parentSessionId);
    } else {
      ids.delete(input.input.parentSessionId);
    }
  }
  return ids;
}

function projectLiveChildIdsByParent(input: {
  input: AgentsPaneRosterProjectionInput;
  rosters: readonly SubagentParentRoster[];
  workspaceRosterSettled: boolean;
  parentRosterAuthoritative: boolean;
}): ReadonlyMap<string, ReadonlySet<string>> {
  const ids = new Map<string, ReadonlySet<string>>(
    input.workspaceRosterSettled
      ? input.rosters.map((roster) => [
        roster.parent.identity.sessionId,
        new Set(roster.children.map((entry) => entry.agent.identity.sessionId)),
      ])
      : [],
  );
  if (input.input.parentSessionId && input.parentRosterAuthoritative && input.input.parent.data) {
    ids.set(input.input.parentSessionId, new Set(
      input.input.parent.data.children
        .map((entry) => entry.agent.identity.sessionId)
        .filter((sessionId) => !input.input.hiddenChildIds.has(sessionId)),
    ));
  }
  return ids;
}
