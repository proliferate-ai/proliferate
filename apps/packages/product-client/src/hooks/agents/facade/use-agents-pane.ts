import { useCallback, useEffect, useMemo, useState } from "react";
import type { SubagentParentRoster } from "@anyharness/sdk";
import {
  useAgentsPaneRosterProjection,
} from "#product/hooks/agents/derived/use-agents-pane-roster-projection";
import {
  agentsPaneLifecycleTargetKey,
  type AgentsPanePresentationTruth,
} from "#product/lib/domain/delegated-work/agents-pane-roster-projection";
import type {
  AgentsPaneCloseOutcome,
  AgentsPaneLifecycleFailure,
  AgentsPaneOpenOutcome,
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
import { useAgentsPaneRosterQueries } from "#product/hooks/agents/facade/use-agents-pane-roster-queries";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";

function rosterHasChild(
  rosters: readonly SubagentParentRoster[] | undefined,
  childSessionId: string,
): boolean {
  return rosters?.some((roster) => roster.children.some(
    (entry) => entry.agent.identity.sessionId === childSessionId,
  )) ?? false;
}

export interface AgentsPaneActionRequest {
  token: number;
  parentSessionId: string;
  childSessionId: string;
  action: AgentsPaneAction;
}

export function useAgentsPane({
  workspaceId,
  isOpen = true,
}: {
  workspaceId: string;
  /**
   * Whether the pane is actually open/visible rather than merely mounted
   * (the host right panel keeps this facade mounted-but-hidden while
   * collapsed, so mount lifecycle alone cannot gate the roster poll).
   * Defaults to true, which OPTS a caller INTO the backstop poll and
   * focus refetch — a caller that omits this must want roster liveness;
   * pass explicit visibility (as AgentsPane does) to poll only while open.
   */
  isOpen?: boolean;
}) {
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
  const [presentationTruthByTarget, setPresentationTruthByTarget] = useState<
    ReadonlyMap<string, AgentsPanePresentationTruth>
  >(() => new Map());
  const [lifecycleError, setLifecycleError] = useState<{
    parentSessionId: string;
    childSessionId: string;
    message: string;
  } | null>(null);
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const promotedRootSessionIds = useSessionDirectoryStore(
    (state) => state.promotedRootSessionIds,
  );

  useEffect(() => {
    setSuppressedChildIds(new Set());
    setActionRequest(null);
    setPresentationTruthByTarget(new Map());
    setLifecycleError(null);
  }, [workspaceId]);

  const parentSessionId = route.kind === "overview" ? null : route.parentDurableId;
  const { workspaceRosterQuery, parentRosterQuery, workspaceSessionsQuery } =
    useAgentsPaneRosterQueries({ workspaceId, parentSessionId, isOpen });

  const hiddenChildIds = useMemo(() => new Set([
    ...suppressedChildIds,
    ...promotedRootSessionIds,
  ]), [promotedRootSessionIds, suppressedChildIds]);
  const rosterProjection = useAgentsPaneRosterProjection({
    parentSessionId,
    selectedChildSessionId: route.kind === "detail" ? route.childDurableId : null,
    hiddenChildIds,
    presentationTruthByTarget,
    workspace: {
      data: workspaceRosterQuery.data,
      dataUpdatedAt: workspaceRosterQuery.dataUpdatedAt,
      isError: workspaceRosterQuery.isError,
      isFetching: workspaceRosterQuery.isFetching,
      isSuccess: workspaceRosterQuery.isSuccess,
    },
    parent: {
      data: parentRosterQuery.data,
      dataUpdatedAt: parentRosterQuery.dataUpdatedAt,
      isError: parentRosterQuery.isError,
      isFetching: parentRosterQuery.isFetching,
      isSuccess: parentRosterQuery.isSuccess,
    },
  });
  const {
    overviewModel,
    focusedParent,
    focusedRoster,
    selectedChild,
    liveParentIds,
    liveChildIdsByParent,
    canRepairRoute,
  } = rosterProjection;
  const selectedClientSessionId = useSessionDirectoryStore((state) => {
    if (route.kind !== "detail") {
      return null;
    }
    return state.clientSessionIdByMaterializedSessionId[route.childDurableId]
      ?? route.childDurableId;
  });
  const markSessionPromoted = useSessionDirectoryStore(
    (state) => state.markSessionPromoted,
  );

  useEffect(() => {
    setPresentationTruthByTarget((current) => {
      let next: Map<string, AgentsPanePresentationTruth> | null = null;
      for (const [key, truth] of current) {
        const workspaceRosterIsFresh = Boolean(
          workspaceRosterQuery.isSuccess
          && !workspaceRosterQuery.isFetching
          && workspaceRosterQuery.dataUpdatedAt > truth.workspaceRosterUpdatedAt,
        );
        const parentRosterIsFresh = Boolean(
          truth.parentRosterUpdatedAt !== null
          && parentSessionId === truth.parentSessionId
          && parentRosterQuery.isSuccess
          && !parentRosterQuery.isFetching
          && parentRosterQuery.dataUpdatedAt > truth.parentRosterUpdatedAt,
        );
        if (
          workspaceRosterIsFresh
          && (parentSessionId !== truth.parentSessionId || parentRosterIsFresh)
        ) {
          next ??= new Map(current);
          next.delete(key);
        }
      }
      return next ?? current;
    });
  }, [
    parentRosterQuery.data,
    parentRosterQuery.dataUpdatedAt,
    parentRosterQuery.isFetching,
    parentRosterQuery.isSuccess,
    parentSessionId,
    presentationTruthByTarget,
    workspaceRosterQuery.data,
    workspaceRosterQuery.dataUpdatedAt,
    workspaceRosterQuery.isFetching,
    workspaceRosterQuery.isSuccess,
  ]);

  useEffect(() => {
    if (!canRepairRoute) {
      return;
    }
    repairRoute(workspaceId, liveParentIds, liveChildIdsByParent);
  }, [
    liveChildIdsByParent,
    liveParentIds,
    repairRoute,
    workspaceId,
    canRepairRoute,
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
    parentSessionId: string;
    childSessionId: string;
    clientSessionId: string;
  }) => {
    setSuppressedChildIds((current) => {
      const next = new Set(current);
      next.add(target.childSessionId);
      return next;
    });
    markSessionPromoted([target.childSessionId, target.clientSessionId], workspaceId);
    openCluster(workspaceId, target.parentSessionId);
    void openWorkspaceSession({
      workspaceId,
      sessionId: target.clientSessionId,
      forceWorkspaceSelection: false,
    });
  }, [
    openCluster,
    openWorkspaceSession,
    markSessionPromoted,
    workspaceId,
  ]);

  const handlePromoted = useCallback((outcome: AgentsPanePromoteOutcome) => {
    setLifecycleError((current) => current
      && current.parentSessionId === outcome.parentSessionId
      && current.childSessionId === outcome.childSessionId
        ? null
        : current
    );
    completePromotion(outcome);
  }, [completePromotion]);

  const handleLifecycleSuccess = useCallback((
    outcome: AgentsPaneCloseOutcome | AgentsPaneOpenOutcome,
  ) => {
    const key = agentsPaneLifecycleTargetKey(
      outcome.parentSessionId,
      outcome.childSessionId,
    );
    setPresentationTruthByTarget((current) => {
      const next = new Map(current);
      next.set(key, {
        parentSessionId: outcome.parentSessionId,
        childSessionId: outcome.childSessionId,
        status: outcome.agent.status,
        workspaceRosterUpdatedAt: workspaceRosterQuery.dataUpdatedAt,
        parentRosterUpdatedAt: parentSessionId === outcome.parentSessionId
          ? parentRosterQuery.dataUpdatedAt
          : null,
      });
      return next;
    });
    setLifecycleError((current) => current
      && current.parentSessionId === outcome.parentSessionId
      && current.childSessionId === outcome.childSessionId
        ? null
        : current
    );
  }, [
    parentRosterQuery.dataUpdatedAt,
    parentSessionId,
    workspaceRosterQuery.dataUpdatedAt,
  ]);

  const handleLifecycleError = useCallback(async (
    failure: AgentsPaneLifecycleFailure,
  ) => {
    const rosterResultPromise = workspaceRosterQuery.refetch();
    const focusedResultPromise = parentSessionId === failure.parentSessionId
      ? parentRosterQuery.refetch()
      : Promise.resolve(null);
    if (failure.action === "promote" && failure.kind === "not_found") {
      const [rosterResult, sessionsResult] = await Promise.all([
        rosterResultPromise,
        workspaceSessionsQuery.refetch(),
        focusedResultPromise,
      ]);
      const childStillLinked = rosterHasChild(
        rosterResult.data?.parents,
        failure.childSessionId,
      );
      const isListedSession = sessionsResult.data?.some(
        (session) => session.id === failure.childSessionId,
      ) ?? false;
      if (
        rosterResult.isSuccess
        && sessionsResult.isSuccess
        && !childStillLinked
        && isListedSession
      ) {
        setLifecycleError(null);
        completePromotion(failure);
        return;
      }
    } else {
      await Promise.all([rosterResultPromise, focusedResultPromise]);
    }
    const currentRoute = selectAgentsPaneRoute(
      useAgentsPaneNavigationStore.getState(),
      workspaceId,
    );
    if (
      currentRoute.kind === "detail"
      && currentRoute.parentDurableId === failure.parentSessionId
      && currentRoute.childDurableId === failure.childSessionId
    ) {
      setLifecycleError({
        parentSessionId: failure.parentSessionId,
        childSessionId: failure.childSessionId,
        message: failure.message || "The agent action could not be completed.",
      });
    }
  }, [
    completePromotion,
    parentRosterQuery,
    parentSessionId,
    workspaceId,
    workspaceRosterQuery,
    workspaceSessionsQuery,
  ]);

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
    lifecycleError: route.kind === "detail"
      && lifecycleError?.parentSessionId === route.parentDurableId
      && lifecycleError.childSessionId === route.childDurableId
        ? lifecycleError.message
        : null,
    // TanStack reports isLoading=false while an enabled query is paused
    // offline. With no data and no error that is still an explicit initial
    // loading state, never a blank pane.
    initialLoading: !workspaceRosterQuery.data && !workspaceRosterQuery.isError,
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
    handleLifecycleSuccess,
    clearActionRequest: (token: number) => setActionRequest((current) =>
      current?.token === token ? null : current
    ),
    retryRoster,
    back: () => useAgentsPaneNavigationStore.getState().back(workspaceId),
    openOverview: () => openOverview(workspaceId),
  };
}
