import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceBootstrapCache } from "#product/hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache";
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
  getLatencyFlowRequestHeaders,
  getMeasurementRequestOptions,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";
import {
  beginRendererFlow,
  markRendererFlowDataReady,
  markRendererFlowShellCommitted,
} from "#product/lib/infra/diagnostics/renderer-flow-timing";
import { finishWorkspaceOpenRendererFlow } from "#product/hooks/workspaces/workflows/workspace-open-flow-finish";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import {
  clearLastViewedSession,
  useWorkspaceUiStore,
} from "#product/stores/preferences/workspace-ui-store";
import { getSessionRecord, patchSessionRecord, removeSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { pendingWorkspaceEntryForWorkspaceId } from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import { markWorkspaceBootstrappedInSession } from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import { useDeferredWorkspaceFileTreePrefetch } from "#product/hooks/workspaces/lifecycle/files/use-deferred-workspace-file-tree-prefetch";
import { useHotWorkspaceReconcileAction } from "#product/hooks/workspaces/workflows/use-hot-workspace-reconcile-action";
import {
  clearInvalidOptimisticActiveSession,
  findLoadedSessionForClientSession,
} from "#product/hooks/workspaces/workflows/workspace-bootstrap-session-state";
import { handleEmptyWorkspaceBootstrapWithRecovery } from "#product/hooks/workspaces/workflows/workspace-bootstrap-empty-session";
import { handleRememberedWorkspaceSessionBootstrap } from "#product/hooks/workspaces/workflows/workspace-bootstrap-remembered-session";
import { shouldPreserveStagedReplacementShell } from "#product/hooks/sessions/workflows/session-replacement-tombstones";
import { useProductStorageContext } from "#product/hooks/persistence/facade/use-product-storage-context";
import { resumePendingEmptySessionCreationForBootstrap } from "#product/hooks/workspaces/workflows/workspace-bootstrap-pending-empty-session";
import {
  loadWorkspaceSessionDirectory,
  recoverFailedWorkspaceSessionDirectory,
} from "#product/hooks/workspaces/workflows/workspace-bootstrap-session-directory";
import { enterWorkspaceSessionRecovery } from "#product/hooks/workspaces/workflows/workspace-session-recovery-state";
import type { WorkspaceSelectionDeps } from "#product/hooks/workspaces/workflows/selection/types";

type BootstrapWorkspaceInput = Parameters<WorkspaceSelectionDeps["bootstrapWorkspace"]>[0];

const EMPTY_WORKSPACES = [] as const;
const WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS = 8_000;

export function useWorkspaceBootstrapActions() {
  const storageContext = useProductStorageContext();
  const {
    fetchWorkspaceSessions,
    getWorkspaceSessionsCacheDecision,
    loadWorkspaceSessions,
  } = useWorkspaceBootstrapCache();
  const { agentsByKind } = useAgentCatalog();
  const workspaceCollections = useWorkspaces().data;
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
  })));
  const lastViewedSessionByWorkspace = useWorkspaceUiStore(
    (state) => state.lastViewedSessionByWorkspace,
  );
  const { prepareFileWorkspace, prefetchWorkspaceDirectories } = useWorkspaceFileActions();
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
    applySessionSummary,
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
    forceSessionDirectoryRefresh,
    isCurrent, signal,
  }: BootstrapWorkspaceInput): Promise<{ sessions: WorkspaceSession[] }> => {
    // UX-latency R1 (Q17): workspace_open emits ONLY through the renderer
    // flow-timing family. The old `startMeasurementOperation({kind:"workspace_open"})`
    // measurement operation and its `logLatency("workspace.select.*")` emits in
    // this function were the parallel layer the ADR gate forbids; both are gone.
    // `measurementOperationId` is now null so the downstream measurement
    // recorders no-op, while the latency-flow REQUEST HEADERS
    // (getLatencyFlowRequestHeaders/getMeasurementRequestOptions) are kept — they
    // are server-side correlation, not a renderer-side instrumentation layer.
    const measurementOperationId = null;
    // Renderer-flow outcome: null => finish (content_stable); a reason =>
    // abandon (the truthful replacement for the old cancelLatencyFlow staleness
    // signal). Superseded/stale exits set this so no false content_stable fires.
    let rendererFlowAbandonReason: string | null = null;
    // UX-latency R14: when set, content_stable is DEFERRED to the transcript
    // pane (its committed transcript is the real stable signal), so the finally
    // neither finishes nor abandons the flow; it hands the mark off. Null =>
    // finish/abandon here as before (empty workspace, error, stale).
    let deferContentStableSessionId: string | null = null;
    let sessions: WorkspaceSession[] = [];
    // UX-latency R1 canonical flow marks (intent -> shell -> data -> stable).
    // COVERAGE LIMIT (honest): this intent mark fires here, after the caller
    // has already resolved which connection/workspace to bootstrap. Upstream
    // work in run-workspace-selection.ts and selection/* (click handling,
    // connection resolution, dedupe against the current selection) runs
    // BEFORE this callback, so intent_to_shell_ms and the rest of this flow
    // under-measure the true click-to-settled latency by that upstream phase.
    beginRendererFlow({
      kind: "workspace_open",
      correlationKey: workspaceId,
      correlation: { workspaceId },
    });
    cancelDeferredFileTreePrefetch();
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
      markRendererFlowShellCommitted({
        kind: "workspace_open",
        correlationKey: workspaceId,
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
      // The session-list cache decision used to be a measurement-metric; it is
      // now the one piece of step detail rerouted onto the renderer flow (as a
      // data_ready field below), keeping it in the single instrumentation family.
      const sessionListCacheDecision = getWorkspaceSessionsCacheDecision(workspaceId);
      const requestHeaders = getLatencyFlowRequestHeaders(latencyFlowId) ?? undefined;
      const sessionRequestOptions = getMeasurementRequestOptions({
        category: "session.list",
        headers: requestHeaders,
      });
      const emptyWorkspaceBootstrapDeps = {
        clearLastViewedSession,
        createEmptySessionWithResolvedConfig,
        fetchWorkspaceSessions,
        getActiveSessionId: () => useSessionSelectionStore.getState().activeSessionId,
        getSessionRecord,
        getPendingWorkspaceEntry: () => pendingWorkspaceEntryForWorkspaceId(useSessionSelectionStore.getState().pendingWorkspaces, workspaceId),
        markWorkspaceBootstrappedInSession,
      };
      const sessionsLoadResult = await loadWorkspaceSessionDirectory({
        isCurrent,
        logicalWorkspaceId,
        measurementOperationId,
        requestOptions: sessionRequestOptions,
        signal,
        forceInitialRefresh: forceSessionDirectoryRefresh,
        sessionsStartedAt,
        timeoutMs: WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS,
        workspaceConnection,
        workspaceId,
      }, {
        loadWorkspaceSessions,
      });
      if (sessionsLoadResult.kind === "stale") {
        // Superseded selection: abandon (via finally) instead of finishing, so
        // this stale bootstrap never emits a false content_stable for a
        // workspace the user already navigated away from.
        rendererFlowAbandonReason = "workspace_selection_stale";
        return { sessions };
      }
      if (sessionsLoadResult.kind === "failed") {
        rendererFlowAbandonReason = "workspace_bootstrap_error";
        await recoverFailedWorkspaceSessionDirectory({
          agentsByKind,
          latencyFlowId,
          logicalWorkspaceId,
          measurementOperationId,
          preferences,
          requestOptions: sessionRequestOptions,
          sessions,
          shouldClearLastViewedSession: false,
          startedAt,
          timeoutMs: WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS,
          workspaceConnection,
          workspaceId,
          isCurrent,
        }, emptyWorkspaceBootstrapDeps);
        return { sessions };
      }
      sessions = sessionsLoadResult.sessions;
      markRendererFlowDataReady({
        kind: "workspace_open",
        correlationKey: workspaceId,
        detail: { session_list_cache: sessionListCacheDecision },
      });

      if (!isCurrent()) {
        // Selection was superseded after the session directory loaded; abandon
        // rather than finalize a content_stable for the abandoned workspace
        // (previously this returned with a "completed" reason and the finally
        // emitted a false content_stable).
        rendererFlowAbandonReason = "workspace_selection_stale";
        return { sessions };
      }
      if (await resumePendingEmptySessionCreationForBootstrap({
        createEmptySession: createEmptySessionWithResolvedConfig,
        isCurrent,
        startedAt,
        storageContext,
        workspaceId,
      })) {
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
        applySessionSummary(activeSessionIdAfterLoad, loadedActiveSession, workspaceId);
      } else if (!preserveStagedReplacementShell) {
        clearInvalidOptimisticActiveSession({
          workspaceId,
          logicalWorkspaceId,
        });
      }

      if (sessions.length === 0) {
        if (preserveStagedReplacementShell) {
          if (isCurrent()) {
            markWorkspaceBootstrappedInSession(workspaceId);
          }
          return { sessions };
        }
        const emptyBootstrap = await handleEmptyWorkspaceBootstrapWithRecovery({
          agentsByKind,
          latencyFlowId,
          logicalWorkspaceId,
          measurementOperationId,
          preferences,
          requestOptions: sessionRequestOptions,
          sessions,
          shouldClearLastViewedSession: true,
          startedAt,
          timeoutMs: WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS,
          workspaceConnection,
          workspaceId,
          isCurrent,
        }, emptyWorkspaceBootstrapDeps);
        if (emptyBootstrap.enteredRecovery) {
          rendererFlowAbandonReason = "workspace_bootstrap_error";
        }
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
          removeSessionRecord,
          selectSession,
          setActiveSessionId: (sessionId) =>
            useSessionSelectionStore.getState().setActiveSessionId(sessionId),
        });
        if (rememberedBootstrap.contentStableSessionId) {
          deferContentStableSessionId = rememberedBootstrap.contentStableSessionId;
        }
        if (rememberedBootstrap.shouldReturn) {
          return { sessions };
        }
      }

      if (isCurrent()) {
        markWorkspaceBootstrappedInSession(workspaceId);
      }

      return { sessions };
    } catch (error) {
      rendererFlowAbandonReason = "workspace_bootstrap_error";
      if (isCurrent()) {
        enterWorkspaceSessionRecovery(
          workspaceId,
          logicalWorkspaceId,
          "session-selection-failed",
        );
      }
      return { sessions };
    } finally {
      // UX-latency R14: abandon, defer content_stable to the transcript pane, or
      // finish now (empty workspace). See finishWorkspaceOpenRendererFlow.
      finishWorkspaceOpenRendererFlow({
        workspaceId,
        abandonReason: rendererFlowAbandonReason,
        deferContentStableSessionId,
      });
    }
  }, [
    applySessionSummary,
    cancelDeferredFileTreePrefetch,
    lastViewedSessionByWorkspace,
    createEmptySessionWithResolvedConfig,
    agentsByKind,
    prepareFileWorkspace,
    preferences,
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
