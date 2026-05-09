import type {
  ContentPart,
  PromptInputBlock,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { useSessionPromptWorkflow } from "@/hooks/sessions/workflows/use-session-prompt-workflow";
import type {
  LaunchPromptInput,
  SessionControlDeps,
} from "@/hooks/sessions/workflows/session-control-contract";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import type { PromptAttachmentSnapshot } from "@/lib/domain/chat/composer/prompt-attachment-snapshot";
import {
  sessionSlotBelongsToWorkspace,
} from "@/lib/domain/sessions/activity";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
import { selectSessionWithShellIntentRollback } from "@/hooks/sessions/workflows/session-shell-selection";
import {
  getSessionRecords,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export function useSessionFindOrCreateActions({
  activateSession,
  createSessionWithResolvedConfig,
  ensureWorkspaceSessions,
  selectSession,
}: SessionControlDeps) {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { promptSession } = useSessionPromptWorkflow();

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
    findOrCreateSession,
    findOrCreateSessionForLaunch,
  };
}
