import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SubagentParentRoster,
  SubagentRosterEntry,
} from "@anyharness/sdk";
import {
  useSessionSubagentsQuery,
  useWorkspaceSessionsQuery,
  useWorkspaceSubagentsQuery,
} from "@anyharness/sdk-react";
import {
  filterAgentsPaneRosters,
  focusedAgentsPaneRoster,
  useAgentsPaneModel,
} from "#product/hooks/agents/derived/use-agents-pane-model";
import type {
  AgentsPaneLifecycleFailure,
  AgentsPanePromoteOutcome,
} from "#product/hooks/agents/workflows/use-agents-pane-lifecycle-actions";
import type {
  AgentsPaneAction,
  AgentsPaneChild,
  AgentsPaneParent,
} from "#product/lib/domain/delegated-work/agents-pane-model";
import {
  selectAgentsPaneRoute,
  useAgentsPaneNavigationStore,
} from "#product/stores/agents/agents-pane-navigation-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";

function rosterHasChild(
  rosters: readonly SubagentParentRoster[] | undefined,
  childSessionId: string,
): boolean {
  return rosters?.some((roster) => roster.children.some(
    (entry) => entry.agent.identity.sessionId === childSessionId,
  )) ?? false;
}

function childFromRoster(
  roster: SubagentParentRoster | null,
  childSessionId: string,
): SubagentRosterEntry | null {
  return roster?.children.find(
    (entry) => entry.agent.identity.sessionId === childSessionId,
  ) ?? null;
}

export interface AgentsPaneActionRequest {
  token: number;
  parentSessionId: string;
  childSessionId: string;
  action: AgentsPaneAction;
}

export function useAgentsPane({ workspaceId }: { workspaceId: string }) {
  const route = useAgentsPaneNavigationStore((state) =>
    selectAgentsPaneRoute(state, workspaceId)
  );
  const openOverview = useAgentsPaneNavigationStore((state) => state.openOverview);
  const openCluster = useAgentsPaneNavigationStore((state) => state.openCluster);
  const openDetail = useAgentsPaneNavigationStore((state) => state.openDetail);
  const repairRoute = useAgentsPaneNavigationStore((state) => state.repair);
  const [suppressedChildIds, setSuppressedChildIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [actionRequest, setActionRequest] = useState<AgentsPaneActionRequest | null>(null);
  const [nextActionToken, setNextActionToken] = useState(1);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();

  useEffect(() => {
    setSuppressedChildIds(new Set());
    setActionRequest(null);
    setLifecycleError(null);
  }, [workspaceId]);

  const workspaceRosterQuery = useWorkspaceSubagentsQuery({
    workspaceId,
    enabled: true,
  });
  const parentSessionId = route.kind === "overview" ? null : route.parentDurableId;
  const parentRosterQuery = useSessionSubagentsQuery(parentSessionId, {
    workspaceId,
    enabled: parentSessionId !== null,
  });
  // Kept dormant until Promote-404 convergence needs an authoritative second
  // source. A 404 is never treated as success from roster absence alone.
  const workspaceSessionsQuery = useWorkspaceSessionsQuery({
    workspaceId,
    enabled: false,
  });

  const rosters = useMemo(
    () => filterAgentsPaneRosters(workspaceRosterQuery.data, suppressedChildIds),
    [suppressedChildIds, workspaceRosterQuery.data],
  );
  const overviewModel = useAgentsPaneModel(
    workspaceRosterQuery.data ? rosters : null,
  );
  const fallbackRoster = useMemo(() =>
    parentSessionId
      ? rosters.find((roster) => roster.parent.identity.sessionId === parentSessionId) ?? null
      : null,
  [parentSessionId, rosters]);
  const focusedRoster = useMemo(() => focusedAgentsPaneRoster(
    parentRosterQuery.data,
    fallbackRoster,
    suppressedChildIds,
  ), [fallbackRoster, parentRosterQuery.data, suppressedChildIds]);
  const focusedRosters = useMemo(
    () => focusedRoster ? [focusedRoster] : null,
    [focusedRoster],
  );
  const focusedModel = useAgentsPaneModel(focusedRosters);
  const focusedParent = focusedModel?.parents[0] ?? null;
  const selectedChild = route.kind === "detail"
    ? childFromRoster(focusedRoster, route.childDurableId)
    : null;
  const selectedClientSessionId = useSessionDirectoryStore((state) => {
    if (route.kind !== "detail") {
      return null;
    }
    return state.clientSessionIdByMaterializedSessionId[route.childDurableId]
      ?? route.childDurableId;
  });
  const setSessionRelationship = useSessionDirectoryStore(
    (state) => state.setSessionRelationship,
  );

  const liveParentIds = useMemo(
    () => new Set(rosters.map((roster) => roster.parent.identity.sessionId)),
    [rosters],
  );
  const liveChildIdsByParent = useMemo(() => new Map(
    rosters.map((roster) => [
      roster.parent.identity.sessionId,
      new Set(roster.children.map((entry) => entry.agent.identity.sessionId)),
    ]),
  ), [rosters]);
  useEffect(() => {
    if (!workspaceRosterQuery.data) {
      return;
    }
    repairRoute(workspaceId, liveParentIds, liveChildIdsByParent);
  }, [
    liveChildIdsByParent,
    liveParentIds,
    repairRoute,
    workspaceId,
    workspaceRosterQuery.data,
  ]);

  const selectParent = useCallback((parent: AgentsPaneParent) => {
    setLifecycleError(null);
    openCluster(workspaceId, parent.sessionId);
  }, [openCluster, workspaceId]);
  const selectChild = useCallback((child: AgentsPaneChild) => {
    if (!parentSessionId) {
      return;
    }
    setLifecycleError(null);
    openDetail(workspaceId, parentSessionId, child.sessionId);
  }, [openDetail, parentSessionId, workspaceId]);
  const requestChildAction = useCallback((
    child: AgentsPaneChild,
    action: AgentsPaneAction,
  ) => {
    if (!parentSessionId) {
      return;
    }
    const token = nextActionToken;
    setNextActionToken((current) => current + 1);
    setLifecycleError(null);
    setActionRequest({
      token,
      parentSessionId,
      childSessionId: child.sessionId,
      action,
    });
    openDetail(workspaceId, parentSessionId, child.sessionId);
  }, [nextActionToken, openDetail, parentSessionId, workspaceId]);

  const completePromotion = useCallback((target: {
    childSessionId: string;
    clientSessionId: string;
  }) => {
    setSuppressedChildIds((current) => {
      const next = new Set(current);
      next.add(target.childSessionId);
      return next;
    });
    setSessionRelationship(target.clientSessionId, { kind: "root" });
    if (parentSessionId) {
      openCluster(workspaceId, parentSessionId);
    }
    void openWorkspaceSession({
      workspaceId,
      sessionId: target.clientSessionId,
      forceWorkspaceSelection: false,
    });
  }, [
    openCluster,
    openWorkspaceSession,
    parentSessionId,
    setSessionRelationship,
    workspaceId,
  ]);

  const handlePromoted = useCallback((outcome: AgentsPanePromoteOutcome) => {
    setLifecycleError(null);
    completePromotion(outcome);
  }, [completePromotion]);

  const handleLifecycleError = useCallback(async (
    failure: AgentsPaneLifecycleFailure,
  ) => {
    const rosterResultPromise = workspaceRosterQuery.refetch();
    if (failure.action === "promote" && failure.kind === "not_found") {
      const [rosterResult, sessionsResult] = await Promise.all([
        rosterResultPromise,
        workspaceSessionsQuery.refetch(),
      ]);
      const childStillLinked = rosterHasChild(
        rosterResult.data?.parents,
        failure.childSessionId,
      );
      const isOrdinarySession = sessionsResult.data?.some(
        (session) => session.id === failure.childSessionId,
      ) ?? false;
      if (!childStillLinked && isOrdinarySession) {
        setLifecycleError(null);
        completePromotion(failure);
        return;
      }
    } else {
      await rosterResultPromise;
    }
    setLifecycleError(failure.message || "The agent action could not be completed.");
  }, [completePromotion, workspaceRosterQuery, workspaceSessionsQuery]);

  const retryRoster = useCallback(() => {
    setLifecycleError(null);
    if (route.kind === "overview") {
      void workspaceRosterQuery.refetch();
    } else {
      void Promise.all([workspaceRosterQuery.refetch(), parentRosterQuery.refetch()]);
    }
  }, [parentRosterQuery, route.kind, workspaceRosterQuery]);

  return {
    route,
    overviewModel,
    focusedParent,
    selectedChild,
    selectedClientSessionId,
    actionRequest,
    lifecycleError,
    initialLoading: !workspaceRosterQuery.data && workspaceRosterQuery.isLoading,
    initialError: !workspaceRosterQuery.data && workspaceRosterQuery.isError
      ? "Agents are unavailable."
      : null,
    backgroundRefreshing: Boolean(
      workspaceRosterQuery.data && workspaceRosterQuery.isFetching,
    ),
    focusedLoading: !focusedRoster && parentRosterQuery.isLoading,
    focusedError: !focusedRoster && parentRosterQuery.isError
      ? "This agent group is unavailable."
      : null,
    selectParent,
    selectChild,
    requestChildAction,
    handlePromoted,
    handleLifecycleError,
    clearActionRequest: (token: number) => setActionRequest((current) =>
      current?.token === token ? null : current
    ),
    retryRoster,
    back: () => useAgentsPaneNavigationStore.getState().back(workspaceId),
    openOverview: () => openOverview(workspaceId),
  };
}
