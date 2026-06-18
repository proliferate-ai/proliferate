import {
  resolveRuntimeConnection,
  useAgentLaunchOptionsQuery,
  useAnyHarnessRuntimeContext,
  useCreateCoworkThreadMutation,
} from "@anyharness/sdk-react";
import { useCallback, useMemo } from "react";
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
import { mergeRuntimeLaunchOptionsIntoModelRegistries } from "@/lib/domain/settings/model-registries";
import {
  isStoredDefaultModelStale,
  withClearedDefaultModelIdByAgentKind,
} from "@/lib/domain/agents/model-options";
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
  const { data: cloudModelRegistries = EMPTY_MODEL_REGISTRIES } = useCloudLaunchModelRegistries();
  // Gate the new-thread model set to the runtime's active auth context. The cloud
  // catalog lists every model across all contexts (incl. bedrock us.anthropic.*),
  // so resolving a stored default against it alone can pick a model that is not
  // valid in the live context. The runtime launch-options are pre-filtered to
  // visible + available for the classified context; merging them (runtime wins)
  // yields the same context-valid set the composer/model-selector already uses.
  const runtimeLaunchOptions = useAgentLaunchOptionsQuery();
  const modelRegistries = useMemo(
    () => mergeRuntimeLaunchOptionsIntoModelRegistries(
      cloudModelRegistries,
      runtimeLaunchOptions.data?.agents ?? null,
    ),
    [cloudModelRegistries, runtimeLaunchOptions.data?.agents],
  );
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    defaultLiveSessionControlValuesByAgentKind:
      state.defaultLiveSessionControlValuesByAgentKind,
    coworkWorkspaceDelegationEnabled: state.coworkWorkspaceDelegationEnabled,
    set: state.set,
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
    // Resolve against the runtime's context-gated launch options, not the
    // ungated cloud catalog. If the query has not resolved yet (e.g. a fast
    // "New Thread" right after connect), fetch it now — otherwise the merge
    // falls back to the cloud catalog and could pick a stale default (e.g. a
    // bedrock id) that the runtime then rejects.
    let runtimeAgents = runtimeLaunchOptions.data?.agents ?? null;
    if (!runtimeAgents && runtimeUrl) {
      runtimeAgents = (await runtimeLaunchOptions.refetch()).data?.agents ?? null;
    }
    const gatedRegistries = mergeRuntimeLaunchOptionsIntoModelRegistries(
      cloudModelRegistries,
      runtimeAgents,
    );
    const defaults = resolveEffectiveChatDefaults(
      gatedRegistries,
      agents,
      preferences,
      null,
    );

    if (!defaults.agentKind || !defaults.modelId) {
      throw new Error(defaults.degradedReason ?? "No ready agents are available.");
    }

    // Self-heal a stale stored default: if the persisted default model for this
    // agent is not in the runtime's context-gated options (e.g. a bedrock id
    // left over after switching to oauth), drop it so the warning does not
    // re-fire on every new thread. Only act when the runtime authoritatively
    // lists the agent (avoids wiping a valid default while options are loading).
    const storedDefault = preferences.defaultChatModelIdByAgentKind[defaults.agentKind];
    const runtimeAgent = runtimeAgents?.find(
      (agent) => agent.kind === defaults.agentKind,
    );
    const healedStaleDefault = isStoredDefaultModelStale(
      storedDefault,
      runtimeAgent?.models ?? null,
    );
    if (healedStaleDefault) {
      preferences.set(
        "defaultChatModelIdByAgentKind",
        withClearedDefaultModelIdByAgentKind(
          preferences.defaultChatModelIdByAgentKind,
          defaults.agentKind,
        ),
      );
    }

    // Surface the degraded reason — but not when we just self-healed a stale
    // default: a valid model was substituted and the dead pref cleared, so
    // there is nothing actionable to warn about.
    if (defaults.degradedReason && !healedStaleDefault) {
      showToast(defaults.degradedReason, "info");
    }

    return createThreadWithResolvedConfig({
      agentKind: defaults.agentKind,
      modelId: defaults.modelId,
    });
  }, [
    agents,
    cloudModelRegistries,
    createThreadWithResolvedConfig,
    preferences,
    runtimeLaunchOptions,
    runtimeUrl,
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
