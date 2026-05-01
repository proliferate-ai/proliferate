import {
  selectPendingApprovalInteraction,
  selectPendingMcpElicitationInteraction,
  selectPendingUserInputInteraction,
  type McpElicitationSubmittedField,
  type McpElicitationUrlRevealResponse,
  type ContentPart,
  type PromptInputBlock,
  type ResolveInteractionRequest,
  type UserInputSubmittedAnswer,
} from "@anyharness/sdk";
import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import {
  getAuthoritativeConfigValue,
  shouldAcceptAuthoritativeLiveConfig,
  type PendingSessionConfigChange,
  type PendingSessionConfigChanges,
} from "@/lib/domain/sessions/pending-config";
import { persistDefaultSessionModePreference } from "@/hooks/sessions/session-mode-preferences";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/use-workspace-surface-lookup";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  resolveStatusFromExecutionSummary,
  sessionSlotBelongsToWorkspace,
} from "@/lib/domain/sessions/activity";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import {
  getSessionClientAndWorkspace,
  isPendingSessionId,
} from "@/lib/integrations/anyharness/session-runtime";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import type { SessionActivationGuard, SessionActivationOutcome } from "@/hooks/sessions/session-activation-guard";
import { selectSessionWithShellIntentRollback } from "@/hooks/sessions/session-shell-selection";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";

interface SessionLatencyFlowOptions {
  latencyFlowId?: string | null;
}

interface PromptLatencyFlowOptions extends SessionLatencyFlowOptions { promptId?: string | null; }

interface LaunchPromptInput extends SessionLatencyFlowOptions {
  workspaceId: string;
  agentKind: string;
  modelId: string;
  text: string;
  blocks?: PromptInputBlock[];
  optimisticContentParts?: ContentPart[];
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
}

interface SessionConfigOptionUpdateOptions {
  persistDefaultPreference?: boolean;
}

interface SessionControlDeps {
  createSessionWithResolvedConfig: (options: {
    text: string;
    blocks?: PromptInputBlock[];
    optimisticContentParts?: ContentPart[];
    agentKind: string;
    modelId: string;
    modeId?: string;
    workspaceId?: string;
    latencyFlowId?: string | null;
    onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
  }) => Promise<string>;
  ensureWorkspaceSessions: (workspaceId: string) => Promise<Array<{
    id: string;
    agentKind: string;
    modelId?: string | null;
    workspaceId: string;
    lastPromptAt?: string | null;
  }>>;
  selectSession: (sessionId: string, options?: SessionLatencyFlowOptions & { guard?: SessionActivationGuard }) => Promise<SessionActivationOutcome | void>;
  activateSession: (sessionId: string | null) => void;
}

let nextPendingConfigMutationId = 0;

function withPendingConfigChange(
  pendingConfigChanges: PendingSessionConfigChanges,
  pendingChange: PendingSessionConfigChange,
): PendingSessionConfigChanges {
  return {
    ...pendingConfigChanges,
    [pendingChange.rawConfigId]: pendingChange,
  };
}

function withoutPendingConfigChange(
  pendingConfigChanges: PendingSessionConfigChanges,
  rawConfigId: string,
): PendingSessionConfigChanges {
  if (!pendingConfigChanges[rawConfigId]) {
    return pendingConfigChanges;
  }

  const { [rawConfigId]: _removed, ...rest } = pendingConfigChanges;
  return rest;
}

export function useSessionControlActions({
  activateSession,
  createSessionWithResolvedConfig,
  ensureWorkspaceSessions,
  selectSession,
}: SessionControlDeps) {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const showToast = useToastStore((state) => state.show);
  const { promptSession } = useSessionPromptWorkflow();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();

  const setActiveSessionConfigOption = useCallback(async (
    configId: string,
    value: string,
    options?: SessionConfigOptionUpdateOptions,
  ) => {
    const state = useHarnessStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      throw new Error("No active session");
    }
    if (isPendingSessionId(sessionId)) {
      throw new Error("Wait for the session to finish starting before changing its configuration");
    }

    const currentSlot = state.sessionSlots[sessionId] ?? null;
    const workspaceId = currentSlot?.workspaceId ?? state.selectedWorkspaceId;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const mutationId = ++nextPendingConfigMutationId;
    useHarnessStore.getState().patchSessionSlot(sessionId, {
      pendingConfigChanges: withPendingConfigChange(
        currentSlot?.pendingConfigChanges ?? {},
        {
          rawConfigId: configId,
          value,
          status: "submitting",
          mutationId,
        },
      ),
    });

    try {
      const { connection } = await getSessionClientAndWorkspace(sessionId);
      const response = await getAnyHarnessClient(connection).sessions.setConfigOption(sessionId, {
        configId,
        value,
      });

      if (workspaceId) {
        upsertWorkspaceSessionRecord(workspaceId, response.session);
      }

      const latestSlot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
      if (!latestSlot) {
        return response;
      }

      const responseLiveConfig = response.liveConfig ?? response.session.liveConfig ?? null;
      const shouldReplaceLiveConfig = shouldAcceptAuthoritativeLiveConfig(
        latestSlot.liveConfig,
        responseLiveConfig,
      );
      const shouldApplyConfigFields = shouldReplaceLiveConfig || !latestSlot.liveConfig;
      const effectiveLiveConfig = shouldReplaceLiveConfig
        ? responseLiveConfig
        : latestSlot.liveConfig;
      const currentPendingChange = latestSlot.pendingConfigChanges[configId] ?? null;
      const isLatestMutation = currentPendingChange?.mutationId === mutationId;
      let nextPendingConfigChanges = latestSlot.pendingConfigChanges;

      if (isLatestMutation) {
        nextPendingConfigChanges = response.applyState === "applied"
          ? withoutPendingConfigChange(nextPendingConfigChanges, configId)
          : withPendingConfigChange(nextPendingConfigChanges, {
            ...currentPendingChange,
            status: "queued",
          });
      }

      const nextPatch = {
        agentKind: response.session.agentKind,
        executionSummary: response.session.executionSummary ?? latestSlot.executionSummary ?? null,
        status: resolveStatusFromExecutionSummary(
          response.session.executionSummary ?? latestSlot.executionSummary ?? null,
          response.session.status,
        ),
        title: response.session.title ?? latestSlot.title ?? null,
        lastPromptAt: response.session.lastPromptAt ?? latestSlot.lastPromptAt ?? null,
        workspaceId,
        pendingConfigChanges: nextPendingConfigChanges,
      } as const;

      if (shouldApplyConfigFields) {
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          ...nextPatch,
          liveConfig: effectiveLiveConfig,
          modelId:
            effectiveLiveConfig?.normalizedControls.model?.currentValue
            ?? response.session.modelId
            ?? latestSlot.modelId
            ?? null,
          modeId:
            effectiveLiveConfig?.normalizedControls.mode?.currentValue
            ?? response.session.modeId
            ?? latestSlot.modeId
            ?? null,
          transcript: {
            ...latestSlot.transcript,
            currentModeId:
              effectiveLiveConfig?.normalizedControls.mode?.currentValue
              ?? response.session.modeId
              ?? latestSlot.transcript.currentModeId,
          },
        });
      } else {
        useHarnessStore.getState().patchSessionSlot(sessionId, nextPatch);
      }

      if (isLatestMutation && response.applyState === "queued") {
        showToast("Config update queued. It will apply at end of turn.", "info");
      }

      if (
        isLatestMutation
        && response.applyState === "applied"
        && options?.persistDefaultPreference !== false
      ) {
        persistDefaultSessionModePreference({
          agentKind: response.session.agentKind ?? latestSlot.agentKind,
          liveConfigRawConfigId: effectiveLiveConfig?.normalizedControls.mode?.rawConfigId ?? null,
          rawConfigId: configId,
          modeId: getAuthoritativeConfigValue(effectiveLiveConfig, configId) ?? value,
          workspaceSurface: getWorkspaceSurface(workspaceId),
        });
      }

      return response;
    } catch (error) {
      const latestSlot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
      if (latestSlot?.pendingConfigChanges[configId]?.mutationId === mutationId) {
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          pendingConfigChanges: withoutPendingConfigChange(
            latestSlot.pendingConfigChanges,
            configId,
          ),
        });
      }
      throw error;
    }
  }, [getWorkspaceRuntimeBlockReason, getWorkspaceSurface, showToast, upsertWorkspaceSessionRecord]);

  const promptActiveSession = useCallback(async (
    text: string,
    options?: PromptLatencyFlowOptions & {
      blocks?: PromptInputBlock[];
      optimisticContentParts?: ContentPart[];
    },
  ) => {
    const state = useHarnessStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      throw new Error("No active session");
    }

    const slot = state.sessionSlots[sessionId] ?? null;
    if (!isPendingSessionId(sessionId) && !slot) {
      throw new Error("No active session");
    }
    if (!isPendingSessionId(sessionId) && slot && !slot.transcriptHydrated) {
      throw new Error("Session is still loading. Try again in a moment.");
    }

    const workspaceId = slot?.workspaceId ?? null;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    await promptSession({
      sessionId,
      text,
      blocks: options?.blocks,
      optimisticContentParts: options?.optimisticContentParts,
      workspaceId,
      latencyFlowId: options?.latencyFlowId,
      promptId: options?.promptId,
    });
  }, [getWorkspaceRuntimeBlockReason, promptSession]);

  const cancelActiveSession = useCallback(async () => {
    const state = useHarnessStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      return;
    }

    const workspaceId = state.sessionSlots[sessionId]?.workspaceId ?? state.selectedWorkspaceId;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    try {
      const { connection } = await getSessionClientAndWorkspace(sessionId);
      await getAnyHarnessClient(connection).sessions.cancel(sessionId);
      useHarnessStore.getState().patchSessionSlot(sessionId, { status: "idle" });
    } catch {
      // Cancel failed.
    }
  }, [getWorkspaceRuntimeBlockReason, showToast]);

  const resolvePermission = useCallback(async (
    input: { decision?: "allow" | "deny"; optionId?: string },
  ) => {
    const state = useHarnessStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? state.sessionSlots[sessionId] : null;
    const permission = slot?.transcript
      ? selectPendingApprovalInteraction(slot.transcript)
      : null;
    if (!sessionId || !permission) {
      return;
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(slot?.workspaceId ?? state.selectedWorkspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const { connection } = await getSessionClientAndWorkspace(sessionId);
    const request: ResolveInteractionRequest = input.optionId
      ? { outcome: "selected", optionId: input.optionId }
      : { outcome: "decision", decision: input.decision ?? "deny" };
    await getAnyHarnessClient(connection).sessions.resolveInteraction(
      sessionId,
      permission.requestId,
      request,
    );
  }, [getWorkspaceRuntimeBlockReason]);

  const resolveUserInput = useCallback(async (
    input:
      | { outcome: "submitted"; answers: UserInputSubmittedAnswer[] }
      | { outcome: "cancelled" },
  ) => {
    const state = useHarnessStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? state.sessionSlots[sessionId] : null;
    const userInput = slot?.transcript
      ? selectPendingUserInputInteraction(slot.transcript)
      : null;
    if (!sessionId || !userInput) {
      return;
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(slot?.workspaceId ?? state.selectedWorkspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const { connection } = await getSessionClientAndWorkspace(sessionId);
    const request: ResolveInteractionRequest = input.outcome === "submitted"
      ? { outcome: "submitted", answers: input.answers }
      : { outcome: "cancelled" };
    await getAnyHarnessClient(connection).sessions.resolveInteraction(
      sessionId,
      userInput.requestId,
      request,
    );
  }, [getWorkspaceRuntimeBlockReason]);

  const resolveMcpElicitation = useCallback(async (
    input:
      | { outcome: "accepted"; fields: McpElicitationSubmittedField[] }
      | { outcome: "declined" }
      | { outcome: "cancelled" },
  ) => {
    const state = useHarnessStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? state.sessionSlots[sessionId] : null;
    const mcpElicitation = slot?.transcript
      ? selectPendingMcpElicitationInteraction(slot.transcript)
      : null;
    if (!sessionId || !mcpElicitation) {
      return;
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(slot?.workspaceId ?? state.selectedWorkspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const { connection } = await getSessionClientAndWorkspace(sessionId);
    const request: ResolveInteractionRequest = input.outcome === "accepted"
      ? { outcome: "accepted", fields: input.fields }
      : { outcome: input.outcome };
    await getAnyHarnessClient(connection).sessions.resolveInteraction(
      sessionId,
      mcpElicitation.requestId,
      request,
    );
  }, [getWorkspaceRuntimeBlockReason]);

  const revealMcpElicitationUrl = useCallback(async (): Promise<McpElicitationUrlRevealResponse | null> => {
    const state = useHarnessStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? state.sessionSlots[sessionId] : null;
    const mcpElicitation = slot?.transcript
      ? selectPendingMcpElicitationInteraction(slot.transcript)
      : null;
    if (!sessionId || !mcpElicitation) {
      return null;
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(slot?.workspaceId ?? state.selectedWorkspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const { connection } = await getSessionClientAndWorkspace(sessionId);
    return getAnyHarnessClient(connection).sessions.revealMcpElicitationUrl(
      sessionId,
      mcpElicitation.requestId,
    );
  }, [getWorkspaceRuntimeBlockReason]);

  const findOrCreateSession = useCallback(async (
    agentKind: string,
    text: string,
    modelId?: string,
    blocks?: PromptInputBlock[],
    optimisticContentParts?: ContentPart[],
    onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void,
  ) => {
    const state = useHarnessStore.getState();
    const workspaceId = state.selectedWorkspaceId;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    for (const slot of Object.values(state.sessionSlots)) {
      if (
        slot.agentKind === agentKind
        && sessionSlotBelongsToWorkspace(slot, workspaceId)
      ) {
        activateSession(slot.sessionId);
        writeChatShellIntentForSession({ workspaceId, sessionId: slot.sessionId });
        await promptSession({
          sessionId: slot.sessionId,
          text,
          blocks,
          optimisticContentParts,
          workspaceId,
          onBeforeOptimisticPrompt,
        });
        return;
      }
    }

    if (workspaceId) {
      const sessions = await ensureWorkspaceSessions(workspaceId);
      const backendSession = sessions.find((session) => session.agentKind === agentKind);
      if (backendSession) {
        await selectSessionWithShellIntentRollback({
          workspaceId,
          sessionId: backendSession.id,
          selectSession,
        });
        await promptSession({
          sessionId: backendSession.id,
          text,
          blocks,
          optimisticContentParts,
          workspaceId,
          onBeforeOptimisticPrompt,
        });
        return;
      }
    }

    await createSessionWithResolvedConfig({
      text,
      blocks,
      optimisticContentParts,
      agentKind,
      modelId: modelId ?? agentKind,
      onBeforeOptimisticPrompt,
    });
  }, [
    activateSession,
    createSessionWithResolvedConfig,
    ensureWorkspaceSessions,
    getWorkspaceRuntimeBlockReason,
    promptSession,
    selectSession,
  ]);

  const findOrCreateSessionForLaunch = useCallback(async ({
    workspaceId,
    agentKind,
    modelId,
    text,
    blocks,
    optimisticContentParts,
    latencyFlowId,
    onBeforeOptimisticPrompt,
  }: LaunchPromptInput) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const state = useHarnessStore.getState();
    for (const slot of Object.values(state.sessionSlots)) {
      if (
        slot.agentKind === agentKind
        && slot.modelId === modelId
        && sessionSlotBelongsToWorkspace(slot, workspaceId)
      ) {
        activateSession(slot.sessionId);
        writeChatShellIntentForSession({ workspaceId, sessionId: slot.sessionId });
        await promptSession({
          sessionId: slot.sessionId,
          text,
          blocks,
          optimisticContentParts,
          workspaceId,
          latencyFlowId,
          onBeforeOptimisticPrompt,
        });
        return;
      }
    }

    const sessions = await ensureWorkspaceSessions(workspaceId);
    const backendSession = sessions.find((session) =>
      session.agentKind === agentKind && session.modelId === modelId
    );
    if (backendSession) {
      await selectSessionWithShellIntentRollback({
        workspaceId,
        sessionId: backendSession.id,
        options: { latencyFlowId },
        selectSession,
      });
      await promptSession({
        sessionId: backendSession.id,
        text,
        blocks,
        optimisticContentParts,
        workspaceId,
        latencyFlowId,
        onBeforeOptimisticPrompt,
      });
      return;
    }

    await createSessionWithResolvedConfig({
      text,
      blocks,
      optimisticContentParts,
      agentKind,
      modelId,
      workspaceId,
      latencyFlowId,
      onBeforeOptimisticPrompt,
    });
  }, [
    activateSession,
    createSessionWithResolvedConfig,
    ensureWorkspaceSessions,
    getWorkspaceRuntimeBlockReason,
    promptSession,
    selectSession,
  ]);

  return {
    cancelActiveSession,
    findOrCreateSession,
    findOrCreateSessionForLaunch,
    promptActiveSession,
    resolvePermission,
    resolveMcpElicitation,
    resolveUserInput,
    revealMcpElicitationUrl,
    setActiveSessionConfigOption,
  };
}
