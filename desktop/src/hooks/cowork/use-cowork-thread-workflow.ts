import { useModelRegistriesQuery, useCreateCoworkThreadMutation } from "@anyharness/sdk-react";
import type { ModelRegistry } from "@anyharness/sdk";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { resolveEffectiveChatDefaults } from "@/lib/domain/chat/preference-resolvers";
import { resolveCoworkDefaultSessionModeId } from "@/lib/domain/cowork/session-mode-defaults";
import {
  type WorkspaceCollections,
  upsertLocalWorkspaceCollections,
} from "@/lib/domain/workspaces/collections";
import {
  buildSubmittingPendingWorkspaceEntry,
  createPendingWorkspaceAttemptId,
  type PendingCoworkRequestInput,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/pending-entry";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import {
  COWORK_WORKSPACE_PATH_PLACEHOLDER,
  resolveSessionMcpServersForLaunch,
} from "@/lib/integrations/anyharness/mcp_launch";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

function isAttemptCurrent(attemptId: string): boolean {
  return useHarnessStore.getState().pendingWorkspaceEntry?.attemptId === attemptId;
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useCoworkThreadWorkflow() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const enterPendingWorkspaceShell = useHarnessStore(
    (state) => state.enterPendingWorkspaceShell,
  );
  const setPendingWorkspaceEntry = useHarnessStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const { agents } = useAgentCatalog();
  const { data: modelRegistries = EMPTY_MODEL_REGISTRIES } = useModelRegistriesQuery();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
    powersInCodingSessionsEnabled: state.powersInCodingSessionsEnabled,
    coworkWorkspaceDelegationEnabled: state.coworkWorkspaceDelegationEnabled,
  })));
  const showToast = useToastStore((state) => state.show);
  const { selectWorkspace } = useWorkspaceSelection();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const setDraftText = useChatInputStore((state) => state.setDraftText);
  const clearDraft = useChatInputStore((state) => state.clearDraft);
  const requestComposerFocus = useChatInputStore((state) => state.requestFocus);
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
      selectedWorkspaceId: useHarnessStore.getState().selectedWorkspaceId,
      source: "cowork-created",
      displayName: "Cowork thread",
      request: { kind: "cowork", input: pendingRequest },
    });

    logLatency("workspace.cowork.create.pending_shell", {
      attemptId: entry.attemptId,
      agentKind: input.agentKind,
      modelId: input.modelId,
    });
    enterPendingWorkspaceShell(entry);
    requestComposerFocus();
    navigateToWorkspaceShell();

    try {
      const resolveStartedAt = startLatencyTimer();
      const { mcpServers, mcpBindingSummaries } = preferences.powersInCodingSessionsEnabled
        ? await resolveSessionMcpServersForLaunch({
          targetLocation: "local",
          workspacePath: COWORK_WORKSPACE_PATH_PLACEHOLDER,
          policy: {
            workspaceSurface: "cowork",
            lifecycle: "create",
            enabled: true,
          },
        })
        : { mcpServers: [], mcpBindingSummaries: [] };
      logLatency("workspace.cowork.create.mcp_resolved", {
        attemptId: entry.attemptId,
        powersEnabled: preferences.powersInCodingSessionsEnabled,
        mcpServerCount: mcpServers.length,
        elapsedMs: elapsedMs(resolveStartedAt),
      });

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
        mcpServerCount: mcpServers.length,
        elapsedSincePendingMs: elapsedSince(entry.createdAt),
      });

      const result = await createCoworkThreadMutation.mutateAsync({
        agentKind: input.agentKind,
        modelId: input.modelId,
        coworkWorkspaceDelegationEnabled: preferences.coworkWorkspaceDelegationEnabled,
        ...(modeId ? { modeId } : {}),
        ...(mcpServers.length > 0 ? { mcpServers } : {}),
        mcpBindingSummaries,
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

      queryClient.setQueriesData<WorkspaceCollections | undefined>(
        { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
        (collections) => upsertLocalWorkspaceCollections(collections, result.workspace),
      );
      upsertWorkspaceSessionRecord(result.workspace.id, result.session);
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
      await selectWorkspace(result.workspace.id, {
        force: true,
        preservePending: true,
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
      return result;
    } catch (error) {
      const message = resolveErrorMessage(error, "Couldn't start cowork thread.");
      logLatency("workspace.cowork.create.failed", {
        attemptId: entry.attemptId,
        errorMessage: message,
        elapsedSincePendingMs: elapsedSince(entry.createdAt),
      });
      if (isAttemptCurrent(entry.attemptId)) {
        setPendingWorkspaceEntry({
          ...entry,
          stage: "failed",
          errorMessage: message,
        });
      }
      showToast(message);
      throw error;
    }
  }, [
    clearDraft,
    createCoworkThreadMutation,
    enterPendingWorkspaceShell,
    navigateToWorkspaceShell,
    preferences.coworkWorkspaceDelegationEnabled,
    queryClient,
    requestComposerFocus,
    runtimeUrl,
    selectWorkspace,
    setDraftText,
    setPendingWorkspaceEntry,
    showToast,
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
