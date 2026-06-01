import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceBootstrapCache } from "@/hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache";
import { useCloudAgentCatalogCache } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useWorkspaceFileActions } from "@/hooks/workspaces/facade/files/use-workspace-file-actions";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useSessionCreationActions } from "@/hooks/sessions/workflows/use-session-creation-actions";
import { useSessionHistoryHydration } from "@/hooks/sessions/lifecycle/use-session-history-hydration";
import { useSessionSelectionActions } from "@/hooks/sessions/facade/use-session-selection-actions";
import { useSessionSummaryActions } from "@/hooks/sessions/workflows/use-session-summary-actions";
import { workspaceFileTreeStateKey } from "@/lib/domain/workspaces/cloud/collections";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/measurement/latency-flow";
import {
  bindMeasurementCategories,
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { getMeasurementRequestOptions } from "@/lib/infra/measurement/debug-measurement-request-options";
import { hashMeasurementScope } from "@/lib/infra/measurement/debug-measurement-env";
import type {
  MeasurementFinishReason,
} from "@/lib/domain/telemetry/debug-measurement-catalog";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import {
  clearLastViewedSession,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import {
  getSessionRecord,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { markWorkspaceBootstrappedInSession } from "@/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import { useDeferredWorkspaceFileTreePrefetch } from "@/hooks/workspaces/lifecycle/files/use-deferred-workspace-file-tree-prefetch";
import { useHotWorkspaceReconcileAction } from "@/hooks/workspaces/workflows/use-hot-workspace-reconcile-action";
import {
  clearInvalidOptimisticActiveSession,
  findLoadedSessionForClientSession,
} from "@/hooks/workspaces/workflows/workspace-bootstrap-session-state";
import {
  isOptimisticWorkspaceSessionPlaceholder,
} from "@/lib/domain/workspaces/selection/optimistic-session-shell";
import { handleEmptyWorkspaceBootstrap } from "@/hooks/workspaces/workflows/workspace-bootstrap-empty-session";
import { handleRememberedWorkspaceSessionBootstrap } from "@/hooks/workspaces/workflows/workspace-bootstrap-remembered-session";

interface BootstrapWorkspaceInput {
  workspaceId: string;
  logicalWorkspaceId: string;
  runtimeUrl: string;
  workspaceConnection: AnyHarnessResolvedConnection;
  startedAt: number;
  latencyFlowId?: string | null;
  isCurrent: () => boolean;
}

const EMPTY_WORKSPACES = [] as const;
const WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS = 8_000;

export function useWorkspaceBootstrapActions() {
  const {
    fetchWorkspaceSessions,
    getWorkspaceSessionsCacheDecision,
    loadWorkspaceSessions,
  } = useWorkspaceBootstrapCache();
  const { ensureCloudAgentCatalog } = useCloudAgentCatalogCache();
  const { agentsByKind } = useAgentCatalog();
  const workspaceCollections = useWorkspaces().data;
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    chatModelVisibilityOverridesByAgentKind: state.chatModelVisibilityOverridesByAgentKind,
  })));
  const lastViewedSessionByWorkspace = useWorkspaceUiStore(
    (state) => state.lastViewedSessionByWorkspace,
  );
  const {
    prepareFileWorkspace,
    prefetchWorkspaceDirectories,
  } = useWorkspaceFileActions();
  const { createEmptySessionWithResolvedConfig } = useSessionCreationActions();
  const { rehydrateSessionSlotFromHistory } = useSessionHistoryHydration();
  const { applySessionSummary } = useSessionSummaryActions();
  const { selectSession } = useSessionSelectionActions();
  const {
    cancelDeferredFileTreePrefetch,
    scheduleDeferredFileTreePrefetch,
  } = useDeferredWorkspaceFileTreePrefetch({
    prefetchWorkspaceDirectories,
  });
  const reconcileHotWorkspace = useHotWorkspaceReconcileAction({
    cancelDeferredFileTreePrefetch,
    loadWorkspaceSessions,
    prepareFileWorkspace,
    rehydrateSessionSlotFromHistory,
    scheduleDeferredFileTreePrefetch,
    workspaceCollections,
  });

  const bootstrapWorkspace = useCallback(async ({
    workspaceId,
    logicalWorkspaceId,
    runtimeUrl,
    workspaceConnection,
    startedAt,
    latencyFlowId,
    isCurrent,
  }: BootstrapWorkspaceInput): Promise<{ sessions: WorkspaceSession[] }> => {
    const measurementOperationId = startMeasurementOperation({
      kind: "workspace_open",
      surfaces: [
        "workspace-shell",
        "workspace-sidebar",
        "global-header",
        "header-tabs",
        "chat-surface",
        "session-transcript-pane",
        "transcript-list",
        "file-tree",
      ],
      linkedLatencyFlowId: latencyFlowId ?? undefined,
      maxDurationMs: 30_000,
    });
    let measurementFinishReason: MeasurementFinishReason = "completed";
    cancelDeferredFileTreePrefetch();
    const unbindMeasurementCategories = measurementOperationId
      ? bindMeasurementCategories({
        operationId: measurementOperationId,
        categories: [
          "session.list",
          "session.get",
          "session.events.list",
          "session.resume",
          "session.stream",
          "file.list",
          "git.status",
          "workspace.session_launch",
          "workspace.setup_status",
        ],
        scope: {
          runtimeUrlHash: hashMeasurementScope(workspaceConnection.runtimeUrl),
        },
        ttlMs: 30_000,
      })
      : () => undefined;
    try {
      const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const treeStateKey = workspace
        ? workspaceFileTreeStateKey(workspace)
        : workspaceId;
      const sessionsStartedAt = startLatencyTimer();
      const initWorkspaceStartedAt = startLatencyTimer();
      const fileWorkspaceArgs = {
        workspaceUiKey: logicalWorkspaceId ?? workspaceId,
        materializedWorkspaceId: workspaceId,
        anyharnessWorkspaceId: workspaceConnection.anyharnessWorkspaceId,
        runtimeUrl: workspaceConnection.runtimeUrl,
        treeStateKey,
        authToken: workspaceConnection.authToken ?? undefined,
      };
      prepareFileWorkspace(fileWorkspaceArgs);
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "workspace.bootstrap.file_tree_init",
        startedAt: initWorkspaceStartedAt,
      });
      scheduleDeferredFileTreePrefetch({
        workspaceId,
        materializedWorkspaceId: workspaceId,
        anyharnessWorkspaceId: workspaceConnection.anyharnessWorkspaceId,
        runtimeUrl: workspaceConnection.runtimeUrl,
        treeStateKey,
        authToken: workspaceConnection.authToken ?? undefined,
        measurementOperationId,
        startedAt: initWorkspaceStartedAt,
        isCurrent,
      });
      let sessionsLoadFailed = false;
      if (measurementOperationId) {
        recordMeasurementMetric({
          type: "cache",
          category: "session.list",
          operationId: measurementOperationId,
          decision: getWorkspaceSessionsCacheDecision(runtimeUrl, workspaceId),
          source: "react_query",
        });
      }
      const requestHeaders = getLatencyFlowRequestHeaders(latencyFlowId) ?? undefined;
      const sessionRequestOptions = getMeasurementRequestOptions({
        operationId: measurementOperationId,
        category: "session.list",
        headers: requestHeaders,
      });
      const sessions = await loadWorkspaceSessions({
        runtimeUrl,
        workspaceConnection,
        workspaceId,
        requestOptions: sessionRequestOptions ?? undefined,
        timeoutMs: WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS,
      }).then((result) => {
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.sessions",
          startedAt: sessionsStartedAt,
          count: result.length,
        });
        logLatency("workspace.select.sessions_loaded", {
          workspaceId,
          sessionCount: result.length,
          elapsedMs: elapsedMs(sessionsStartedAt),
        });
        return result;
      }).catch(() => {
        sessionsLoadFailed = true;
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.sessions",
          startedAt: sessionsStartedAt,
          outcome: "error_sanitized",
        });
        logLatency("workspace.select.sessions_loaded", {
          workspaceId,
          sessionCount: 0,
          fallback: "load_failed",
        });
        return [] as WorkspaceSession[];
      });

    if (!isCurrent()) {
      return { sessions };
    }

    const activeSessionIdAfterLoad = useSessionSelectionStore.getState().activeSessionId;
    const loadedActiveSession = activeSessionIdAfterLoad
      ? findLoadedSessionForClientSession(activeSessionIdAfterLoad, sessions)
      : null;
    if (activeSessionIdAfterLoad && loadedActiveSession) {
      const activeSessionBeforePatch = getSessionRecord(activeSessionIdAfterLoad);
      const wasOptimisticPlaceholder =
        isOptimisticWorkspaceSessionPlaceholder(activeSessionBeforePatch);
      applySessionSummary(activeSessionIdAfterLoad, loadedActiveSession, workspaceId);
      if (wasOptimisticPlaceholder) {
        logLatency("workspace.select.optimistic_session_validated", {
          workspaceId,
          logicalWorkspaceId,
          sessionId: activeSessionIdAfterLoad,
          title: loadedActiveSession.title ?? null,
          agentKind: loadedActiveSession.agentKind,
        });
      }
    } else if (!sessionsLoadFailed) {
      clearInvalidOptimisticActiveSession({
        workspaceId,
        logicalWorkspaceId,
      });
    }

    if (sessions.length === 0) {
      const emptyBootstrap = await handleEmptyWorkspaceBootstrap({
        agentsByKind,
        latencyFlowId,
        logicalWorkspaceId,
        measurementOperationId,
        preferences,
        requestOptions: sessionRequestOptions,
        sessions,
        shouldClearLastViewedSession: !sessionsLoadFailed,
        startedAt,
        timeoutMs: WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS,
        workspaceConnection,
        workspaceId,
        isCurrent,
      }, {
        clearLastViewedSession,
        createEmptySessionWithResolvedConfig,
        ensureCloudAgentCatalog,
        fetchWorkspaceSessions,
        getPendingWorkspaceEntry: () =>
          useSessionSelectionStore.getState().pendingWorkspaceEntry,
        markWorkspaceBootstrappedInSession,
        setActiveSessionId: (sessionId) =>
          useSessionSelectionStore.getState().setActiveSessionId(sessionId),
      });
      if (emptyBootstrap.shouldReturn) {
        return { sessions };
      }
    } else {
      const rememberedBootstrap = await handleRememberedWorkspaceSessionBootstrap({
        lastViewedSessionByWorkspace,
        latencyFlowId,
        logicalWorkspaceId,
        measurementOperationId,
        requestHeaders,
        sessions,
        startedAt,
        workspaceId,
        isCurrent,
      }, {
        clearLastViewedSession,
        getActiveSessionId: () => useSessionSelectionStore.getState().activeSessionId,
        getSessionRecord,
        patchSessionRecord,
        rehydrateSessionSlotFromHistory,
        selectSession,
        setActiveSessionId: (sessionId) =>
          useSessionSelectionStore.getState().setActiveSessionId(sessionId),
      });
      if (rememberedBootstrap.shouldReturn) {
        return { sessions };
      }
    }

    if (isCurrent()) {
      markWorkspaceBootstrappedInSession(workspaceId);
    }

    return { sessions };
    } catch (error) {
      measurementFinishReason = "error_sanitized";
      throw error;
    } finally {
      unbindMeasurementCategories();
      if (measurementOperationId) {
        markOperationForNextCommit(measurementOperationId, [
          "workspace-shell",
          "workspace-sidebar",
          "global-header",
          "header-tabs",
          "chat-surface",
          "session-transcript-pane",
          "transcript-list",
          "file-tree",
        ]);
        finishOrCancelMeasurementOperation(measurementOperationId, measurementFinishReason);
      }
    }
  }, [
    applySessionSummary,
    cancelDeferredFileTreePrefetch,
    lastViewedSessionByWorkspace,
    createEmptySessionWithResolvedConfig,
    agentsByKind,
    prepareFileWorkspace,
    preferences,
    ensureCloudAgentCatalog,
    fetchWorkspaceSessions,
    getWorkspaceSessionsCacheDecision,
    scheduleDeferredFileTreePrefetch,
    selectSession,
    rehydrateSessionSlotFromHistory,
    loadWorkspaceSessions,
    workspaceCollections,
  ]);

  return {
    bootstrapWorkspace,
    reconcileHotWorkspace,
  };
}
