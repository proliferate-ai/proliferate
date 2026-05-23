import {
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
  useCreateCoworkThreadMutation,
} from "@anyharness/sdk-react";
import type { Session } from "@anyharness/sdk";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { resolveEffectiveChatDefaults } from "@/lib/domain/chat/composer/preference-resolvers";
import { resolveCoworkDefaultSessionModeId } from "@/lib/domain/cowork/session-mode-defaults";
import { resolveStatusFromExecutionSummary } from "@proliferate/product-model/sessions/activity";
import { workspaceFileTreeStateKey } from "@/lib/domain/workspaces/cloud/collections";
import {
  buildSubmittingPendingWorkspaceEntry,
  createPendingWorkspaceAttemptId,
  type PendingCoworkRequestInput,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import { useWorkspaceCollectionsMutationCache } from "@/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useWorkspaceEntryFlow } from "@/hooks/workspaces/use-workspace-entry-flow";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudLaunchModelRegistries } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import type { DesktopLaunchModelRegistry as ModelRegistry } from "@/lib/domain/agents/cloud-launch-catalog";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { applySessionLaunchDefaults } from "@/lib/workflows/sessions/session-launch-defaults";
import { createSessionLaunchDefaultsClient } from "@/lib/access/anyharness/session-launch-defaults-client";
import { materializeSessionRecord } from "@/hooks/sessions/workflows/session-creation-local-state";
import {
  markWorkspaceViewed,
  rememberLastViewedSession,
  trackWorkspaceInteraction,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { markWorkspaceBootstrappedInSession } from "@/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

function isAttemptCurrent(attemptId: string): boolean {
  return useSessionSelectionStore.getState().pendingWorkspaceEntry?.attemptId === attemptId;
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function materializedCoworkSessionRecord(input: {
  clientSessionId: string;
  session: Session;
  workspaceId: string;
  fallbackAgentKind: string;
  fallbackModelId: string;
  fallbackModeId: string | null;
  fallbackTitle: string | null;
}): SessionRuntimeRecord {
  const modeId =
    input.session.liveConfig?.normalizedControls.mode?.currentValue
    ?? input.session.modeId
    ?? input.fallbackModeId;
  const record = createEmptySessionRecord(
    input.clientSessionId,
    input.session.agentKind || input.fallbackAgentKind,
    {
      workspaceId: input.workspaceId,
      materializedSessionId: input.session.id,
      modelId: input.session.modelId ?? input.fallbackModelId,
      modeId,
      title: input.session.title ?? input.fallbackTitle,
      actionCapabilities: input.session.actionCapabilities,
      liveConfig: input.session.liveConfig ?? null,
      executionSummary: input.session.executionSummary ?? null,
      mcpBindingSummaries: input.session.mcpBindingSummaries ?? null,
      lastPromptAt: input.session.lastPromptAt ?? null,
      optimisticPrompt: null,
      sessionRelationship: { kind: "root" },
    },
  );

  return {
    ...record,
    status: resolveStatusFromExecutionSummary(
      input.session.executionSummary,
      input.session.status ?? "idle",
    ),
    transcriptHydrated: true,
  };
}

export function useCoworkThreadWorkflow() {
  const location = useLocation();
  const navigate = useNavigate();
  const anyHarnessRuntime = useAnyHarnessRuntimeContext();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { upsertLocalWorkspace } = useWorkspaceCollectionsMutationCache(runtimeUrl);
  const setPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const activateWorkspace = useSessionSelectionStore((state) => state.activateWorkspace);
  const { beginPendingWorkspace } = useWorkspaceEntryFlow();
  const { agents } = useAgentCatalog();
  const { data: modelRegistries = EMPTY_MODEL_REGISTRIES } = useCloudLaunchModelRegistries();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    defaultLiveSessionControlValuesByAgentKind:
      state.defaultLiveSessionControlValuesByAgentKind,
    coworkWorkspaceDelegationEnabled: state.coworkWorkspaceDelegationEnabled,
  })));
  const showToast = useToastStore((state) => state.show);
  const { selectWorkspace } = useWorkspaceSelection();
  const { initForWorkspace } = useWorkspaceFileActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const setDraftText = useChatInputStore((state) => state.setDraftText);
  const clearDraft = useChatInputStore((state) => state.clearDraft);
  const createCoworkThreadMutation = useCreateCoworkThreadMutation();

  const navigateToWorkspaceShell = useCallback(() => {
    if (location.pathname !== "/") {
      navigate("/");
    }
  }, [location.pathname, navigate]);

  const createThreadWithResolvedConfig = useCallback(async (input: {
    agentKind: string;
    modelId: string;
    modeId?: string | null;
    draftText?: string | null;
    sourceWorkspaceId?: string | null;
  }) => {
    const totalStartedAt = startLatencyTimer();
    const modeId = input.modeId?.trim() || resolveCoworkDefaultSessionModeId(input.agentKind);
    const pendingRequest: PendingCoworkRequestInput = {
      agentKind: input.agentKind,
      modelId: input.modelId,
      ...(modeId ? { modeId } : {}),
      draftText: input.draftText ?? null,
      sourceWorkspaceId: input.sourceWorkspaceId ?? null,
    };

    const entry: PendingWorkspaceEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: createPendingWorkspaceAttemptId(),
      selectedWorkspaceId: useSessionSelectionStore.getState().selectedWorkspaceId,
      source: "cowork-created",
      displayName: "Cowork thread",
      request: { kind: "cowork", input: pendingRequest },
    });

    logLatency("workspace.cowork.create.pending_shell", {
      attemptId: entry.attemptId,
      agentKind: input.agentKind,
      modelId: input.modelId,
    });
    useWorkspaceUiStore.getState().setThreadsCollapsed(false);
    const projectedSessionId = beginPendingWorkspace(entry, {
      initialSession: {
        kind: "session",
        agentKind: input.agentKind,
        modelId: input.modelId,
        modeId,
        displayTitle: input.modelId,
      },
    });
    navigateToWorkspaceShell();

    try {
      if (!isAttemptCurrent(entry.attemptId)) {
        return null;
      }

      const createStartedAt = startLatencyTimer();
      logLatency("workspace.cowork.create.request.start", {
        attemptId: entry.attemptId,
        agentKind: input.agentKind,
        modelId: input.modelId,
        modeId: modeId ?? null,
        workspaceDelegationEnabled: preferences.coworkWorkspaceDelegationEnabled,
        elapsedSincePendingMs: elapsedSince(entry.createdAt),
      });

      const result = await createCoworkThreadMutation.mutateAsync({
        agentKind: input.agentKind,
        modelId: input.modelId,
        coworkWorkspaceDelegationEnabled: preferences.coworkWorkspaceDelegationEnabled,
        ...(modeId ? { modeId } : {}),
      });

      logLatency("workspace.cowork.create.request.success", {
        attemptId: entry.attemptId,
        workspaceId: result.workspace.id,
        sessionId: result.session.id,
        createElapsedMs: elapsedMs(createStartedAt),
        totalElapsedMs: elapsedMs(totalStartedAt),
      });

      if (!isAttemptCurrent(entry.attemptId)) {
        return null;
      }

      const launchDefaults = await applySessionLaunchDefaults({
        client: createSessionLaunchDefaultsClient(resolveRuntimeConnection(anyHarnessRuntime)),
        session: result.session,
        agentKind: input.agentKind,
        modelRegistries,
        defaultLiveSessionControlValuesByAgentKind:
          preferences.defaultLiveSessionControlValuesByAgentKind,
      });

      if (!isAttemptCurrent(entry.attemptId)) {
        return null;
      }

      const launchedSession = launchDefaults.session;

      upsertLocalWorkspace(result.workspace);
      upsertWorkspaceSessionRecord(result.workspace.id, launchedSession);
      const activeSessionId = projectedSessionId ?? launchedSession.id;
      if (projectedSessionId) {
        const projectedRecord = getSessionRecord(projectedSessionId);
        const record = materializedCoworkSessionRecord({
          clientSessionId: projectedSessionId,
          session: launchedSession,
          workspaceId: result.workspace.id,
          fallbackAgentKind: input.agentKind,
          fallbackModelId: input.modelId,
          fallbackModeId: modeId ?? null,
          fallbackTitle: projectedRecord?.title ?? input.modelId,
        });
        materializeSessionRecord(projectedSessionId, launchedSession.id, record);
        useSessionIntentStore.getState().bindMaterializedSession(
          projectedSessionId,
          launchedSession.id,
        );
      } else {
        putSessionRecord(
          materializedCoworkSessionRecord({
            clientSessionId: launchedSession.id,
            session: launchedSession,
            workspaceId: result.workspace.id,
            fallbackAgentKind: input.agentKind,
            fallbackModelId: input.modelId,
            fallbackModeId: modeId ?? null,
            fallbackTitle: input.modelId,
          }),
        );
      }
      if (input.draftText?.length) {
        setDraftText(result.workspace.id, input.draftText);
        if (input.sourceWorkspaceId && input.sourceWorkspaceId !== result.workspace.id) {
          clearDraft(input.sourceWorkspaceId);
        }
      }

      const selectionStartedAt = startLatencyTimer();
      setPendingWorkspaceEntry({
        ...entry,
        workspaceId: result.workspace.id,
        request: { kind: "select-existing", workspaceId: result.workspace.id },
      });
      activateWorkspace({
        logicalWorkspaceId: null,
        workspaceId: result.workspace.id,
        clearPending: false,
        initialActiveSessionId: activeSessionId,
      });
      rememberLastViewedSession(result.workspace.id, launchedSession.id);
      trackWorkspaceInteraction(result.workspace.id, new Date().toISOString());
      markWorkspaceViewed(result.workspace.id);
      markWorkspaceBootstrappedInSession(result.workspace.id);

      const workspaceInitStartedAt = startLatencyTimer();
      void initForWorkspace({
        workspaceUiKey: result.workspace.id,
        materializedWorkspaceId: result.workspace.id,
        anyharnessWorkspaceId: result.workspace.id,
        runtimeUrl,
        treeStateKey: workspaceFileTreeStateKey(result.workspace),
      }).then(() => {
        logLatency("workspace.cowork.create.workspace_initialized", {
          attemptId: entry.attemptId,
          workspaceId: result.workspace.id,
          elapsedMs: elapsedMs(workspaceInitStartedAt),
        });
      }).catch(() => {
        logLatency("workspace.cowork.create.workspace_init_failed", {
          attemptId: entry.attemptId,
          workspaceId: result.workspace.id,
          elapsedMs: elapsedMs(workspaceInitStartedAt),
        });
      });
      logLatency("workspace.cowork.create.selection.success", {
        attemptId: entry.attemptId,
        workspaceId: result.workspace.id,
        selectionElapsedMs: elapsedMs(selectionStartedAt),
        totalElapsedMs: elapsedMs(totalStartedAt),
      });
      if (isAttemptCurrent(entry.attemptId)) {
        setPendingWorkspaceEntry(null);
      }
      return {
        ...result,
        projectedSessionId,
      };
    } catch (error) {
      const message = resolveErrorMessage(error, "Couldn't start cowork thread.");
      logLatency("workspace.cowork.create.failed", {
        attemptId: entry.attemptId,
        errorMessage: message,
        elapsedSincePendingMs: elapsedSince(entry.createdAt),
      });
      if (isAttemptCurrent(entry.attemptId)) {
        const currentPending = useSessionSelectionStore.getState().pendingWorkspaceEntry;
        const failedEntry = currentPending?.attemptId === entry.attemptId
          ? currentPending
          : entry;
        setPendingWorkspaceEntry({
          ...failedEntry,
          stage: "failed",
          errorMessage: message,
        });
      }
      showToast(message);
      throw error;
    }
  }, [
    anyHarnessRuntime,
    beginPendingWorkspace,
    clearDraft,
    createCoworkThreadMutation,
    initForWorkspace,
    modelRegistries,
    navigateToWorkspaceShell,
    preferences.coworkWorkspaceDelegationEnabled,
    preferences.defaultLiveSessionControlValuesByAgentKind,
    runtimeUrl,
    setDraftText,
    activateWorkspace,
    setPendingWorkspaceEntry,
    showToast,
    upsertLocalWorkspace,
    upsertWorkspaceSessionRecord,
  ]);

  const createThread = useCallback(async () => {
    const defaults = resolveEffectiveChatDefaults(
      modelRegistries,
      agents,
      preferences,
      null,
    );

    if (!defaults.agentKind || !defaults.modelId) {
      throw new Error(defaults.degradedReason ?? "No ready agents are available.");
    }

    if (defaults.degradedReason) {
      showToast(defaults.degradedReason, "info");
    }

    return createThreadWithResolvedConfig({
      agentKind: defaults.agentKind,
      modelId: defaults.modelId,
    });
  }, [
    agents,
    createThreadWithResolvedConfig,
    modelRegistries,
    preferences,
    showToast,
  ]);

  const createThreadFromSelection = useCallback(async (input: {
    agentKind: string;
    modelId: string;
    modeId?: string | null;
    draftText?: string | null;
    sourceWorkspaceId?: string | null;
  }) => {
    return createThreadWithResolvedConfig({
      agentKind: input.agentKind,
      modelId: input.modelId,
      modeId: input.modeId,
      draftText: input.draftText,
      sourceWorkspaceId: input.sourceWorkspaceId,
    });
  }, [createThreadWithResolvedConfig]);

  const openThread = useCallback(async (workspaceId: string) => {
    navigateToWorkspaceShell();
    await selectWorkspace(workspaceId, { force: true });
  }, [navigateToWorkspaceShell, selectWorkspace]);

  return {
    createThread,
    createThreadFromSelection,
    openThread,
    isCreatingThread: createCoworkThreadMutation.isPending,
  };
}
