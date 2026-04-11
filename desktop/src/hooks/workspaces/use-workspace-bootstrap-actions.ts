import {
  anyHarnessModelRegistriesKey,
  anyHarnessSessionsKey,
  anyHarnessWorkspaceSessionLaunchKey,
  getAnyHarnessClient,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import type { ModelRegistry } from "@anyharness/sdk";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { orderChatLaunchAgents, shouldExposeChatLaunchAgent } from "@/config/chat-launch";
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
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
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
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
  options?: { includeDismissed?: boolean },
): Promise<WorkspaceSession[]> {
  const sessions = await getAnyHarnessClient(workspaceConnection).sessions.list(
    workspaceConnection.anyharnessWorkspaceId,
    options?.includeDismissed ? { includeDismissed: true } : undefined,
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
    defaultChatModelId: state.defaultChatModelId,
  })));
  const lastViewedSessionByWorkspace = useWorkspaceUiStore(
    (state) => state.lastViewedSessionByWorkspace,
  );
  const { initForWorkspace } = useWorkspaceFileActions();
  const { selectSession, openWorkspaceSessionWithResolvedConfig } = useSessionActions();

  const bootstrapWorkspace = useCallback(async ({
    workspaceId,
    logicalWorkspaceId,
    runtimeUrl,
    workspaceConnection,
    startedAt,
    latencyFlowId,
    isCurrent,
  }: BootstrapWorkspaceInput): Promise<{ sessions: WorkspaceSession[] }> => {
    const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
    const workspace = workspaces.find((entry) => entry.id === workspaceId);
    const treeStateKey = workspace
      ? workspaceFileTreeStateKey(workspace)
      : workspaceId;
    const sessionsStartedAt = startLatencyTimer();
    const initWorkspaceStartedAt = startLatencyTimer();
    const [sessions] = await Promise.all([
      queryClient.ensureQueryData({
        queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId),
        queryFn: () => fetchWorkspaceSessionsWithConnection(workspaceConnection, workspaceId),
      }).then((result) => {
        logLatency("workspace.select.sessions_loaded", {
          workspaceId,
          sessionCount: result.length,
          elapsedMs: elapsedMs(sessionsStartedAt),
        });
        return result;
      }).catch(() => {
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
      const dismissedCheckStartedAt = startLatencyTimer();
      const sessionsIncludingDismissed = await fetchWorkspaceSessionsWithConnection(
        workspaceConnection,
        workspaceId,
        { includeDismissed: true },
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
        await openWorkspaceSessionWithResolvedConfig({
          workspaceId,
          agentKind: defaultLaunch.kind,
          modelId: defaultLaunch.modelId,
          latencyFlowId,
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
      const targetSession = choosePreferredWorkspaceSession(
        sessions,
        lastViewedSessionByWorkspace[logicalWorkspaceId] ?? null,
      );

      if (targetSession && isCurrent()) {
        logLatency("workspace.select.session_select.start", {
          workspaceId,
          sessionId: targetSession.id,
          totalElapsedMs: elapsedMs(startedAt),
        });
        await selectSession(targetSession.id, { latencyFlowId });
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
  }, [
    initForWorkspace,
    lastViewedSessionByWorkspace,
    openWorkspaceSessionWithResolvedConfig,
    preferences,
    queryClient,
    selectSession,
    workspaceCollections,
  ]);

  return {
    bootstrapWorkspace,
  };
}
