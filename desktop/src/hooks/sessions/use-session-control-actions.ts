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
import {
  getSessionRecord,
  getSessionRecords,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import {
  getSessionClientAndWorkspace,
  isPendingSessionId,
} from "@/lib/integrations/anyharness/session-runtime";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import type { SessionActivationGuard, SessionActivationOutcome } from "@/hooks/sessions/session-activation-guard";
import { selectSessionWithShellIntentRollback } from "@/hooks/sessions/session-shell-selection";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
import type { MeasurementOperationId } from "@/lib/infra/debug-measurement";
import type { PromptAttachmentSnapshot } from "@/lib/domain/chat/prompt-attachment-snapshot";

interface SessionLatencyFlowOptions {
  latencyFlowId?: string | null;
}

interface PromptLatencyFlowOptions extends SessionLatencyFlowOptions {
  measurementOperationId?: MeasurementOperationId | null;
  promptId?: string | null;
}

interface LaunchPromptInput extends SessionLatencyFlowOptions {
  workspaceId: string;
  agentKind: string;
  modelId: string;
  text: string;
  blocks?: PromptInputBlock[];
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  optimisticContentParts?: ContentPart[];
  promptId?: string | null;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
}

interface SessionConfigOptionUpdateOptions {
  persistDefaultPreference?: boolean;
}

interface SessionControlDeps {
  createSessionWithResolvedConfig: (options: {
    text: string;
    blocks?: PromptInputBlock[];
    attachmentSnapshots?: PromptAttachmentSnapshot[];
    optimisticContentParts?: ContentPart[];
    agentKind: string;
    modelId: string;
    modeId?: string;
    workspaceId?: string;
    latencyFlowId?: string | null;
    measurementOperationId?: MeasurementOperationId | null;
    promptId?: string | null;
    preferExistingCompatibleSession?: boolean;
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
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      throw new Error("No active session");
    }
    const currentSlot = getSessionRecord(sessionId);
    if (isPendingSessionId(sessionId) || currentSlot?.materializedSessionId === null) {
      if (!currentSlot) {
        throw new Error("No active session");
      }
      const mutationId = ++nextPendingConfigMutationId;
      patchSessionRecord(sessionId, {
        ...(configId === "model" ? { modelId: value } : {}),
        ...(configId === "mode" ? { modeId: value } : {}),
        pendingConfigChanges: withPendingConfigChange(
          currentSlot?.pendingConfigChanges ?? {},
          {
            rawConfigId: configId,
            value,
            status: "queued",
            mutationId,
          },
        ),
      });
      return;
    }

    const workspaceId = currentSlot?.workspaceId ?? state.selectedWorkspaceId;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const mutationId = ++nextPendingConfigMutationId;
    patchSessionRecord(sessionId, {
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
      const { connection, materializedSessionId } = await getSessionClientAndWorkspace(sessionId);
      const response = await getAnyHarnessClient(connection).sessions.setConfigOption(materializedSessionId, {
        configId,
        value,
      });

      if (workspaceId) {
        upsertWorkspaceSessionRecord(workspaceId, response.session);
      }

      const latestSlot = getSessionRecord(sessionId);
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
        patchSessionRecord(sessionId, {
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
        patchSessionRecord(sessionId, nextPatch);
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
      const latestSlot = getSessionRecord(sessionId);
      if (latestSlot?.pendingConfigChanges[configId]?.mutationId === mutationId) {
        patchSessionRecord(sessionId, {
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
      attachmentSnapshots?: PromptAttachmentSnapshot[];
      optimisticContentParts?: ContentPart[];
    },
  ) => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      throw new Error("No active session");
    }

    const slot = getSessionRecord(sessionId);
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
      attachmentSnapshots: options?.attachmentSnapshots,
      optimisticContentParts: options?.optimisticContentParts,
      workspaceId,
      latencyFlowId: options?.latencyFlowId,
      measurementOperationId: options?.measurementOperationId,
      promptId: options?.promptId,
    });
  }, [getWorkspaceRuntimeBlockReason, promptSession]);

  const cancelActiveSession = useCallback(async () => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      return;
    }

    const workspaceId = getSessionRecord(sessionId)?.workspaceId ?? state.selectedWorkspaceId;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    try {
      const { connection, materializedSessionId } = await getSessionClientAndWorkspace(sessionId);
      await getAnyHarnessClient(connection).sessions.cancel(materializedSessionId);
      patchSessionRecord(sessionId, { status: "idle" });
    } catch {
      // Cancel failed.
    }
  }, [getWorkspaceRuntimeBlockReason, showToast]);

  const resolvePermission = useCallback(async (
    input: { decision?: "allow" | "deny"; optionId?: string },
  ) => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? getSessionRecord(sessionId) : null;
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

    const { connection, materializedSessionId } = await getSessionClientAndWorkspace(sessionId);
    const request: ResolveInteractionRequest = input.optionId
      ? { outcome: "selected", optionId: input.optionId }
      : { outcome: "decision", decision: input.decision ?? "deny" };
    await getAnyHarnessClient(connection).sessions.resolveInteraction(
      materializedSessionId,
      permission.requestId,
      request,
    );
  }, [getWorkspaceRuntimeBlockReason]);

  const resolveUserInput = useCallback(async (
    input:
      | { outcome: "submitted"; answers: UserInputSubmittedAnswer[] }
      | { outcome: "cancelled" },
  ) => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? getSessionRecord(sessionId) : null;
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

    const { connection, materializedSessionId } = await getSessionClientAndWorkspace(sessionId);
    const request: ResolveInteractionRequest = input.outcome === "submitted"
      ? { outcome: "submitted", answers: input.answers }
      : { outcome: "cancelled" };
    await getAnyHarnessClient(connection).sessions.resolveInteraction(
      materializedSessionId,
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
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? getSessionRecord(sessionId) : null;
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

    const { connection, materializedSessionId } = await getSessionClientAndWorkspace(sessionId);
    const request: ResolveInteractionRequest = input.outcome === "accepted"
      ? { outcome: "accepted", fields: input.fields }
      : { outcome: input.outcome };
    await getAnyHarnessClient(connection).sessions.resolveInteraction(
      materializedSessionId,
      mcpElicitation.requestId,
      request,
    );
  }, [getWorkspaceRuntimeBlockReason]);

  const revealMcpElicitationUrl = useCallback(async (): Promise<McpElicitationUrlRevealResponse | null> => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? getSessionRecord(sessionId) : null;
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

    const { connection, materializedSessionId } = await getSessionClientAndWorkspace(sessionId);
    return getAnyHarnessClient(connection).sessions.revealMcpElicitationUrl(
      materializedSessionId,
      mcpElicitation.requestId,
    );
  }, [getWorkspaceRuntimeBlockReason]);

  const findOrCreateSession = useCallback(async (
    agentKind: string,
    text: string,
    modelId?: string,
    blocks?: PromptInputBlock[],
    attachmentSnapshots?: PromptAttachmentSnapshot[],
    optimisticContentParts?: ContentPart[],
    onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void,
    measurementOperationId?: MeasurementOperationId | null,
    promptId?: string | null,
  ) => {
    const state = useSessionSelectionStore.getState();
    const workspaceId = state.selectedWorkspaceId;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    for (const slot of Object.values(getSessionRecords())) {
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
          attachmentSnapshots,
          optimisticContentParts,
          workspaceId,
          onBeforeOptimisticPrompt,
          measurementOperationId,
          promptId,
        });
        return;
      }
    }

    await createSessionWithResolvedConfig({
      text,
      blocks,
      attachmentSnapshots,
      optimisticContentParts,
      agentKind,
      modelId: modelId ?? agentKind,
      ...(workspaceId ? { workspaceId } : {}),
      onBeforeOptimisticPrompt,
      measurementOperationId,
      promptId,
      preferExistingCompatibleSession: true,
    });
  }, [
    activateSession,
    createSessionWithResolvedConfig,
    getWorkspaceRuntimeBlockReason,
    promptSession,
  ]);

  const findOrCreateSessionForLaunch = useCallback(async ({
    workspaceId,
    agentKind,
    modelId,
    text,
    blocks,
    attachmentSnapshots,
    optimisticContentParts,
    latencyFlowId,
    promptId,
    onBeforeOptimisticPrompt,
  }: LaunchPromptInput) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    for (const slot of Object.values(getSessionRecords())) {
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
          attachmentSnapshots,
          optimisticContentParts,
          workspaceId,
          latencyFlowId,
          promptId,
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
        attachmentSnapshots,
        optimisticContentParts,
        workspaceId,
        latencyFlowId,
        promptId,
        onBeforeOptimisticPrompt,
      });
      return;
    }

    await createSessionWithResolvedConfig({
      text,
      blocks,
      attachmentSnapshots,
      optimisticContentParts,
      agentKind,
      modelId,
      workspaceId,
      latencyFlowId,
      promptId,
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
