import {
  anyHarnessModelRegistriesKey,
  anyHarnessSessionsKey,
  anyHarnessWorkspaceSessionLaunchKey,
  getAnyHarnessClient,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import type { AnyHarnessRequestOptions, ModelRegistry } from "@anyharness/sdk";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { orderChatLaunchAgents, shouldExposeChatLaunchAgent } from "@/config/chat-launch";
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { isSessionModelAvailabilityInterruption } from "@/hooks/sessions/use-session-model-availability-workflow";
import type { WorkspaceSession } from "@/hooks/sessions/use-session-selection-actions";
import {
  choosePreferredWorkspaceSession,
} from "@/lib/domain/workspaces/selection";
import { workspaceFileTreeStateKey } from "@/lib/domain/workspaces/collections";
import { resolveEffectiveLaunchSelection } from "@/lib/domain/chat/model-selection";
import { mergeLaunchAgentsWithRegistries } from "@/lib/domain/chat/session-config";
import { hasHiddenDismissedWorkspaceSessions } from "@/lib/domain/workspaces/selection";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/latency-flow";
import {
  bindMeasurementCategories,
  finishOrCancelMeasurementOperation,
  getMeasurementRequestOptions,
  hashMeasurementScope,
  markOperationForNextCommit,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
  type MeasurementFinishReason,
} from "@/lib/infra/debug-measurement";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import {
  clearLastViewedSession,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { markWorkspaceBootstrappedInSession } from "./workspace-bootstrap-memory";

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
const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

async function fetchWorkspaceSessionsWithConnection(
  workspaceConnection: AnyHarnessResolvedConnection,
  workspaceId: string,
  options?: {
    includeDismissed?: boolean;
    requestOptions?: AnyHarnessRequestOptions;
  },
): Promise<WorkspaceSession[]> {
  const requestOptions = options?.includeDismissed
    ? { ...options?.requestOptions, includeDismissed: true }
    : options?.requestOptions;
  const sessions = await getAnyHarnessClient(workspaceConnection).sessions.list(
    workspaceConnection.anyharnessWorkspaceId,
    requestOptions,
  );
  return sessions.map((session) => ({
    ...session,
    workspaceId,
  }));
}

async function fetchWorkspaceLaunchCatalog(
  workspaceConnection: AnyHarnessResolvedConnection,
  latencyFlowId?: string | null,
) {
  return getAnyHarnessClient(workspaceConnection).workspaces.getSessionLaunchCatalog(
    workspaceConnection.anyharnessWorkspaceId,
    latencyFlowId
      ? { headers: getLatencyFlowRequestHeaders(latencyFlowId) }
      : undefined,
  );
}

export function useWorkspaceBootstrapActions() {
  const queryClient = useQueryClient();
  const workspaceCollections = useWorkspaces().data;
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
  })));
  const lastViewedSessionByWorkspace = useWorkspaceUiStore(
    (state) => state.lastViewedSessionByWorkspace,
  );
  const { initForWorkspace } = useWorkspaceFileActions();
  const { selectSession, createEmptySessionWithResolvedConfig } = useSessionActions();

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
    let sessionsLoadFailed = false;
    const sessionsQueryKey = anyHarnessSessionsKey(runtimeUrl, workspaceId);
    if (measurementOperationId) {
      const sessionsCacheState = queryClient.getQueryState(sessionsQueryKey);
      recordMeasurementMetric({
        type: "cache",
        category: "session.list",
        operationId: measurementOperationId,
        decision: sessionsCacheState?.dataUpdatedAt
          ? sessionsCacheState.isInvalidated ? "stale" : "hit"
          : "miss",
        source: "react_query",
      });
    }
    const sessionRequestOptions = getMeasurementRequestOptions({
      operationId: measurementOperationId,
      category: "session.list",
      headers: getLatencyFlowRequestHeaders(latencyFlowId) ?? undefined,
    });
    const [sessions] = await Promise.all([
      queryClient.ensureQueryData({
        queryKey: sessionsQueryKey,
        queryFn: () => fetchWorkspaceSessionsWithConnection(
          workspaceConnection,
          workspaceId,
          sessionRequestOptions ? { requestOptions: sessionRequestOptions } : undefined,
        ),
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
      }),
      initForWorkspace(
        workspaceId,
        workspaceConnection.runtimeUrl,
        treeStateKey,
        workspaceConnection.anyharnessWorkspaceId,
        workspaceConnection.authToken ?? undefined,
      ).then(() => {
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.file_tree_init",
          startedAt: initWorkspaceStartedAt,
        });
        if (!isCurrent()) {
          return;
        }
        logLatency("workspace.select.workspace_initialized", {
          workspaceId,
          elapsedMs: elapsedMs(initWorkspaceStartedAt),
        });
      }),
    ]);

    if (!isCurrent()) {
      return { sessions };
    }

    if (sessions.length === 0) {
      if (!sessionsLoadFailed) {
        clearLastViewedSession(logicalWorkspaceId);
      }
      const dismissedCheckStartedAt = startLatencyTimer();
      const sessionsIncludingDismissed = await fetchWorkspaceSessionsWithConnection(
        workspaceConnection,
        workspaceId,
        {
          includeDismissed: true,
          requestOptions: sessionRequestOptions,
        },
      ).catch(() => sessions);
      const hasDismissedSessions = hasHiddenDismissedWorkspaceSessions(
        sessions,
        sessionsIncludingDismissed,
      );
      logLatency("workspace.select.dismissed_sessions_checked", {
        workspaceId,
        visibleSessionCount: sessions.length,
        totalSessionCount: sessionsIncludingDismissed.length,
        hasDismissedSessions,
        elapsedMs: elapsedMs(dismissedCheckStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "workspace.bootstrap.dismissed_sessions",
        startedAt: dismissedCheckStartedAt,
        count: sessionsIncludingDismissed.length,
      });

      if (hasDismissedSessions) {
        useHarnessStore.getState().setActiveSessionId(null);
        if (isCurrent()) {
          markWorkspaceBootstrappedInSession(workspaceId);
        }
        return { sessions };
      }

      const launchCatalogStartedAt = startLatencyTimer();
      const launchCatalog = await queryClient.ensureQueryData({
        queryKey: anyHarnessWorkspaceSessionLaunchKey(workspaceConnection.runtimeUrl, workspaceId),
        queryFn: () => fetchWorkspaceLaunchCatalog(workspaceConnection, latencyFlowId),
      }).catch(() => null);
      const modelRegistries = await queryClient.ensureQueryData({
        queryKey: anyHarnessModelRegistriesKey(runtimeUrl),
        queryFn: () => getAnyHarnessClient(workspaceConnection).modelRegistries.list(),
      }).catch(() => EMPTY_MODEL_REGISTRIES);

      logLatency("workspace.select.launch_catalog_loaded", {
        workspaceId,
        agentCount: launchCatalog?.agents?.length ?? 0,
        elapsedMs: elapsedMs(launchCatalogStartedAt),
      });
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "workspace.bootstrap.launch_catalog",
        startedAt: launchCatalogStartedAt,
        count: launchCatalog?.agents?.length ?? 0,
      });

      if (!isCurrent()) {
        return { sessions };
      }

      const launchAgents = orderChatLaunchAgents(
        mergeLaunchAgentsWithRegistries(
          launchCatalog?.agents ?? [],
          modelRegistries,
        ).filter(shouldExposeChatLaunchAgent),
      );
      const defaultLaunch = resolveEffectiveLaunchSelection(
        launchAgents,
        preferences,
      );
      logLatency("workspace.select.default_launch_resolved", {
        workspaceId,
        hasDefaultLaunch: !!defaultLaunch,
        agentKind: defaultLaunch?.kind ?? null,
        modelId: defaultLaunch?.modelId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });

      if (defaultLaunch) {
        logLatency("workspace.select.initial_session_open.start", {
          workspaceId,
          agentKind: defaultLaunch.kind,
          modelId: defaultLaunch.modelId,
          totalElapsedMs: elapsedMs(startedAt),
        });
        const sessionDispatchStartedAt = startLatencyTimer();
        try {
          await createEmptySessionWithResolvedConfig({
            workspaceId,
            agentKind: defaultLaunch.kind,
            modelId: defaultLaunch.modelId,
            latencyFlowId,
            reuseInFlightEmptySession: true,
          });
        } catch (error) {
          if (isSessionModelAvailabilityInterruption(error)) {
            return { sessions };
          }
          throw error;
        }
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.initial_session",
          startedAt: sessionDispatchStartedAt,
        });
        logLatency("workspace.select.initial_session_open.dispatched", {
          workspaceId,
          agentKind: defaultLaunch.kind,
          modelId: defaultLaunch.modelId,
          dispatchElapsedMs: elapsedMs(sessionDispatchStartedAt),
          totalElapsedMs: elapsedMs(startedAt),
        });
        logLatency("workspace.select.initial_session_open.success", {
          workspaceId,
          agentKind: defaultLaunch.kind,
          modelId: defaultLaunch.modelId,
          totalElapsedMs: elapsedMs(startedAt),
        });
      }
    } else {
      const rememberedSessionId = lastViewedSessionByWorkspace[logicalWorkspaceId] ?? null;
      const targetSession = choosePreferredWorkspaceSession(
        sessions,
        rememberedSessionId,
      );
      if (rememberedSessionId && targetSession?.id !== rememberedSessionId) {
        clearLastViewedSession(logicalWorkspaceId, rememberedSessionId);
      }

      if (targetSession && isCurrent()) {
        logLatency("workspace.select.session_select.start", {
          workspaceId,
          sessionId: targetSession.id,
          totalElapsedMs: elapsedMs(startedAt),
        });
        const sessionSelectStartedAt = performance.now();
        await selectSession(targetSession.id, { latencyFlowId });
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.session_select",
          startedAt: sessionSelectStartedAt,
        });
        logLatency("workspace.select.success", {
          workspaceId,
          sessionId: targetSession.id,
          sessionCount: sessions.length,
          totalElapsedMs: elapsedMs(startedAt),
        });
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
    initForWorkspace,
    lastViewedSessionByWorkspace,
    createEmptySessionWithResolvedConfig,
    preferences,
    queryClient,
    selectSession,
    workspaceCollections,
  ]);

  return {
    bootstrapWorkspace,
  };
}
