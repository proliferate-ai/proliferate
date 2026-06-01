import {
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
  useCreateCoworkThreadMutation,
} from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { resolveEffectiveChatDefaults } from "@/lib/domain/chat/composer/preference-resolvers";
import { createPendingWorkspaceAttemptId } from "@/lib/domain/workspaces/creation/pending-entry";
import { createCoworkThreadWorkflow } from "@/lib/workflows/cowork/create-cowork-thread";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import { useWorkspaceCollectionsMutationCache } from "@/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceFileActions } from "@/hooks/workspaces/facade/files/use-workspace-file-actions";
import { useWorkspaceEntryFlow } from "@/hooks/workspaces/workflows/use-workspace-entry-flow";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudLaunchModelRegistries } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import type { DesktopLaunchModelRegistry as ModelRegistry } from "@/lib/domain/agents/cloud-launch-catalog";
import { applySessionLaunchDefaults } from "@/lib/workflows/sessions/session-launch-defaults";
import { mergeLiveDefaultLaunchControls } from "@/lib/domain/sessions/creation/launch-controls";
import { createSessionLaunchDefaultsClient } from "@/lib/access/anyharness/session-launch-defaults-client";
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
import { useToastStore } from "@/stores/toast/toast-store";
import { markWorkspaceBootstrappedInSession } from "@/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import { recordCreatedCoworkSession } from "@/hooks/cowork/workflows/cowork-thread-session-record";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

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
    launchControlValues?: Record<string, string>;
    draftText?: string | null;
    sourceWorkspaceId?: string | null;
  }) => {
    return createCoworkThreadWorkflow({
      ...input,
      coworkWorkspaceDelegationEnabled: preferences.coworkWorkspaceDelegationEnabled,
      runtimeUrl,
    }, {
      createPendingWorkspaceAttemptId,
      nowMs: () => Date.now(),
      nowIso: () => new Date().toISOString(),
      startLatencyTimer,
      elapsedMs,
      elapsedSince,
      logLatency,
      getSelectedWorkspaceId: () => useSessionSelectionStore.getState().selectedWorkspaceId,
      getPendingWorkspaceEntry: () =>
        useSessionSelectionStore.getState().pendingWorkspaceEntry,
      isAttemptCurrent: (attemptId) =>
        useSessionSelectionStore.getState().pendingWorkspaceEntry?.attemptId === attemptId,
      setThreadsCollapsed: (collapsed) => {
        useWorkspaceUiStore.getState().setThreadsCollapsed(collapsed);
      },
      beginPendingWorkspace,
      navigateToWorkspaceShell,
      createCoworkThread: (request) => createCoworkThreadMutation.mutateAsync(request),
      applyLaunchDefaults: async ({ session, agentKind, launchControlValues }) => {
        const launchDefaults = await applySessionLaunchDefaults({
          client: createSessionLaunchDefaultsClient(resolveRuntimeConnection(anyHarnessRuntime)),
          session,
          agentKind,
          modelRegistries,
          defaultLiveSessionControlValuesByAgentKind: mergeLiveDefaultLaunchControls({
            defaults: preferences.defaultLiveSessionControlValuesByAgentKind,
            agentKind,
            values: launchControlValues ?? {},
          }),
        });
        return launchDefaults.session;
      },
      upsertLocalWorkspace,
      upsertWorkspaceSessionRecord,
      recordCreatedSession: recordCreatedCoworkSession,
      setDraftText,
      clearDraft,
      setPendingWorkspaceEntry,
      activateWorkspace,
      rememberLastViewedSession,
      trackWorkspaceInteraction,
      markWorkspaceViewed,
      markWorkspaceBootstrappedInSession,
      initWorkspace: initForWorkspace,
      showToast,
    });
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
    launchControlValues?: Record<string, string>;
    draftText?: string | null;
    sourceWorkspaceId?: string | null;
  }) => {
    return createThreadWithResolvedConfig({
      agentKind: input.agentKind,
      modelId: input.modelId,
      modeId: input.modeId,
      launchControlValues: input.launchControlValues,
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
