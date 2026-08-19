import {
  useAgentLaunchOptionsQuery,
  useCreateCoworkThreadMutation,
} from "@anyharness/sdk-react";
import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { resolveEffectiveChatDefaults } from "#product/lib/domain/chat/composer/preference-resolvers";
import { createPendingWorkspaceAttemptId } from "#product/lib/domain/workspaces/creation/pending-entry";
import { createCoworkThreadWorkflow } from "#product/lib/workflows/cowork/create-cowork-thread";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";
import { useWorkspaceCollectionsMutationCache } from "#product/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceFileActions } from "#product/hooks/workspaces/facade/files/use-workspace-file-actions";
import { useWorkspaceEntryFlow } from "#product/hooks/workspaces/workflows/use-workspace-entry-flow";
import {
  getPendingWorkspaceEntry,
  isAttemptAttended,
  isAttemptLive,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";
import { useWorkspaceSessionCache } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import {
  buildDesktopLaunchModelRegistries,
  projectHarnessLaunchOptions,
  type DesktopAgentLaunchAgent,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import {
  isStoredDefaultModelStale,
  withClearedDefaultModelIdByAgentKind,
} from "#product/lib/domain/agents/model-options";
import {
  markWorkspaceViewed,
  rememberLastViewedSession,
  trackWorkspaceInteraction,
  useWorkspaceUiStore,
} from "#product/stores/preferences/workspace-ui-store";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { markWorkspaceBootstrappedInSession } from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import { recordCreatedCoworkSession } from "#product/hooks/cowork/workflows/cowork-thread-session-record";

const EMPTY_LAUNCH_AGENTS: DesktopAgentLaunchAgent[] = [];

export function useCoworkThreadWorkflow() {
  const location = useLocation();
  const navigate = useNavigate();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { upsertLocalWorkspace } = useWorkspaceCollectionsMutationCache(runtimeUrl);
  const setPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const clearPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.clearPendingWorkspaceEntry,
  );
  const activateWorkspace = useSessionSelectionStore((state) => state.activateWorkspace);
  const { beginPendingWorkspace } = useWorkspaceEntryFlow();
  const { agents } = useAgentCatalog();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    coworkWorkspaceDelegationEnabled: state.coworkWorkspaceDelegationEnabled,
    set: state.set,
  })));
  const requestedHarnessKind = preferences.defaultChatAgentKind || agents[0]?.kind || null;
  const runtimeLaunchOptions = useAgentLaunchOptionsQuery({ harnessKind: requestedHarnessKind });
  const launchAgents = useMemo(() => {
    const projected = runtimeLaunchOptions.data
      ? projectHarnessLaunchOptions(runtimeLaunchOptions.data)
      : null;
    return projected ? [projected] : EMPTY_LAUNCH_AGENTS;
  }, [runtimeLaunchOptions.data]);
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
    attemptId?: string;
    agentKind: string;
    modelId: string;
    launchAgent?: DesktopAgentLaunchAgent | null;
    launchControlValues?: Record<string, string>;
    draftText?: string | null;
    sourceWorkspaceId?: string | null;
  }) => {
    const { launchAgent: inputLaunchAgent, ...workflowInput } = input;
    const launchAgent = inputLaunchAgent
      ?? launchAgents.find((candidate) => candidate.kind === input.agentKind)
      ?? null;
    const launchControlValues = {
      ...defaultLaunchControlValues(launchAgent),
      ...(input.launchControlValues ?? {}),
    };
    return createCoworkThreadWorkflow({
      ...workflowInput,
      launchControlValues,
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
      getPendingWorkspaceEntry,
      isAttemptLive,
      isAttemptAttended,
      setThreadsCollapsed: (collapsed) => {
        useWorkspaceUiStore.getState().setThreadsCollapsed(collapsed);
      },
      beginPendingWorkspace,
      navigateToWorkspaceShell,
      createCoworkThread: (request) => createCoworkThreadMutation.mutateAsync(request),
      upsertLocalWorkspace,
      upsertWorkspaceSessionRecord,
      recordCreatedSession: recordCreatedCoworkSession,
      setDraftText,
      clearDraft,
      setPendingWorkspaceEntry,
      clearPendingWorkspaceEntry,
      activateWorkspace,
      rememberLastViewedSession,
      trackWorkspaceInteraction,
      markWorkspaceViewed,
      markWorkspaceBootstrappedInSession,
      initWorkspace: initForWorkspace,
      showToast,
    });
  }, [
    beginPendingWorkspace,
    clearDraft,
    createCoworkThreadMutation,
    initForWorkspace,
    launchAgents,
    navigateToWorkspaceShell,
    preferences.coworkWorkspaceDelegationEnabled,
    runtimeUrl,
    setDraftText,
    activateWorkspace,
    clearPendingWorkspaceEntry,
    setPendingWorkspaceEntry,
    showToast,
    upsertLocalWorkspace,
    upsertWorkspaceSessionRecord,
  ]);

  const createThread = useCallback(async () => {
    const response = runtimeLaunchOptions.data
      ?? (runtimeUrl ? (await runtimeLaunchOptions.refetch()).data : undefined);
    const projected = response ? projectHarnessLaunchOptions(response) : null;
    const gatedLaunchAgents = projected ? [projected] : EMPTY_LAUNCH_AGENTS;
    const gatedRegistries = buildDesktopLaunchModelRegistries(gatedLaunchAgents);
    const observedAgents = gatedLaunchAgents.map((agent) => ({
      kind: agent.kind,
      displayName: agent.displayName,
      readiness: "ready" as const,
    }));
    const defaults = resolveEffectiveChatDefaults(
      gatedRegistries,
      observedAgents,
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
    const runtimeAgent = gatedLaunchAgents.find((agent) => agent.kind === defaults.agentKind);
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
      launchAgent: gatedLaunchAgents.find(
        (candidate) => candidate.kind === defaults.agentKind,
      ) ?? null,
    });
  }, [
    agents,
    createThreadWithResolvedConfig,
    preferences,
    runtimeLaunchOptions,
    runtimeUrl,
    showToast,
  ]);

  const createThreadFromSelection = useCallback(async (input: {
    attemptId?: string;
    agentKind: string;
    modelId: string;
    launchControlValues?: Record<string, string>;
    draftText?: string | null;
    sourceWorkspaceId?: string | null;
  }) => {
    return createThreadWithResolvedConfig({
      attemptId: input.attemptId,
      agentKind: input.agentKind,
      modelId: input.modelId,
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

function defaultLaunchControlValues(
  agent: DesktopAgentLaunchAgent | null,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of agent?.launchControls ?? []) {
    if (control.defaultValue) {
      values[control.key] = control.defaultValue;
    }
  }
  return values;
}
