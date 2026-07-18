import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceBootstrapCache } from "#product/hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache";
import { useCloudAgentCatalogCache } from "#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useWorkspaceFileActions } from "#product/hooks/workspaces/facade/files/use-workspace-file-actions";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import { useSessionHistoryHydration } from "#product/hooks/sessions/lifecycle/use-session-history-hydration";
import { useSessionSelectionActions } from "#product/hooks/sessions/facade/use-session-selection-actions";
import { useSessionSummaryActions } from "#product/hooks/sessions/workflows/use-session-summary-actions";
import { workspaceFileTreeStateKey } from "#product/lib/domain/workspaces/cloud/collections";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";
import { getLatencyFlowRequestHeaders } from "#product/lib/infra/measurement/measurement-port";
import {
  bindMeasurementCategories,
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "#product/lib/infra/measurement/measurement-port";
import { getMeasurementRequestOptions } from "#product/lib/infra/measurement/measurement-port";
import { hashMeasurementScope } from "#product/lib/infra/measurement/measurement-port";
import type {
  MeasurementFinishReason,
} from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import {
  clearLastViewedSession,
  useWorkspaceUiStore,
} from "#product/stores/preferences/workspace-ui-store";
import {
  getSessionRecord,
  patchSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { markWorkspaceBootstrappedInSession } from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import { useDeferredWorkspaceFileTreePrefetch } from "#product/hooks/workspaces/lifecycle/files/use-deferred-workspace-file-tree-prefetch";
import { useHotWorkspaceReconcileAction } from "#product/hooks/workspaces/workflows/use-hot-workspace-reconcile-action";
import {
  clearInvalidOptimisticActiveSession,
  findLoadedSessionForClientSession,
} from "#product/hooks/workspaces/workflows/workspace-bootstrap-session-state";
import {
  isOptimisticWorkspaceSessionPlaceholder,
} from "#product/lib/domain/workspaces/selection/optimistic-session-shell";
import { handleEmptyWorkspaceBootstrap } from "#product/hooks/workspaces/workflows/workspace-bootstrap-empty-session";
import { handleRememberedWorkspaceSessionBootstrap } from "#product/hooks/workspaces/workflows/workspace-bootstrap-remembered-session";
import {
  shouldPreserveStagedReplacementShell,
} from "#product/hooks/sessions/workflows/session-replacement-tombstones";
import { useProductStorageContext } from "#product/hooks/persistence/facade/use-product-storage-context";
import { resumePendingEmptySessionCreations } from "#product/hooks/sessions/workflows/pending-empty-session-creation";

interface BootstrapWorkspaceInput {
  workspaceId: string;
  logicalWorkspaceId: string;
  workspaceConnection: AnyHarnessResolvedConnection;
  startedAt: number;
  latencyFlowId?: string | null;
  isCurrent: () => boolean;
}

const EMPTY_WORKSPACES = [] as const;
const WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS = 8_000;

export function useWorkspaceBootstrapActions() {
  const storageContext = useProductStorageContext();
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
          decision: getWorkspaceSessionsCacheDecision(workspaceId),
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

    const resumedEmptySessionCreations = await resumePendingEmptySessionCreations(
      storageContext,
      workspaceId,
      isCurrent,
      createEmptySessionWithResolvedConfig,
    );
    if (!isCurrent()) {
      return { sessions };
    }
    if (resumedEmptySessionCreations > 0) {
      logLatency("workspace.select.pending_session_creation_resumed", {
        workspaceId,
        resumedCount: resumedEmptySessionCreations,
        totalElapsedMs: elapsedMs(startedAt),
      });
      if (isCurrent()) {
        markWorkspaceBootstrappedInSession(workspaceId);
      }
      return { sessions };
    }

    const activeSessionIdAfterLoad = useSessionSelectionStore.getState().activeSessionId;
    const activeSessionRecordAfterLoad = activeSessionIdAfterLoad
      ? getSessionRecord(activeSessionIdAfterLoad)
      : null;
    const preserveStagedReplacementShell = shouldPreserveStagedReplacementShell(
      workspaceId,
      activeSessionRecordAfterLoad?.workspaceId,
    );
    const loadedActiveSession = activeSessionIdAfterLoad
      ? findLoadedSessionForClientSession(activeSessionIdAfterLoad, sessions)
      : null;
    if (activeSessionIdAfterLoad && loadedActiveSession) {
      const wasOptimisticPlaceholder =
        isOptimisticWorkspaceSessionPlaceholder(activeSessionRecordAfterLoad);
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
    } else if (!sessionsLoadFailed && !preserveStagedReplacementShell) {
      clearInvalidOptimisticActiveSession({
        workspaceId,
        logicalWorkspaceId,
      });
    }

    if (sessions.length === 0) {
      if (preserveStagedReplacementShell) {
        logLatency("workspace.select.initial_session_open.skipped", {
          workspaceId,
          sessionId: activeSessionIdAfterLoad,
          reason: "staged_session_replacement",
          totalElapsedMs: elapsedMs(startedAt),
        });
        if (isCurrent()) {
          markWorkspaceBootstrappedInSession(workspaceId);
        }
        return { sessions };
      }
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
    storageContext,
  ]);

  return {
    bootstrapWorkspace,
    reconcileHotWorkspace,
  };
}
